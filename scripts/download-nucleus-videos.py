"""
Download all Cardiology videos from Nucleus Medical Art Library.
Uses Selenium to scrape video links and extract Vimeo embeds,
then yt-dlp to download video+audio.

Usage:
    python scripts/download-nucleus-videos.py                  # Run full pipeline
    python scripts/download-nucleus-videos.py --phase scrape   # Only scrape links
    python scripts/download-nucleus-videos.py --phase download  # Only download (after scrape)
    python scripts/download-nucleus-videos.py --start-page 5   # Resume scraping from page 5
"""

import argparse
import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import urljoin

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

BASE_URL = "https://nmal.nucleusmedicalmedia.com"
SEARCH_URL = BASE_URL + "/cardiology/results?search_category=4-1035&sc=0&p={page}"
OUTPUT_DIR = Path("f:/AI total editing/nucleus_cardiology_videos")
LINKS_FILE = OUTPUT_DIR / "video_links.json"
VIMEO_FILE = OUTPUT_DIR / "vimeo_urls.json"
DOWNLOAD_DIR = OUTPUT_DIR / "videos"


def create_driver():
    opts = Options()
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_argument("--disable-notifications")
    opts.add_argument("--window-size=1920,1080")
    # Don't use headless - some sites block it
    driver = webdriver.Chrome(options=opts)
    driver.implicitly_wait(5)
    return driver


# ── Phase 1: Scrape all video page links from search results ──


def scrape_video_links(start_page=1):
    """Scrape all video detail page URLs from paginated search results."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load existing progress
    if LINKS_FILE.exists():
        with open(LINKS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        all_links = data.get("links", [])
        print(f"Loaded {len(all_links)} existing links")
    else:
        all_links = []

    driver = create_driver()
    try:
        page = start_page
        while True:
            url = SEARCH_URL.format(page=page)
            print(f"\n── Page {page}: {url}")
            driver.get(url)
            time.sleep(3)  # Let page load

            # Check pagination info: "Showing 1 to 60 of 1,812"
            try:
                info_text = driver.find_element(By.XPATH, "//*[contains(text(),'Showing')]").text
                print(f"   {info_text}")
            except Exception:
                pass

            # Find all video/item links - they typically link to /xxx/view-item?ItemID=xxx
            links_on_page = []
            for a in driver.find_elements(By.CSS_SELECTOR, "a[href*='view-item']"):
                href = a.get_attribute("href")
                if href and href not in [l["url"] for l in all_links]:
                    # Try to get title
                    title = ""
                    try:
                        # The title might be in a nearby element or the link text
                        title = a.text.strip() or a.get_attribute("title") or ""
                    except Exception:
                        pass
                    if href not in [l["url"] for l in links_on_page]:
                        links_on_page.append({"url": href, "title": title})

            if not links_on_page:
                print(f"   No new links found on page {page}. Stopping.")
                break

            all_links.extend(links_on_page)
            print(f"   Found {len(links_on_page)} new links (total: {len(all_links)})")

            # Save progress after each page
            with open(LINKS_FILE, "w", encoding="utf-8") as f:
                json.dump({"links": all_links, "last_page": page}, f, indent=2, ensure_ascii=False)

            # Check if there's a next page
            try:
                next_btn = driver.find_element(By.CSS_SELECTOR, "a[rel='next'], a.next, a[aria-label='Next']")
                if not next_btn.is_enabled():
                    print("   Reached last page.")
                    break
            except Exception:
                # Try checking if current items match total
                pass

            page += 1
            time.sleep(1)

    finally:
        driver.quit()

    print(f"\n✓ Scraped {len(all_links)} video links total. Saved to {LINKS_FILE}")
    return all_links


# ── Phase 2: Extract Vimeo URLs from each video page ──


def extract_vimeo_urls():
    """Visit each video page and extract the Vimeo embed URL."""
    with open(LINKS_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    all_links = data["links"]

    # Load existing vimeo data
    if VIMEO_FILE.exists():
        with open(VIMEO_FILE, "r", encoding="utf-8") as f:
            vimeo_data = json.load(f)
    else:
        vimeo_data = {}

    # Find which ones still need processing
    remaining = [l for l in all_links if l["url"] not in vimeo_data]
    print(f"Need to extract Vimeo URLs for {len(remaining)} videos ({len(vimeo_data)} already done)")

    if not remaining:
        return vimeo_data

    driver = create_driver()
    try:
        for i, link in enumerate(remaining):
            url = link["url"]
            title = link.get("title", "")
            print(f"\n[{i+1}/{len(remaining)}] {title or url}")

            try:
                driver.get(url)
                time.sleep(3)

                # Look for Vimeo iframe
                vimeo_url = None
                vimeo_id = None

                # Method 1: Find iframe with vimeo src
                for iframe in driver.find_elements(By.TAG_NAME, "iframe"):
                    src = iframe.get_attribute("src") or ""
                    if "vimeo" in src:
                        vimeo_url = src
                        # Extract video ID from URL like https://player.vimeo.com/video/123456
                        m = re.search(r"vimeo\.com/video/(\d+)", src)
                        if m:
                            vimeo_id = m.group(1)
                        break

                # Method 2: Search page source for vimeo references
                if not vimeo_url:
                    page_source = driver.page_source
                    m = re.search(r'player\.vimeo\.com/video/(\d+)', page_source)
                    if m:
                        vimeo_id = m.group(1)
                        vimeo_url = f"https://player.vimeo.com/video/{vimeo_id}"

                # Method 3: Check for data attributes or script tags
                if not vimeo_url:
                    m = re.search(r'"vimeo_id"\s*:\s*"?(\d+)"?', driver.page_source)
                    if m:
                        vimeo_id = m.group(1)
                        vimeo_url = f"https://player.vimeo.com/video/{vimeo_id}"

                # Get the page title if we didn't have it
                if not title:
                    try:
                        title_el = driver.find_element(By.CSS_SELECTOR, "h1, h2, .item-title")
                        title = title_el.text.strip()
                    except Exception:
                        title = driver.title

                # Get the asset ID (like ANCE00178SI03)
                asset_id = ""
                try:
                    id_el = driver.find_element(By.XPATH, "//*[contains(text(),'ID:')]")
                    asset_id = id_el.text.replace("ID:", "").strip()
                except Exception:
                    pass

                vimeo_data[url] = {
                    "title": title,
                    "asset_id": asset_id,
                    "vimeo_url": vimeo_url,
                    "vimeo_id": vimeo_id,
                }

                if vimeo_url:
                    print(f"   ✓ Vimeo: {vimeo_url}")
                else:
                    print(f"   ✗ No Vimeo embed found")

            except Exception as e:
                print(f"   ✗ Error: {e}")
                vimeo_data[url] = {"title": title, "error": str(e)}

            # Save progress every 10 items
            if (i + 1) % 10 == 0:
                with open(VIMEO_FILE, "w", encoding="utf-8") as f:
                    json.dump(vimeo_data, f, indent=2, ensure_ascii=False)

    finally:
        driver.quit()
        with open(VIMEO_FILE, "w", encoding="utf-8") as f:
            json.dump(vimeo_data, f, indent=2, ensure_ascii=False)

    found = sum(1 for v in vimeo_data.values() if v.get("vimeo_url"))
    print(f"\n✓ Extracted {found}/{len(vimeo_data)} Vimeo URLs. Saved to {VIMEO_FILE}")
    return vimeo_data


# ── Phase 3: Download videos using yt-dlp ──


def download_videos():
    """Download all videos using yt-dlp."""
    with open(VIMEO_FILE, "r", encoding="utf-8") as f:
        vimeo_data = json.load(f)

    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # Filter to entries with vimeo URLs
    to_download = [
        (page_url, info)
        for page_url, info in vimeo_data.items()
        if info.get("vimeo_url")
    ]
    print(f"Total videos to download: {len(to_download)}")

    for i, (page_url, info) in enumerate(to_download):
        vimeo_url = info["vimeo_url"]
        title = info.get("title", "").strip()
        asset_id = info.get("asset_id", "").strip()

        # Build safe filename
        safe_title = re.sub(r'[<>:"/\\|?*]', '_', title)[:80] if title else "unknown"
        filename_prefix = f"{asset_id}_{safe_title}" if asset_id else safe_title

        # Check if already downloaded
        existing = list(DOWNLOAD_DIR.glob(f"{filename_prefix}.*"))
        if existing:
            print(f"[{i+1}/{len(to_download)}] SKIP (exists): {filename_prefix}")
            continue

        print(f"[{i+1}/{len(to_download)}] Downloading: {filename_prefix}")
        print(f"   Vimeo: {vimeo_url}")

        # yt-dlp command
        cmd = [
            "yt-dlp",
            "--no-check-certificates",
            # Use referer to allow private embeds
            "--referer", page_url,
            # Download best video+audio, merge to mp4
            "-f", "bestvideo+bestaudio/best",
            "--merge-output-format", "mp4",
            # Output filename
            "-o", str(DOWNLOAD_DIR / f"{filename_prefix}.%(ext)s"),
            # Retry on failure
            "--retries", "3",
            "--fragment-retries", "3",
            # Don't stop on errors
            "--no-abort-on-error",
            vimeo_url,
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode == 0:
                print(f"   ✓ Downloaded")
            else:
                print(f"   ✗ yt-dlp error: {result.stderr[-200:]}")
                # Log error
                with open(OUTPUT_DIR / "download_errors.log", "a", encoding="utf-8") as f:
                    f.write(f"{filename_prefix} | {vimeo_url} | {result.stderr}\n")
        except subprocess.TimeoutExpired:
            print(f"   ✗ Timeout (5 min)")
        except Exception as e:
            print(f"   ✗ Error: {e}")

        time.sleep(1)  # Be polite

    print(f"\n✓ Download complete. Videos saved to {DOWNLOAD_DIR}")


# ── Phase 2b: Fallback - screen record for non-Vimeo videos ──


def record_fallback():
    """Screen-record videos that couldn't be downloaded via Vimeo."""
    with open(VIMEO_FILE, "r", encoding="utf-8") as f:
        vimeo_data = json.load(f)

    failed = [
        (url, info)
        for url, info in vimeo_data.items()
        if not info.get("vimeo_url") and not info.get("recorded")
    ]

    if not failed:
        print("No videos need fallback recording.")
        return

    print(f"\n{len(failed)} videos need screen recording fallback.")
    print("These videos had no Vimeo embed found:")
    for url, info in failed:
        print(f"  - {info.get('title', url)}")

    print("\nYou can manually record these or investigate their player type.")


def main():
    parser = argparse.ArgumentParser(description="Download Nucleus Medical videos")
    parser.add_argument("--phase", choices=["scrape", "extract", "download", "all"],
                        default="all", help="Which phase to run")
    parser.add_argument("--start-page", type=int, default=1,
                        help="Start scraping from this page number")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.phase in ("scrape", "all"):
        print("═" * 60)
        print("Phase 1: Scraping video links from search results...")
        print("═" * 60)
        scrape_video_links(start_page=args.start_page)

    if args.phase in ("extract", "all"):
        print("\n" + "═" * 60)
        print("Phase 2: Extracting Vimeo embed URLs...")
        print("═" * 60)
        extract_vimeo_urls()

    if args.phase in ("download", "all"):
        print("\n" + "═" * 60)
        print("Phase 3: Downloading videos with yt-dlp...")
        print("═" * 60)
        download_videos()
        record_fallback()


if __name__ == "__main__":
    main()
