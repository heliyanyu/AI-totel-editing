# -*- coding: utf-8 -*-
"""Match blueprint logic segments to visual_atoms by visual descriptions.

Pipeline:
  1. Use Claude CLI to convert each blueprint logic segment into a visual need.
  2. Embed those visual needs.
  3. Retrieve from visual_atoms.jsonl embeddings.
  4. Use Claude CLI to rerank top visual candidates.

The output intentionally follows the JSON shape accepted by
scripts/generate-draft-from-matches.py.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
EMBED_MODEL = "text-embedding-v4"
EMBED_DIM = 1024
DEFAULT_ACCEPTED_MATCH_TYPES = {
    "same_visual_process",
    "same_visual_object",
    "direct_medical_action",
}


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bp-merged", required=True)
    ap.add_argument("--visual-atoms", default="scripts/asset_index/visual_atoms_sample_cardiovascular_500.jsonl")
    ap.add_argument("--emb", default="scripts/asset_index/visual_atom_embeddings_sample_cardiovascular_500.npy")
    ap.add_argument("--keys", default="scripts/asset_index/visual_atom_embeddings_sample_cardiovascular_500.keys.json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--needs-cache")
    ap.add_argument("--model", default="sonnet")
    ap.add_argument("--need-batch-size", type=int, default=6)
    ap.add_argument("--need-concurrency", type=int, default=8)
    ap.add_argument("--rerank-concurrency", type=int, default=8)
    ap.add_argument("--top-atoms", type=int, default=80)
    ap.add_argument("--top-segments", type=int, default=10)
    ap.add_argument("--max-per-file", type=int, default=2)
    ap.add_argument("--min-visual-confidence", type=float, default=0.45)
    ap.add_argument("--min-fit-score", type=float, default=0.72)
    ap.add_argument("--min-cosine", type=float, default=0.0)
    ap.add_argument("--min-candidate-dur", type=float, default=5.0)
    ap.add_argument("--max-candidate-dur", type=float, default=10.0)
    ap.add_argument("--max-gap", type=float, default=2.2)
    ap.add_argument("--no-rerank", action="store_true")
    ap.add_argument("--overwrite-needs", action="store_true")
    return ap.parse_args()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def normalize_matrix(arr: np.ndarray) -> np.ndarray:
    arr = np.asarray(arr, dtype=np.float32)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return arr / norms


def clean_for_prompt(value: str, limit: int = 600) -> str:
    value = (value or "").replace("\n", " ").strip()
    return value if len(value) <= limit else value[: limit - 1] + "…"


def atom_text(atom: dict) -> str:
    return str(atom.get("subtitle_text") or atom.get("text") or "")


def atom_is_keep(atom: dict) -> bool:
    return atom.get("status", "keep") == "keep"


def atom_time(atom: dict, key: str) -> float:
    t = atom.get("time") or {}
    if isinstance(t, dict) and key in t:
        return float(t[key])
    fallback = "start_ms" if key == "start" else "end_ms"
    if fallback in atom:
        return float(atom[fallback]) / 1000.0
    return 0.0


def load_blueprint_segments(path: Path) -> tuple[list[dict], str, int]:
    bp = read_json(path)
    title = bp.get("title", "")
    flat = []
    for scene in bp.get("scenes", []):
        scene_id = scene.get("id", "")
        scene_title = scene.get("title", "")
        for ls in scene.get("logic_segments", []):
            atoms = [a for a in ls.get("atoms", []) if atom_is_keep(a)]
            if not atoms:
                atoms = ls.get("atoms", [])
            if not atoms:
                continue
            text = "".join(atom_text(a) for a in atoms)
            flat.append(
                {
                    "seg_id": ls.get("id"),
                    "bp_title": title,
                    "scene_id": scene_id,
                    "scene_title": scene_title,
                    "view": scene.get("view"),
                    "template": ls.get("template"),
                    "transition_type": ls.get("transition_type"),
                    "items": [str(it.get("text", "")) for it in ls.get("items", [])],
                    "atoms_text": text,
                    "time_start": atom_time(atoms[0], "start"),
                    "time_end": atom_time(atoms[-1], "end"),
                }
            )
    return flat, title, len(bp.get("scenes", []))


def strip_json_fence(raw: str) -> str:
    raw = (raw or "").strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        if raw.startswith("json\n"):
            raw = raw[5:].strip()
    return raw


def parse_jsonish(raw: str) -> Any:
    raw = strip_json_fence(raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    m = re.search(r"(\{.*\}|\[.*\])", raw, re.S)
    if not m:
        raise ValueError(f"no JSON found in: {raw[:200]}")
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        if re.search(r'["“]?pick["”]?\s*[:：]\s*\d+', raw):
            pick_m = re.search(r'["“]?pick["”]?\s*[:：]\s*(\d+)', raw)
            fit_m = re.search(r'["“]?fit_score["”]?\s*[:：]\s*([0-9.]+)', raw)
            type_m = re.search(r'["“]?match_type["”]?\s*[:：]\s*["“]([^"”]+)', raw)
            reason_m = re.search(r'["“]?reason["”]?\s*[:：]\s*["“]([^"”]+)', raw)
            return {
                "pick": int(pick_m.group(1)) if pick_m else 0,
                "fit_score": float(fit_m.group(1)) if fit_m else 0.0,
                "match_type": type_m.group(1) if type_m else "none",
                "reason": reason_m.group(1) if reason_m else raw[:160],
                "missing": [],
            }
        raise


def run_claude_json(prompt: str, model: str, timeout: int = 120) -> Any:
    env = {k: v for k, v in os.environ.items() if not k.startswith("ANTHROPIC_")}
    result = subprocess.run(
        ["claude", "-p", "--output-format", "json", "--model", model, prompt],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=timeout,
        env=env,
    )
    stdout = (result.stdout or "").strip()
    if not stdout:
        raise RuntimeError(f"claude empty stdout rc={result.returncode}: {(result.stderr or '')[:300]}")
    outer = json.loads(stdout)
    if outer.get("is_error"):
        raise RuntimeError(f"claude is_error: {outer.get('result', '')[:300]}")
    return parse_jsonish(outer.get("result", ""))


def visual_need_prompt(batch: list[dict]) -> str:
    rows = []
    for seg in batch:
        rows.append(
            {
                "seg_id": seg["seg_id"],
                "scene_title": seg.get("scene_title", ""),
                "template": seg.get("template", ""),
                "items": seg.get("items", []),
                "doctor_text": clean_for_prompt(seg.get("atoms_text", ""), 700),
            }
        )
    return f"""你是医学动画素材匹配系统里的「画面需求改写员」。

任务：把医生口播的 logic segment 改写成可检索素材的画面描述 visual_need。

核心规则：
- 名词主体最重要：解剖结构、病理对象、药物/指标、器械、病变位置要写具体。
- 可见动词其次：沉积、堆积、破裂、形成血栓、堵塞、降低、冲击、变窄、变硬等。
- 不要把「重要、建议、风险、应该、可能、需要、稳住」这类抽象词当成画面动作。
- 如果这一段只是开场提问、观点、总结、生活建议、情绪表达、泛泛风险提醒，needs_animation=false。
- 如果需要素材，visual 必须描述“画面里看得见什么”，而不是复述医生话术。

输出严格 JSON 数组。每个输入都必须输出一条，字段如下：
[
  {{
    "seg_id": "S1-L1",
    "needs_animation": true,
    "scene_type": "pathology_process|anatomy_structure|drug_mechanism|procedure|test|lifestyle|generic_advice|transition|unknown",
    "visual": "一句具体画面描述",
    "subjects": ["主体名词1", "主体名词2"],
    "actions": ["可见动作1", "可见动作2"],
    "negative": ["不应该匹配的画面"],
    "reason": "一句简短理由"
  }}
]

待处理 segments：
{json.dumps(rows, ensure_ascii=False, indent=2)}
"""


def normalize_need(seg: dict, need: dict | None) -> dict:
    need = need or {}
    subjects = need.get("subjects", [])
    actions = need.get("actions", [])
    negative = need.get("negative", [])
    if isinstance(subjects, str):
        subjects = [subjects]
    if isinstance(actions, str):
        actions = [actions]
    if isinstance(negative, str):
        negative = [negative]
    visual = str(need.get("visual") or "").strip()
    needs_animation = bool(need.get("needs_animation")) and bool(visual)
    return {
        "seg_id": seg["seg_id"],
        "needs_animation": needs_animation,
        "scene_type": str(need.get("scene_type") or "unknown"),
        "visual": visual,
        "subjects": [str(x) for x in subjects if str(x).strip()],
        "actions": [str(x) for x in actions if str(x).strip()],
        "negative": [str(x) for x in negative if str(x).strip()],
        "reason": str(need.get("reason") or ""),
    }


def infer_visual_needs(
    segs: list[dict],
    cache_path: Path,
    model: str,
    batch_size: int,
    concurrency: int,
    overwrite: bool,
) -> list[dict]:
    if cache_path.exists() and not overwrite:
        cached = read_json(cache_path)
        by_id = {x["seg_id"]: x for x in cached.get("visual_needs", cached)}
        if all(seg["seg_id"] in by_id for seg in segs):
            print(f"Visual needs: reuse cache {cache_path}")
            return [normalize_need(seg, by_id.get(seg["seg_id"])) for seg in segs]

    batches = [segs[i : i + batch_size] for i in range(0, len(segs), batch_size)]
    out_by_id: dict[str, dict] = {}

    def process_batch(batch_index: int, batch: list[dict]) -> tuple[int, list[dict]]:
        t0 = time.time()
        try:
            data = run_claude_json(visual_need_prompt(batch), model=model, timeout=150)
            if isinstance(data, dict):
                data = data.get("visual_needs") or data.get("items") or data.get("results") or []
            if not isinstance(data, list):
                raise ValueError("visual need output is not a list")
            by_id = {str(x.get("seg_id")): x for x in data if isinstance(x, dict)}
            normalized = [normalize_need(seg, by_id.get(seg["seg_id"])) for seg in batch]
            print(f"  visual_need batch {batch_index + 1}/{len(batches)} ok ({time.time() - t0:.1f}s)")
            return batch_index, normalized
        except Exception as exc:
            print(f"  visual_need batch {batch_index + 1}/{len(batches)} retry singly: {exc}")
            normalized = []
            for seg in batch:
                try:
                    data = run_claude_json(visual_need_prompt([seg]), model=model, timeout=150)
                    if isinstance(data, dict):
                        data = data.get("visual_needs") or data.get("items") or data.get("results") or [data]
                    if not isinstance(data, list):
                        data = []
                    by_id = {str(x.get("seg_id")): x for x in data if isinstance(x, dict)}
                    normalized.append(normalize_need(seg, by_id.get(seg["seg_id"])))
                except Exception as inner_exc:
                    print(f"    visual_need {seg['seg_id']} fallback: {inner_exc}")
                    normalized.append(
                        normalize_need(
                            seg,
                            {
                                "seg_id": seg["seg_id"],
                                "needs_animation": False,
                                "scene_type": "unknown",
                                "visual": "",
                                "subjects": [],
                                "actions": [],
                                "negative": [],
                                "reason": "visual need inference failed",
                            },
                        )
                    )
            return batch_index, normalized

    print(f"Inferring visual needs: {len(segs)} segs, batches={len(batches)}, concurrency={concurrency}")
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = {ex.submit(process_batch, i, b): i for i, b in enumerate(batches)}
        for fut in as_completed(futures):
            _, needs = fut.result()
            for need in needs:
                out_by_id[need["seg_id"]] = need

    needs = [normalize_need(seg, out_by_id.get(seg["seg_id"])) for seg in segs]
    write_json(cache_path, {"visual_needs": needs})
    print(f"Visual needs saved: {cache_path}")
    return needs


def need_to_text(need: dict) -> str:
    return "\n".join(
        [
            f"scene_type: {need.get('scene_type', '')}",
            f"visual: {need.get('visual', '')}",
            "subjects: " + " ".join(str(x) for x in need.get("subjects", [])),
            "actions: " + " ".join(str(x) for x in need.get("actions", [])),
        ]
    )


def embed_texts(texts: list[str]) -> np.ndarray:
    from dotenv import load_dotenv
    from openai import OpenAI

    load_dotenv(dotenv_path=str(REPO_ROOT / ".env"))
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"], base_url=os.environ["OPENAI_BASE_URL"])
    out = np.zeros((len(texts), EMBED_DIM), dtype=np.float32)
    for i in range(0, len(texts), 10):
        batch = texts[i : i + 10]
        resp = client.embeddings.create(
            model=EMBED_MODEL,
            input=batch,
            dimensions=EMBED_DIM,
            encoding_format="float",
        )
        for j, item in enumerate(resp.data):
            out[i + j] = np.asarray(item.embedding, dtype=np.float32)
    return normalize_matrix(out)


def subject_text(row: dict, limit: int = 4) -> str:
    vals = []
    for item in row.get("primary_subjects", []) + row.get("secondary_subjects", []):
        if isinstance(item, dict) and item.get("subject"):
            vals.append(str(item["subject"]))
    return " / ".join(vals[:limit])


def action_text(row: dict, limit: int = 4) -> str:
    vals = []
    for item in row.get("visible_actions", []):
        if isinstance(item, dict) and item.get("action"):
            actor = str(item.get("actor") or "").strip()
            action = str(item.get("action") or "").strip()
            target = str(item.get("target") or "").strip()
            vals.append(" ".join(x for x in [actor, action, target] if x))
    return " / ".join(vals[:limit])


def build_visual_candidate_index(
    rows: list[dict],
    emb: np.ndarray,
    keys: list[dict],
    min_confidence: float,
) -> tuple[list[dict], np.ndarray, dict[str, list[dict]]]:
    by_atom_id = {int(row["atom_id"]): row for row in rows}
    kept_rows = []
    kept_emb = []
    for i, key in enumerate(keys):
        atom_id = int(key["atom_id"])
        row = by_atom_id.get(atom_id)
        if row is None:
            continue
        if float(row.get("visual_confidence") or 0.0) < min_confidence:
            continue
        kept_rows.append(row)
        kept_emb.append(emb[i])
    if not kept_rows:
        raise RuntimeError("No visual atom candidates after confidence filtering.")
    by_file: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_file[str(row.get("file_key") or row.get("file"))].append(row)
    for file_key in by_file:
        by_file[file_key].sort(key=lambda r: float(r.get("start") or 0.0))
    return kept_rows, normalize_matrix(np.vstack(kept_emb)), by_file


def expand_visual_atom(row: dict, rows_by_file: dict[str, list[dict]], args: argparse.Namespace) -> dict:
    file_key = str(row.get("file_key") or row.get("file"))
    file_rows = rows_by_file.get(file_key, [row])
    pos_by_id = {int(r["atom_id"]): i for i, r in enumerate(file_rows)}
    pos = pos_by_id.get(int(row["atom_id"]), 0)
    lo = hi = pos
    start = float(file_rows[lo].get("start") or 0.0)
    end = float(file_rows[hi].get("end") or start)

    def dur() -> float:
        return max(0.0, end - start)

    while dur() < args.min_candidate_dur:
        left_ok = lo > 0 and start - float(file_rows[lo - 1].get("end") or 0.0) <= args.max_gap
        right_ok = hi + 1 < len(file_rows) and float(file_rows[hi + 1].get("start") or 0.0) - end <= args.max_gap
        if not left_ok and not right_ok:
            break
        left_gap = start - float(file_rows[lo - 1].get("end") or 0.0) if left_ok else 999.0
        right_gap = float(file_rows[hi + 1].get("start") or 0.0) - end if right_ok else 999.0
        if left_gap <= right_gap:
            new_start = float(file_rows[lo - 1].get("start") or start)
            if end - new_start > args.max_candidate_dur:
                left_ok = False
            else:
                lo -= 1
                start = new_start
        if (not left_ok or left_gap > right_gap) and right_ok:
            new_end = float(file_rows[hi + 1].get("end") or end)
            if new_end - start > args.max_candidate_dur:
                right_ok = False
            else:
                hi += 1
                end = new_end
        if not left_ok and not right_ok:
            break

    picked_rows = file_rows[lo : hi + 1]
    visuals = [str(r.get("visual_one_line") or "") for r in picked_rows if r.get("visual_one_line")]
    narrations = [str(r.get("narration_text") or "") for r in picked_rows if r.get("narration_text")]
    return {
        "file_key": file_key,
        "start": round(start, 3),
        "end": round(end, 3),
        "text": "；".join(visuals),
        "narration_text": "".join(narrations),
        "atom_indices": [int(r["atom_id"]) for r in picked_rows],
        "lang": row.get("lang"),
        "file": row.get("file"),
        "mp4_path": row.get("mp4_path"),
        "visual_one_line": str(row.get("visual_one_line") or ""),
        "visual_scene_type": row.get("visual_scene_type"),
        "visual_confidence": row.get("visual_confidence"),
        "subjects": subject_text(row),
        "actions": action_text(row),
    }


def retrieve_candidates_for_need(
    sim_row: np.ndarray,
    visual_rows: list[dict],
    rows_by_file: dict[str, list[dict]],
    args: argparse.Namespace,
) -> list[dict]:
    k = min(args.top_atoms, len(visual_rows))
    idxs = np.argpartition(-sim_row, k - 1)[:k]
    idxs = idxs[np.argsort(-sim_row[idxs])]
    candidates = []
    seen = set()
    per_file_count: dict[str, int] = defaultdict(int)
    for idx in idxs.tolist():
        row = visual_rows[idx]
        cand = expand_visual_atom(row, rows_by_file, args)
        cand["cosine"] = float(sim_row[idx])
        file_key = str(cand.get("file_key") or cand.get("file"))
        if per_file_count[file_key] >= args.max_per_file:
            continue
        key = (cand.get("mp4_path"), round(float(cand["start"]), 2), round(float(cand["end"]), 2))
        if key in seen:
            continue
        seen.add(key)
        per_file_count[file_key] += 1
        candidates.append(cand)
        if len(candidates) >= args.top_segments:
            break
    for rank, cand in enumerate(candidates, 1):
        cand["rank"] = rank
    return candidates


def normalize_rerank(data: dict | None) -> dict:
    data = data or {}
    missing = data.get("missing", [])
    if isinstance(missing, str):
        missing = [missing]
    if not isinstance(missing, list):
        missing = []
    try:
        pick = int(data.get("pick") or 0)
    except (TypeError, ValueError):
        pick = 0
    try:
        fit_score = float(data.get("fit_score") or 0.0)
    except (TypeError, ValueError):
        fit_score = 0.0
    return {
        "pick": pick,
        "fit_score": fit_score,
        "match_type": str(data.get("match_type") or "none"),
        "reason": str(data.get("reason") or ""),
        "missing": [str(x) for x in missing],
    }


def rerank_prompt(seg: dict, need: dict, candidates: list[dict]) -> str:
    cand_lines = []
    for i, c in enumerate(candidates, 1):
        cand_lines.append(
            "\n".join(
                [
                    f"{i}. [{c.get('file')} @ {float(c.get('start', 0.0)):.2f}-{float(c.get('end', 0.0)):.2f}s] cosine={float(c.get('cosine', 0.0)):.3f}",
                    f"   visual: {clean_for_prompt(c.get('text') or c.get('visual_one_line', ''), 300)}",
                    f"   subjects: {clean_for_prompt(c.get('subjects', ''), 180)}",
                    f"   actions: {clean_for_prompt(c.get('actions', ''), 180)}",
                    f"   narration: {clean_for_prompt(c.get('narration_text', ''), 180)}",
                ]
            )
        )
    return f"""任务：从候选医学动画片段中，选择最符合当前画面需求的一条。

医生原话：
{seg.get("atoms_text", "")}

当前画面需求：
scene_type: {need.get("scene_type", "")}
visual: {need.get("visual", "")}
subjects: {" / ".join(need.get("subjects", []))}
actions: {" / ".join(need.get("actions", []))}
不要匹配: {" / ".join(need.get("negative", []))}

候选素材画面描述：
{chr(10).join(cand_lines)}

判定标准：
- 优先看画面主体名词是否一致，其次看可见动作是否一致。
- 必须是同一类可见医学画面，不能只因为话题相关就选。
- 这是素材匹配预览草稿，不是最终成片审片：如果没有完美候选，但候选已经包含主名词和主动作，可以选择最可用的一条，并在 missing 里说明缺少的细节。
- 只有主体或病理阶段明显错误时才 pick=0；不要因为缺少纤维帽厚薄、数值标签、精确百分比等次要细节就完全拒绝。
- 如果需求是“斑块破裂形成血栓”，候选必须有破裂/血小板/血凝块/堵塞等核心画面。
- 如果需求是“LDL/胆固醇沉积形成斑块”，候选必须有 LDL、胆固醇、血管壁、斑块沉积等核心画面。
- 如果所有候选都不合适，pick=0。

match_type 只能是：
- same_visual_process
- same_visual_object
- direct_medical_action
- supporting_context
- related_topic
- generic_advice
- none

前三类且 fit_score>=0.72 可以 pick 非 0；部分可用但缺细节的候选可给 0.72-0.82。
输出严格 JSON：
{{"pick": 0, "fit_score": 0.0, "match_type": "none", "reason": "简短理由", "missing": ["缺失的关键画面元素"]}}
"""


def rerank_one(seg: dict, need: dict, candidates: list[dict], model: str) -> dict:
    if not need.get("needs_animation"):
        return normalize_rerank(
            {
                "pick": 0,
                "fit_score": 0.0,
                "match_type": "generic_advice",
                "reason": need.get("reason") or "不需要素材画面",
                "missing": [],
            }
        )
    if not candidates:
        return normalize_rerank(
            {
                "pick": 0,
                "fit_score": 0.0,
                "match_type": "none",
                "reason": "没有召回候选",
                "missing": [need.get("visual", "")],
            }
        )
    try:
        data = run_claude_json(rerank_prompt(seg, need, candidates), model=model, timeout=150)
        return normalize_rerank(data)
    except Exception as exc:
        return normalize_rerank(
            {
                "pick": 0,
                "fit_score": 0.0,
                "match_type": "none",
                "reason": f"rerank error: {exc}",
                "missing": [],
            }
        )


def acceptance_reject_reason(
    rr: dict,
    picked: dict | None,
    min_fit_score: float,
    min_cosine: float,
) -> str:
    if not picked:
        return "no valid pick"
    if rr.get("fit_score", 0.0) < min_fit_score:
        return f"fit_score {rr.get('fit_score', 0.0):.2f} < {min_fit_score:.2f}"
    if rr.get("match_type") not in DEFAULT_ACCEPTED_MATCH_TYPES:
        return f"match_type {rr.get('match_type')} not accepted"
    if float(picked.get("cosine") or 0.0) < min_cosine:
        return f"cosine {float(picked.get('cosine') or 0.0):.2f} < {min_cosine:.2f}"
    return ""


def main() -> None:
    args = parse_args()
    bp_path = Path(args.bp_merged)
    out_path = Path(args.out)
    needs_cache = Path(args.needs_cache) if args.needs_cache else out_path.with_suffix(".visual_needs.json")

    segs, bp_title, n_scenes = load_blueprint_segments(bp_path)
    print(f'Blueprint "{bp_title}": {n_scenes} scenes, {len(segs)} logic_segments')

    needs = infer_visual_needs(
        segs,
        needs_cache,
        model=args.model,
        batch_size=args.need_batch_size,
        concurrency=args.need_concurrency,
        overwrite=args.overwrite_needs,
    )
    need_by_id = {n["seg_id"]: n for n in needs}
    need_count = sum(1 for n in needs if n.get("needs_animation"))
    print(f"Visual needs needing animation: {need_count}/{len(needs)}")

    rows = load_jsonl(Path(args.visual_atoms))
    emb = normalize_matrix(np.load(args.emb))
    keys = read_json(Path(args.keys))
    visual_rows, visual_emb, rows_by_file = build_visual_candidate_index(
        rows, emb, keys, min_confidence=args.min_visual_confidence
    )
    print(f"Visual atom candidates: {len(visual_rows)} / {len(rows)}")

    query_texts = [need_to_text(need_by_id[seg["seg_id"]]) for seg in segs]
    print(f"Embedding {len(query_texts)} visual needs...")
    query_emb = embed_texts(query_texts)
    sim = query_emb @ visual_emb.T

    candidates_by_seg: dict[str, list[dict]] = {}
    for qi, seg in enumerate(segs):
        need = need_by_id[seg["seg_id"]]
        if not need.get("needs_animation"):
            candidates_by_seg[seg["seg_id"]] = []
            continue
        candidates_by_seg[seg["seg_id"]] = retrieve_candidates_for_need(
            sim[qi], visual_rows, rows_by_file, args
        )

    print(
        f"Reranking candidates: concurrency={args.rerank_concurrency}, "
        f"enabled={not args.no_rerank}"
    )
    rr_by_seg: dict[str, dict] = {}
    if args.no_rerank:
        for seg in segs:
            candidates = candidates_by_seg.get(seg["seg_id"], [])
            pick = 1 if candidates and need_by_id[seg["seg_id"]].get("needs_animation") else 0
            rr_by_seg[seg["seg_id"]] = normalize_rerank(
                {
                    "pick": pick,
                    "fit_score": float(candidates[0]["cosine"]) if pick else 0.0,
                    "match_type": "same_visual_process" if pick else "none",
                    "reason": "embedding top-1",
                    "missing": [],
                }
            )
    else:
        with ThreadPoolExecutor(max_workers=args.rerank_concurrency) as ex:
            futures = {}
            for seg in segs:
                need = need_by_id[seg["seg_id"]]
                candidates = candidates_by_seg.get(seg["seg_id"], [])
                futures[ex.submit(rerank_one, seg, need, candidates, args.model)] = seg
            done = 0
            for fut in as_completed(futures):
                seg = futures[fut]
                rr_by_seg[seg["seg_id"]] = fut.result()
                done += 1
                if done % 8 == 0 or done == len(futures):
                    print(f"  rerank {done}/{len(futures)}")

    results = []
    accepted = 0
    for seg in segs:
        need = need_by_id[seg["seg_id"]]
        candidates = candidates_by_seg.get(seg["seg_id"], [])
        rr = rr_by_seg.get(seg["seg_id"], normalize_rerank(None))
        raw_pick = int(rr.get("pick") or 0)
        raw_picked = candidates[raw_pick - 1] if 1 <= raw_pick <= len(candidates) else None
        reject_reason = acceptance_reject_reason(rr, raw_picked, args.min_fit_score, args.min_cosine)
        picked = None if reject_reason else raw_picked
        if picked:
            accepted += 1
        results.append(
            {
                "seg_id": seg["seg_id"],
                "bp_title": seg["bp_title"],
                "scene_id": seg["scene_id"],
                "scene_title": seg["scene_title"],
                "atoms_text": seg["atoms_text"],
                "template": seg["template"],
                "items": seg["items"],
                "time_start": seg["time_start"],
                "time_end": seg["time_end"],
                "needs_animation": bool(need.get("needs_animation")),
                "visual_need": need,
                "raw_pick": raw_pick,
                "pick": raw_pick if picked else 0,
                "accepted": bool(picked),
                "reject_reason": reject_reason,
                "fit_score": rr.get("fit_score", 0.0),
                "match_type": rr.get("match_type", "none"),
                "missing": rr.get("missing", []),
                "rerank_reason": rr.get("reason", ""),
                "picked": picked,
                "rejected_picked": raw_picked if not picked else None,
                "candidates_top_segments": candidates,
            }
        )

    data = {
        "bp_title": bp_title,
        "algo": "blueprint-visual-need-to-visual-atoms-sample500",
        "params": {
            "visual_atoms": str(Path(args.visual_atoms)),
            "emb": str(Path(args.emb)),
            "top_atoms": args.top_atoms,
            "top_segments": args.top_segments,
            "max_per_file": args.max_per_file,
            "min_visual_confidence": args.min_visual_confidence,
            "min_fit_score": args.min_fit_score,
            "min_cosine": args.min_cosine,
            "rerank": not args.no_rerank,
        },
        "n_scenes": n_scenes,
        "n_segs": len(segs),
        "n_visual_needs": need_count,
        "n_picked": accepted,
        "results": results,
    }
    write_json(out_path, data)
    print(f"Saved matches: {out_path}")
    print(f"Accepted picks: {accepted}/{len(segs)}")
    for r in results:
        if r.get("accepted") and r.get("picked"):
            p = r["picked"]
            print(
                f"  {r['seg_id']} -> {p.get('file')} "
                f"[{float(p.get('start', 0.0)):.2f}-{float(p.get('end', 0.0)):.2f}s] "
                f"fit={float(r.get('fit_score') or 0.0):.2f}"
            )


if __name__ == "__main__":
    main()
