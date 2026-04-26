# -*- coding: utf-8 -*-
"""Infer visual asset needs from a 3-level blueprint.

This is the clean visual-need stage used by the current asset pipeline:
blueprint logic segment -> visible nouns/actions -> visual_need.json.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

sys.stdout.reconfigure(encoding="utf-8")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bp", required=True, help="Input blueprint.json")
    ap.add_argument("--out", required=True, help="Output visual_needs.json")
    ap.add_argument("--model", default="sonnet", help="Claude CLI model name")
    ap.add_argument("--claude-cmd", default="claude")
    ap.add_argument("--batch-size", type=int, default=6)
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--overwrite", action="store_true")
    return ap.parse_args()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def clean_text(value: Any, limit: int = 700) -> str:
    text = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    text = re.sub(r"\s+", " ", text)
    if len(text) > limit:
        return text[: limit - 3] + "..."
    return text


def atom_text(atom: dict) -> str:
    return str(atom.get("subtitle_text") or atom.get("text") or "")


def atom_is_keep(atom: dict) -> bool:
    return atom.get("status", "keep") == "keep"


def atom_time(atom: dict, key: str) -> float:
    time_data = atom.get("time") or {}
    if isinstance(time_data, dict) and key in time_data:
        return float(time_data[key])
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
        for segment in scene.get("logic_segments", []):
            atoms = [a for a in segment.get("atoms", []) if atom_is_keep(a)]
            if not atoms:
                atoms = segment.get("atoms", [])
            if not atoms:
                continue
            flat.append(
                {
                    "seg_id": segment.get("id"),
                    "bp_title": title,
                    "scene_id": scene_id,
                    "scene_title": scene_title,
                    "view": scene.get("view"),
                    "template": segment.get("template"),
                    "transition_type": segment.get("transition_type"),
                    "items": [str(item.get("text", "")) for item in segment.get("items", [])],
                    "atoms_text": "".join(atom_text(a) for a in atoms),
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
    match = re.search(r"(\{.*\}|\[.*\])", raw, re.S)
    if not match:
        raise ValueError(f"no JSON found in Claude output: {raw[:240]}")
    return json.loads(match.group(1))


def run_claude_json(prompt: str, claude_cmd: str, model: str, timeout: int = 150) -> Any:
    env = {k: v for k, v in os.environ.items() if not k.startswith("ANTHROPIC_")}
    result = subprocess.run(
        [claude_cmd, "-p", "--output-format", "json", "--model", model, prompt],
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
    for segment in batch:
        rows.append(
            {
                "seg_id": segment["seg_id"],
                "scene_title": segment.get("scene_title", ""),
                "template": segment.get("template", ""),
                "items": segment.get("items", []),
                "doctor_text": clean_text(segment.get("atoms_text", ""), 700),
            }
        )
    return f"""你是医学动画素材匹配系统里的「画面需求改写员」。

任务：把医生口播的 logic segment 改写成可检索素材的画面描述 visual_need。

核心规则：
- 名词主体最重要：解剖结构、病理对象、药物/指标、器械、病变位置要写具体。
- 可见动词其次：沉积、堆积、破裂、形成血栓、堵塞、降低、冲击、变窄、变硬等。
- 不要把「重要、建议、风险、应该、可能、需要、稳住」这类抽象词当成画面动作。
- 不要根据医学常识过度脑补，优先从医生原话里抽取可见名词和可见动作。
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


def normalize_need(segment: dict, need: dict | None) -> dict:
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
        "seg_id": segment["seg_id"],
        "needs_animation": needs_animation,
        "scene_type": str(need.get("scene_type") or "unknown"),
        "visual": visual,
        "subjects": [str(x) for x in subjects if str(x).strip()],
        "actions": [str(x) for x in actions if str(x).strip()],
        "negative": [str(x) for x in negative if str(x).strip()],
        "reason": str(need.get("reason") or ""),
    }


def infer_visual_needs(
    segments: list[dict],
    out_path: Path,
    claude_cmd: str,
    model: str,
    batch_size: int,
    concurrency: int,
    overwrite: bool,
) -> list[dict]:
    if out_path.exists() and not overwrite:
        cached = read_json(out_path)
        rows = cached.get("visual_needs", cached) if isinstance(cached, dict) else cached
        by_id = {str(x.get("seg_id")): x for x in rows if isinstance(x, dict)}
        if all(str(seg["seg_id"]) in by_id for seg in segments):
            print(f"Visual needs: reuse cache {out_path}")
            return [normalize_need(seg, by_id.get(str(seg["seg_id"]))) for seg in segments]

    batches = [segments[i : i + batch_size] for i in range(0, len(segments), batch_size)]
    out_by_id: dict[str, dict] = {}

    def process_batch(batch_index: int, batch: list[dict]) -> list[dict]:
        t0 = time.time()
        try:
            data = run_claude_json(visual_need_prompt(batch), claude_cmd=claude_cmd, model=model)
            if isinstance(data, dict):
                data = data.get("visual_needs") or data.get("items") or data.get("results") or []
            if not isinstance(data, list):
                raise ValueError("visual need output is not a list")
            by_id = {str(x.get("seg_id")): x for x in data if isinstance(x, dict)}
            normalized = [normalize_need(seg, by_id.get(str(seg["seg_id"]))) for seg in batch]
            print(f"  visual_need batch {batch_index + 1}/{len(batches)} ok ({time.time() - t0:.1f}s)")
            return normalized
        except Exception as exc:
            print(f"  visual_need batch {batch_index + 1}/{len(batches)} retry singly: {exc}")
            normalized = []
            for seg in batch:
                try:
                    data = run_claude_json(visual_need_prompt([seg]), claude_cmd=claude_cmd, model=model)
                    if isinstance(data, dict):
                        data = data.get("visual_needs") or data.get("items") or data.get("results") or [data]
                    if not isinstance(data, list):
                        data = []
                    by_id = {str(x.get("seg_id")): x for x in data if isinstance(x, dict)}
                    normalized.append(normalize_need(seg, by_id.get(str(seg["seg_id"]))))
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
            return normalized

    print(f"Inferring visual needs: {len(segments)} segments, batches={len(batches)}, concurrency={concurrency}")
    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as executor:
        futures = [executor.submit(process_batch, i, batch) for i, batch in enumerate(batches)]
        for future in as_completed(futures):
            for need in future.result():
                out_by_id[str(need["seg_id"])] = need

    return [normalize_need(seg, out_by_id.get(str(seg["seg_id"]))) for seg in segments]


def main() -> None:
    args = parse_args()
    segments, title, n_scenes = load_blueprint_segments(Path(args.bp))
    needs = infer_visual_needs(
        segments,
        Path(args.out),
        claude_cmd=args.claude_cmd,
        model=args.model,
        batch_size=args.batch_size,
        concurrency=args.concurrency,
        overwrite=args.overwrite,
    )
    data = {
        "bp_title": title,
        "n_scenes": n_scenes,
        "n_logic_segments": len(segments),
        "n_visual_needs": sum(1 for n in needs if n.get("needs_animation")),
        "method": "claude-visual-need-v1",
        "visual_needs": needs,
    }
    write_json(Path(args.out), data)
    print(f"Visual needs saved: {args.out}")
    print(f"Visual needs: {data['n_visual_needs']} / {len(segments)} logic segments")


if __name__ == "__main__":
    main()
