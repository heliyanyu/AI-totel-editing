# -*- coding: utf-8 -*-
"""Build a visual-description index from asset atoms.

This is the intended next-generation asset index:

  asset narration atom -> inferred visual subjects/actions/scene -> embedding

The matcher should then compare blueprint visual needs to these visual
descriptions, not raw narration text.

Stages:
  infer : read scripts/asset_index/atoms.jsonl and append visual descriptions to
          scripts/asset_index/visual_atoms.jsonl using claude -p --model sonnet.
  embed : embed visual_atoms.jsonl into visual_atom_embeddings.npy.

Example smoke test:
  python scripts/build_visual_atom_index.py --stage infer --limit 20 --batch-size 5
  python scripts/build_visual_atom_index.py --stage embed
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
ASSET_INDEX_DIR = ROOT / "asset_index"
ATOMS_PATH = ASSET_INDEX_DIR / "atoms.jsonl"
VISUAL_ATOMS_PATH = ASSET_INDEX_DIR / "visual_atoms.jsonl"
VISUAL_EMB_PATH = ASSET_INDEX_DIR / "visual_atom_embeddings.npy"
VISUAL_KEYS_PATH = ASSET_INDEX_DIR / "visual_atom_embeddings.keys.json"

EMBED_MODEL = "text-embedding-v4"
EMBED_DIM = 1024


SYSTEM_PROMPT = """你是医学动画素材库的画面索引员。

你看到的是医学动画素材的文件名、时间段、目标 atom 旁白，以及同一 logic block 的上下文。
任务：把每个目标 atom 转成“画面描述索引”，用于后续素材匹配。

核心原则：
1. 先抽画面主体名词，再抽可见动作动词。
2. 主体优先级：解剖结构、病理对象、药物/器械、医疗操作、人物/生活方式、抽象概念。
3. 动作必须是画面中可能看见的动作/变化，例如：沉积、堆积、破裂、形成、堵塞、扩张、插入、切除、降低、流动。
4. 不要把“风险、重要、建议、控制、应该、可能”这类抽象话术当成画面动作。
5. 如果旁白只是建议/风险/总结，没有明确可见医学主体，visual_confidence 不要超过 0.45。
6. 可基于“医学动画通常旁白和画面同步”做合理推断，但必须标注 explicitness：
   - explicit：旁白明确说到了这个主体/动作
   - inferred：旁白没直接说画面，但根据文件名和上下文合理推断
   - uncertain：不确定，可能只是旁白话题
7. 不要发散，不要补不存在的医学细节。
8. JSON 字符串内部不要使用英文双引号；如需引用原话，用中文引号「」。

输出严格 JSON，不要 markdown，不要解释。
"""


USER_TEMPLATE = """请为下面 {n_items} 个素材 atom 分别生成画面描述索引。

输入 JSON:
{items_json}

输出格式严格如下：
{{
  "items": [
    {{
      "atom_id": 0,
      "visual_scene_type": "pathology_process|anatomy_structure|drug_mechanism|procedure|test|lifestyle|generic_advice|transition|unknown",
      "visual_one_line": "一句画面语言描述，只写画面看见什么",
      "primary_subjects": [
        {{
          "subject": "画面主体名词",
          "category": "anatomy|pathology|drug|device|procedure|person|lifestyle|abstract",
          "explicitness": "explicit|inferred|uncertain",
          "confidence": 0.0,
          "evidence": "旁白/文件名证据"
        }}
      ],
      "secondary_subjects": [],
      "visible_actions": [
        {{
          "action": "可见动作动词",
          "actor": "动作发出者",
          "target": "动作对象",
          "explicitness": "explicit|inferred|uncertain",
          "confidence": 0.0,
          "evidence": "旁白/上下文证据"
        }}
      ],
      "good_for_queries": ["适合匹配的画面需求"],
      "bad_for_queries": ["不适合匹配的画面需求"],
      "visual_confidence": 0.0,
      "uncertainties": ["不确定点"]
    }}
  ]
}}

要求：
- 每个输入 atom_id 必须输出一条。
- visual_one_line 必须是画面描述，不要写成医学解释文案。
- 主体名词比动作更重要；没有主体时不要强行补动作。
"""


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["infer", "embed", "all"], required=True)
    ap.add_argument("--atoms", default=str(ATOMS_PATH))
    ap.add_argument("--out", default=str(VISUAL_ATOMS_PATH))
    ap.add_argument("--emb-out", default=str(VISUAL_EMB_PATH))
    ap.add_argument("--keys-out", default=str(VISUAL_KEYS_PATH))
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--concurrency", type=int, default=1)
    ap.add_argument("--limit", type=int, default=0, help="Max new atoms to infer; 0 = no limit")
    ap.add_argument("--start-atom-id", type=int, default=0)
    ap.add_argument(
        "--file-contains",
        default="",
        help="Comma-separated substrings; keep atoms whose file/file_key contains any term.",
    )
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--embed-batch-size", type=int, default=32)
    ap.add_argument("--embed-concurrency", type=int, default=6)
    return ap.parse_args()


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            row.setdefault("atom_id", i)
            rows.append(row)
    return rows


def load_existing_atom_ids(path: Path) -> set[int]:
    if not path.exists():
        return set()
    seen: set[int] = set()
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "atom_id" in row:
                seen.add(int(row["atom_id"]))
    return seen


def build_block_text(atoms: list[dict]) -> dict[str, str]:
    per_block: dict[str, list[str]] = {}
    for a in atoms:
        key = str(a.get("logic_block_id") or "")
        per_block.setdefault(key, []).append(str(a.get("text") or "").strip())
    return {key: " ".join(x for x in texts if x) for key, texts in per_block.items()}


def build_context_items(batch: list[dict], block_text_by_id: dict[str, str]) -> list[dict]:
    items = []
    for a in batch:
        block_id = str(a.get("logic_block_id") or "")
        items.append(
            {
                "atom_id": int(a["atom_id"]),
                "asset_file": a.get("file", ""),
                "time_range": f"{float(a.get('start', 0.0)):.2f}-{float(a.get('end', 0.0)):.2f}s",
                "language": a.get("lang", ""),
                "target_atom": a.get("text", ""),
                "logic_block_context": block_text_by_id.get(block_id, a.get("text", "")),
            }
        )
    return items


def strip_code_fence(raw: str) -> str:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        if raw.startswith("json\n"):
            raw = raw[5:].strip()
    return raw


def parse_claude_stdout(stdout: str) -> dict:
    text = (stdout or "").strip()
    if "hit your limit" in text.lower():
        raise RuntimeError("RATE_LIMIT: claude output contains hit your limit")
    outer = json.loads(text)
    if outer.get("is_error"):
        result = str(outer.get("result") or "")
        if "hit your limit" in result.lower():
            raise RuntimeError("RATE_LIMIT: claude output contains hit your limit")
        raise RuntimeError(result[:1000])
    raw = strip_code_fence(str(outer.get("result") or ""))
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            return json.loads(raw[start : end + 1])
        raise


def call_claude_for_batch(batch: list[dict], block_text_by_id: dict[str, str], model: str, timeout: int = 180) -> list[dict]:
    items = build_context_items(batch, block_text_by_id)
    prompt = SYSTEM_PROMPT + "\n\n" + USER_TEMPLATE.format(
        n_items=len(items),
        items_json=json.dumps(items, ensure_ascii=False, indent=2),
    )
    sub_env = {k: v for k, v in os.environ.items() if not k.startswith("ANTHROPIC_")}
    t0 = time.time()
    result = subprocess.run(
        ["claude", "-p", "--output-format", "json", "--model", model, prompt],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=timeout,
        env=sub_env,
    )
    if result.returncode != 0 and not result.stdout:
        stderr = result.stderr or ""
        if "hit your limit" in stderr.lower():
            raise RuntimeError("RATE_LIMIT: claude stderr contains hit your limit")
        raise RuntimeError(stderr[:1000])
    parsed = parse_claude_stdout(result.stdout)
    outputs = parsed.get("items")
    if not isinstance(outputs, list):
        raise RuntimeError("Claude response missing items list")
    by_id = {int(item.get("atom_id")): item for item in outputs if "atom_id" in item}
    missing = [int(a["atom_id"]) for a in batch if int(a["atom_id"]) not in by_id]
    if missing:
        raise RuntimeError(f"Claude response missing atom_ids: {missing[:20]}")

    enriched = []
    source_by_id = {int(a["atom_id"]): a for a in batch}
    for atom_id in [int(a["atom_id"]) for a in batch]:
        src = source_by_id[atom_id]
        item = normalize_visual_item(by_id[atom_id])
        search_text = build_visual_search_text(item)
        enriched.append(
            {
                "atom_id": atom_id,
                "file_key": src.get("file_key"),
                "file": src.get("file"),
                "mp4_path": src.get("mp4_path"),
                "lang": src.get("lang"),
                "subset": src.get("subset"),
                "logic_block_id": src.get("logic_block_id"),
                "start": src.get("start"),
                "end": src.get("end"),
                "narration_text": src.get("text"),
                "visual_scene_type": item["visual_scene_type"],
                "visual_one_line": item["visual_one_line"],
                "primary_subjects": item["primary_subjects"],
                "secondary_subjects": item["secondary_subjects"],
                "visible_actions": item["visible_actions"],
                "good_for_queries": item["good_for_queries"],
                "bad_for_queries": item["bad_for_queries"],
                "visual_confidence": item["visual_confidence"],
                "uncertainties": item["uncertainties"],
                "visual_search_text": search_text,
                "_infer_seconds": round(time.time() - t0, 2),
            }
        )
    return enriched


def fallback_visual_row(src: dict, reason: str) -> dict:
    item = {
        "visual_scene_type": "unknown",
        "visual_one_line": "",
        "primary_subjects": [],
        "secondary_subjects": [],
        "visible_actions": [],
        "good_for_queries": [],
        "bad_for_queries": [],
        "visual_confidence": 0.0,
        "uncertainties": [reason[:300]],
    }
    return {
        "atom_id": int(src["atom_id"]),
        "file_key": src.get("file_key"),
        "file": src.get("file"),
        "mp4_path": src.get("mp4_path"),
        "lang": src.get("lang"),
        "subset": src.get("subset"),
        "logic_block_id": src.get("logic_block_id"),
        "start": src.get("start"),
        "end": src.get("end"),
        "narration_text": src.get("text"),
        "visual_scene_type": item["visual_scene_type"],
        "visual_one_line": item["visual_one_line"],
        "primary_subjects": item["primary_subjects"],
        "secondary_subjects": item["secondary_subjects"],
        "visible_actions": item["visible_actions"],
        "good_for_queries": item["good_for_queries"],
        "bad_for_queries": item["bad_for_queries"],
        "visual_confidence": item["visual_confidence"],
        "uncertainties": item["uncertainties"],
        "visual_search_text": build_visual_search_text(item),
        "_infer_seconds": 0.0,
        "_infer_error": reason[:500],
    }


def safe_call_claude_for_batch(batch: list[dict], block_text_by_id: dict[str, str], model: str) -> list[dict]:
    try:
        return call_claude_for_batch(batch, block_text_by_id, model)
    except Exception as exc:
        message = str(exc)
        if "RATE_LIMIT" in message:
            raise
        if len(batch) <= 1:
            print(f"  [WARN] visual infer fallback atom_id={batch[0].get('atom_id')}: {message[:160]}")
            return [fallback_visual_row(batch[0], message)]
        print(
            f"  [WARN] visual infer batch failed; retry singly "
            f"atom_ids={int(batch[0]['atom_id'])}-{int(batch[-1]['atom_id'])}: {message[:160]}"
        )
        rows: list[dict] = []
        for item in batch:
            rows.extend(safe_call_claude_for_batch([item], block_text_by_id, model))
        return rows


def normalize_visual_item(item: dict) -> dict:
    def list_value(name: str) -> list:
        value = item.get(name, [])
        return value if isinstance(value, list) else []

    return {
        "visual_scene_type": str(item.get("visual_scene_type") or "unknown"),
        "visual_one_line": str(item.get("visual_one_line") or "").strip(),
        "primary_subjects": list_value("primary_subjects"),
        "secondary_subjects": list_value("secondary_subjects"),
        "visible_actions": list_value("visible_actions"),
        "good_for_queries": [str(x) for x in list_value("good_for_queries")],
        "bad_for_queries": [str(x) for x in list_value("bad_for_queries")],
        "visual_confidence": float(item.get("visual_confidence") or 0.0),
        "uncertainties": [str(x) for x in list_value("uncertainties")],
    }


def subject_text(subjects: list[dict]) -> str:
    out = []
    for s in subjects:
        if isinstance(s, dict):
            val = str(s.get("subject") or "").strip()
        else:
            val = str(s).strip()
        if val:
            out.append(val)
    return " ".join(out)


def action_text(actions: list[dict]) -> str:
    out = []
    for a in actions:
        if isinstance(a, dict):
            bits = [a.get("actor"), a.get("action"), a.get("target")]
            val = " ".join(str(x).strip() for x in bits if str(x or "").strip())
        else:
            val = str(a).strip()
        if val:
            out.append(val)
    return " ".join(out)


def build_visual_search_text(item: dict) -> str:
    parts = [
        f"scene_type: {item.get('visual_scene_type', '')}",
        f"visual: {item.get('visual_one_line', '')}",
        f"subjects: {subject_text(item.get('primary_subjects', []))} {subject_text(item.get('secondary_subjects', []))}",
        f"actions: {action_text(item.get('visible_actions', []))}",
        f"good_for: {' / '.join(item.get('good_for_queries', []))}",
    ]
    return "\n".join(p for p in parts if p.strip())


def run_infer(args: argparse.Namespace) -> None:
    atoms_path = Path(args.atoms)
    out_path = Path(args.out)
    atoms = load_jsonl(atoms_path)
    block_text_by_id = build_block_text(atoms)
    existing = set() if args.overwrite else load_existing_atom_ids(out_path)

    targets = []
    needles = [x.strip() for x in args.file_contains.split(",") if x.strip()]
    for a in atoms:
        atom_id = int(a["atom_id"])
        if atom_id < args.start_atom_id:
            continue
        if atom_id in existing:
            continue
        file_text = f"{a.get('file', '')} {a.get('file_key', '')}"
        if needles and not any(needle in file_text for needle in needles):
            continue
        targets.append(a)
        if args.limit and len(targets) >= args.limit:
            break

    print(f"Atoms total={len(atoms)} existing_visual={len(existing)} targets={len(targets)}")
    if not targets:
        return

    if args.overwrite and out_path.exists():
        out_path.unlink()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    batches = [targets[i : i + args.batch_size] for i in range(0, len(targets), args.batch_size)]
    done = 0
    t0 = time.time()
    with out_path.open("a", encoding="utf-8") as f:
        if args.concurrency <= 1:
            for batch in batches:
                rows = safe_call_claude_for_batch(batch, block_text_by_id, args.model)
                for row in rows:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
                f.flush()
                done += len(rows)
                print_progress(done, len(targets), t0)
        else:
            with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
                futures = {ex.submit(safe_call_claude_for_batch, batch, block_text_by_id, args.model): batch for batch in batches}
                for fut in as_completed(futures):
                    rows = fut.result()
                    rows.sort(key=lambda x: int(x["atom_id"]))
                    for row in rows:
                        f.write(json.dumps(row, ensure_ascii=False) + "\n")
                    f.flush()
                    done += len(rows)
                    print_progress(done, len(targets), t0)


def print_progress(done: int, total: int, t0: float) -> None:
    elapsed = max(0.001, time.time() - t0)
    rate = done / elapsed
    eta = (total - done) / rate if rate > 0 else 0
    print(f"  visual inferred {done}/{total} ({rate:.2f} atom/s, ETA {eta:.0f}s)")


def _embed_batch(client, texts: list[str], max_retries: int = 3) -> list[list[float] | None]:
    for attempt in range(max_retries):
        try:
            resp = client.embeddings.create(
                model=EMBED_MODEL,
                input=texts,
                dimensions=EMBED_DIM,
                encoding_format="float",
            )
            return [d.embedding for d in resp.data]
        except Exception as e:
            if attempt == max_retries - 1:
                print(f"embed failed after {max_retries}: {e}")
                return [None] * len(texts)
            time.sleep(2**attempt)
    return [None] * len(texts)


def run_embed(args: argparse.Namespace) -> None:
    from dotenv import load_dotenv
    from openai import OpenAI

    load_dotenv(dotenv_path=str(ROOT.parent / ".env"))
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"], base_url=os.environ["OPENAI_BASE_URL"])

    visual_path = Path(args.out)
    rows = load_jsonl(visual_path)
    rows.sort(key=lambda x: int(x["atom_id"]))
    texts = [str(r.get("visual_search_text") or r.get("visual_one_line") or r.get("narration_text") or "") for r in rows]
    n = len(rows)
    emb = np.zeros((n, EMBED_DIM), dtype=np.float32)
    batches = [(i, texts[i : i + args.embed_batch_size]) for i in range(0, n, args.embed_batch_size)]
    print(f"Embedding visual atoms: n={n}, batches={len(batches)}, concurrency={args.embed_concurrency}")

    done = 0
    failed = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.embed_concurrency) as ex:
        futures = {ex.submit(_embed_batch, client, batch): (i, len(batch)) for i, batch in batches}
        for fut in as_completed(futures):
            i, blen = futures[fut]
            vectors = fut.result()
            for j, v in enumerate(vectors):
                if v is None:
                    failed += 1
                else:
                    emb[i + j] = np.asarray(v, dtype=np.float32)
            done += blen
            if done % 1000 == 0 or done == n:
                print_progress(done, n, t0)

    emb_path = Path(args.emb_out)
    emb_path.parent.mkdir(parents=True, exist_ok=True)
    np.save(emb_path, emb)
    keys = [{"row": i, "atom_id": int(r["atom_id"])} for i, r in enumerate(rows)]
    Path(args.keys_out).write_text(json.dumps(keys, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved: {emb_path} shape={emb.shape} failed={failed}")
    print(f"Saved: {args.keys_out}")


def main() -> None:
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    args = parse_args()
    if args.stage in ("infer", "all"):
        run_infer(args)
    if args.stage in ("embed", "all"):
        run_embed(args)


if __name__ == "__main__":
    main()
