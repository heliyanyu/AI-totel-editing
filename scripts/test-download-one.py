"""
Connect to user's existing Chrome (remote debugging port 9222),
capture video CDN URL from network traffic, and download it.
"""
import json
import os
import re
import sys
import time
from pathlib import Path

os.environ["PYTHONIOENCODING"] = "utf-8"
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

OUTPUT_DIR = Path("f:/AI total editing/nucleus_cardiology_videos/test")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Connect to existing Chrome with remote debugging
    print("Connecting to Chrome on port 9222...")
    opts = Options()
    opts.add_experimental_option("debuggerAddress", "127.0.0.1:9222")
    driver = webdriver.Chrome(options=opts)
    print(f"Connected! Current page: {driver.title}")
    print(f"URL: {driver.current_url}")

    # Get page info
    title = ""
    try:
        title = driver.find_element(By.CSS_SELECTOR, "h1, h2").text.strip()
    except Exception:
        title = driver.title
    asset_id = ""
    try:
        asset_id = driver.find_element(By.XPATH, "//*[contains(text(),'ID:')]").text.replace("ID:", "").strip()
    except Exception:
        pass
    print(f"Title: {title}")
    print(f"Asset ID: {asset_id}")

    # Find Vimeo iframe and get its src
    vimeo_src = ""
    for iframe in driver.find_elements(By.TAG_NAME, "iframe"):
        src = iframe.get_attribute("src") or ""
        if "vimeo" in src:
            vimeo_src = src
            print(f"Vimeo iframe: {src}")
            break

    # Switch into iframe and check video state
    if vimeo_src:
        for iframe in driver.find_elements(By.TAG_NAME, "iframe"):
            src = iframe.get_attribute("src") or ""
            if "vimeo" in src:
                driver.switch_to.frame(iframe)
                break

        try:
            info = driver.execute_script("""
                var v = document.querySelector('video');
                if (!v) return 'no video element';
                return JSON.stringify({
                    src: (v.src||'').substring(0,120),
                    currentSrc: (v.currentSrc||'').substring(0,120),
                    readyState: v.readyState,
                    paused: v.paused,
                    currentTime: v.currentTime,
                    duration: v.duration
                });
            """)
            print(f"Video state: {info}")

            # Try to get the actual video source URL
            video_src = driver.execute_script("""
                var v = document.querySelector('video');
                if (!v) return null;
                // Check all <source> children too
                var sources = v.querySelectorAll('source');
                var result = [];
                if (v.src) result.push(v.src);
                if (v.currentSrc) result.push(v.currentSrc);
                for (var s of sources) {
                    if (s.src) result.push(s.src);
                }
                return JSON.stringify(result);
            """)
            print(f"Video sources: {video_src}")
        except Exception as e:
            print(f"Error checking video: {e}")

        driver.switch_to.default_content()

    # ── Use CDP to enable network monitoring, then re-trigger video ──
    print("\nEnabling CDP network monitoring...")

    # Use CDP directly to monitor future network requests
    driver.execute_cdp_cmd("Network.enable", {})

    # We need to reload or seek the video to generate new network requests
    # Switch into iframe and seek to beginning
    if vimeo_src:
        for iframe in driver.find_elements(By.TAG_NAME, "iframe"):
            src = iframe.get_attribute("src") or ""
            if "vimeo" in src:
                driver.switch_to.frame(iframe)
                break
        try:
            driver.execute_script("""
                var v = document.querySelector('video');
                if (v) { v.currentTime = 0; v.play(); }
            """)
            print("Seeked video to start and playing...")
        except Exception:
            pass
        driver.switch_to.default_content()

    # Wait for some network activity
    print("Waiting 15s for network traffic...")
    time.sleep(15)

    # Check performance logs for video URLs
    print("\nScanning for video URLs...")
    video_urls = {}
    try:
        logs = driver.get_log("performance")
        print(f"Got {len(logs)} log entries")
        for entry in logs:
            try:
                msg = json.loads(entry["message"])["message"]
                method = msg.get("method", "")
                params = msg.get("params", {})
                url = ""
                if "request" in params:
                    url = params["request"].get("url", "")
                elif "response" in params:
                    url = params["response"].get("url", "")
                if not url:
                    continue
                low = url.lower()
                if any(k in low for k in [".mp4", "akamaized", "vod-progressive",
                    "vod-adaptive", "skyfire", ".m3u8", "master.json",
                    "vimeocdn", "fastly", "/sep/video/"]):
                    video_urls[url] = "mp4" if ".mp4" in low else "hls" if ("m3u8" in low or "master.json" in low) else "cdn"
            except Exception:
                continue
    except Exception as e:
        print(f"Log error: {e}")
        print("Performance logs might not be available when connecting to existing browser.")
        print("Trying alternative: extracting video src directly...")

    if video_urls:
        print(f"\nFound {len(video_urls)} video URLs:")
        for url, t in video_urls.items():
            print(f"  [{t}] {url[:150]}")
    else:
        print("No video URLs from logs.")

    # ── Alternative: navigate to Vimeo config endpoint ──
    if vimeo_src and not video_urls:
        vimeo_id = re.search(r'/video/(\d+)', vimeo_src)
        if vimeo_id:
            vid = vimeo_id.group(1)
            print(f"\nTrying Vimeo config for video {vid}...")
            # Open config URL in new tab using the user's browser (which can access Vimeo)
            driver.execute_script(f"window.open('https://player.vimeo.com/video/{vid}/config', '_blank');")
            time.sleep(10)

            # Switch to new tab
            if len(driver.window_handles) > 1:
                driver.switch_to.window(driver.window_handles[-1])
                time.sleep(5)
                try:
                    body_text = driver.find_element(By.TAG_NAME, "body").text
                    if body_text.startswith("{"):
                        config = json.loads(body_text)
                        # Save config for debugging
                        with open(OUTPUT_DIR / "vimeo_config.json", "w") as f:
                            json.dump(config, f, indent=2)
                        print("Saved Vimeo config!")

                        # Extract progressive mp4 URLs
                        progressive = config.get("request", {}).get("files", {}).get("progressive", [])
                        if progressive:
                            progressive.sort(key=lambda x: x.get("height", 0))
                            for p in progressive:
                                print(f"  {p.get('quality')}: {p.get('url','')[:100]}...")
                            video_urls[progressive[-1]["url"]] = "mp4"

                        # Extract HLS
                        hls = config.get("request", {}).get("files", {}).get("hls", {})
                        if hls:
                            for cdn_name, cdn_info in hls.get("cdns", {}).items():
                                hls_url = cdn_info.get("url", "")
                                if hls_url:
                                    print(f"  HLS ({cdn_name}): {hls_url[:100]}...")
                                    video_urls[hls_url] = "hls"
                    else:
                        print(f"Config page content: {body_text[:300]}")
                except Exception as e:
                    print(f"Config error: {e}")

                # Close config tab, go back
                driver.close()
                driver.switch_to.window(driver.window_handles[0])

    if not video_urls:
        print("\n[FAIL] Could not find any video URLs")
        print("The browser is still open - not closing it.")
        return

    # Pick best URL
    direct_url = None
    for url, t in video_urls.items():
        if t == "mp4":
            direct_url = url
            break
    if not direct_url:
        for url, t in video_urls.items():
            if t == "hls":
                direct_url = url
                break
    if not direct_url:
        direct_url = list(video_urls.keys())[0]

    print(f"\nBest URL: {direct_url[:120]}...")

    # Download
    safe_title = re.sub(r'[<>:"/\\|?*]', '_', title)[:80]
    filename = f"{asset_id}_{safe_title}" if asset_id else safe_title
    output_path = OUTPUT_DIR / f"{filename}.mp4"

    if ".m3u8" in direct_url or "master.json" in direct_url:
        import subprocess
        cmd = ["yt-dlp", "--no-check-certificates",
               "--referer", "https://player.vimeo.com/",
               "-f", "bestvideo+bestaudio/best",
               "--merge-output-format", "mp4",
               "-o", str(output_path), direct_url]
        print(f"Running yt-dlp...")
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300,
                          encoding="utf-8", errors="replace")
        print(r.stdout[-500:] if r.stdout else "")
        if r.returncode != 0:
            print(f"Error: {(r.stderr or '')[-300:]}")
    else:
        import requests
        headers = {"Referer": "https://player.vimeo.com/",
                   "Origin": "https://player.vimeo.com",
                   "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"}
        print("Downloading direct MP4...")
        resp = requests.get(direct_url, headers=headers, stream=True, timeout=120)
        if resp.status_code == 200:
            total = int(resp.headers.get("content-length", 0))
            dl = 0
            with open(output_path, "wb") as f:
                for chunk in resp.iter_content(65536):
                    f.write(chunk)
                    dl += len(chunk)
                    if total:
                        print(f"\r  {dl*100//total}% ({dl//1024//1024}MB/{total//1024//1024}MB)", end="", flush=True)
            print()
        else:
            print(f"HTTP {resp.status_code}")
            return

    if output_path.exists() and output_path.stat().st_size > 10000:
        mb = output_path.stat().st_size / 1024 / 1024
        print(f"\n[OK] {output_path.name} ({mb:.1f} MB)")
        # ffprobe
        import subprocess
        try:
            p = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json",
                               "-show_streams", str(output_path)],
                              capture_output=True, text=True, timeout=10,
                              encoding="utf-8", errors="replace")
            if p.returncode == 0:
                for s in json.loads(p.stdout).get("streams", []):
                    if s.get("codec_type") == "video":
                        print(f"  Video: {s.get('width')}x{s.get('height')} {s.get('codec_name')}")
                    elif s.get("codec_type") == "audio":
                        print(f"  Audio: {s.get('codec_name')} {s.get('sample_rate')}Hz")
        except Exception:
            pass
    else:
        print("\n[FAIL] File missing or too small")

    print("\nBrowser is still open - not closing it.")


if __name__ == "__main__":
    main()
