# -*- coding: utf-8 -*-
"""
Infer visual subjects/actions from asset atom narration candidates.

This is a diagnostic tool for checking whether narration-derived visual
descriptions are useful enough before we build a full visual RAG index.
"""
import argparse
import json
import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


PROMPT_TEMPLATE = """你是医学动画素材库的“画面索引员”。

你看到的不是视频画面，而是某个素材片段的文件名、时间段和旁白 atoms。
任务不是写文案，而是判断：这个片段最可能展示了哪些“画面主体”和“可见动作”。

请严格遵守：
1. 先抽画面主体名词，再抽可见动作动词。
2. 主体优先级：解剖结构、病理对象、药物/器械、医疗操作、人物/生活方式、抽象概念。
3. 动作必须是画面中可能看见的动作/变化，例如：沉积、堆积、破裂、形成、堵塞、扩张、插入、切除、降低、流动。
4. 不要把“风险、重要、建议、控制、应该、可能”这类抽象话术当成画面动作。
5. 如果旁白只是在讲建议/风险/总结，没有明确可见医学主体，overall_visual_confidence 不要超过 0.45。
6. 你可以基于“医学动画通常旁白和画面同步”做合理推断，但必须标注 explicitness:
   - explicit：旁白明确说到了这个主体/动作
   - inferred：旁白没直接说画面，但根据文件名和上下文合理推断
   - uncertain：不确定，可能只是旁白话题
7. evidence 必须来自输入旁白或文件名，简短即可。
8. 不要发散，不要补不存在的医学细节。
9. JSON 字符串内部不要使用英文双引号；如需引用原话，用中文引号「」。

输入：
asset_file: {asset_file}
time_range: {start:.2f}-{end:.2f}s
narration_atoms:
{narration}

输出严格 JSON，不要 markdown，不要解释：
{{
  "asset_file": "{asset_file}",
  "time_range": "{start:.2f}-{end:.2f}s",
  "narration_summary": "一句话概括旁白在讲什么",
  "primary_visual_subjects": [
    {{
      "subject": "画面主体名词",
      "category": "anatomy|pathology|drug|device|procedure|person|lifestyle|abstract",
      "explicitness": "explicit|inferred|uncertain",
      "confidence": 0.0,
      "evidence": "旁白或文件名证据"
    }}
  ],
  "secondary_visual_subjects": [],
  "visible_actions": [
    {{
      "action": "可见动作动词",
      "actor": "动作发出者",
      "target": "动作对象",
      "explicitness": "explicit|inferred|uncertain",
      "confidence": 0.0,
      "evidence": "旁白或文件名证据"
    }}
  ],
  "visual_scene": {{
    "type": "pathology_process|anatomy_structure|drug_mechanism|procedure|test|lifestyle|generic_advice|unknown",
    "one_line": "用画面语言描述这个片段最可能是什么画面"
  }},
  "good_for_logic_queries": ["适合匹配的蓝图画面需求"],
  "bad_for_logic_queries": ["不适合匹配的蓝图画面需求"],
  "overall_visual_confidence": 0.0,
  "uncertainties": ["不确定点"]
}}"""


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--matches", default="scripts/matches/cbj58_atom_global_diverse_sonnet.json")
    ap.add_argument("--out", default="scripts/matches/cbj58_asset_atom_visual_inference_samples.json")
    ap.add_argument("--seg-ids", default="")
    ap.add_argument("--top-candidates", type=int, default=3)
    ap.add_argument("--max-samples", type=int, default=12)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--model", default="sonnet")
    return ap.parse_args()


def sample_candidates(matches, seg_ids, top_candidates, max_samples):
    wanted = {x.strip() for x in seg_ids.split(",") if x.strip()}
    samples = []
    seen = set()
    for result in matches.get("results", []):
        if wanted and result.get("seg_id") not in wanted:
            continue
        for candidate in (result.get("candidates_top_segments") or [])[:top_candidates]:
            key = (
                candidate.get("file"),
                round(float(candidate.get("start", 0.0)), 2),
                round(float(candidate.get("end", 0.0)), 2),
            )
            if key in seen:
                continue
            seen.add(key)
            samples.append({
                "seg_id": result.get("seg_id"),
                "doctor_text": result.get("atoms_text", ""),
                "candidate_rank": candidate.get("rank"),
                "candidate_cosine": candidate.get("cosine"),
                "candidate": candidate,
            })
            if len(samples) >= max_samples:
                return samples
    return samples


def parse_claude_stdout(stdout):
    outer = json.loads((stdout or "").strip())
    if outer.get("is_error"):
        raise RuntimeError(outer.get("result", "")[:500])
    raw = (outer.get("result") or "").strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        if raw.startswith("json\n"):
            raw = raw[5:]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            return json.loads(raw[start:end + 1])
        raise


def infer_one(sample, model):
    candidate = sample["candidate"]
    prompt = PROMPT_TEMPLATE.format(
        asset_file=candidate.get("file", ""),
        start=float(candidate.get("start", 0.0)),
        end=float(candidate.get("end", 0.0)),
        narration=candidate.get("text", ""),
    )
    sub_env = {k: v for k, v in os.environ.items() if not k.startswith("ANTHROPIC_")}
    t0 = time.time()
    result = subprocess.run(
        ["claude", "-p", "--output-format", "json", "--model", model, prompt],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=90,
        env=sub_env,
    )
    if result.returncode != 0 and not result.stdout:
        raise RuntimeError(result.stderr[:500])
    parsed = parse_claude_stdout(result.stdout)
    return {
        "seg_id": sample["seg_id"],
        "doctor_text": sample["doctor_text"],
        "candidate_rank": sample["candidate_rank"],
        "candidate_cosine": sample["candidate_cosine"],
        "candidate_file": candidate.get("file"),
        "candidate_start": candidate.get("start"),
        "candidate_end": candidate.get("end"),
        "candidate_text": candidate.get("text", ""),
        "inference_seconds": round(time.time() - t0, 2),
        "visual_inference": parsed,
    }


def main():
    args = parse_args()
    matches = json.loads(Path(args.matches).read_text(encoding="utf-8"))
    samples = sample_candidates(matches, args.seg_ids, args.top_candidates, args.max_samples)
    print(f"Samples: {len(samples)}")

    outputs = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = {ex.submit(infer_one, sample, args.model): sample for sample in samples}
        for fut in as_completed(futures):
            sample = futures[fut]
            try:
                item = fut.result()
                outputs.append(item)
                vi = item["visual_inference"]
                subjects = ",".join(s.get("subject", "") for s in vi.get("primary_visual_subjects", [])[:3])
                actions = ",".join(a.get("action", "") for a in vi.get("visible_actions", [])[:3])
                print(
                    f"[OK] {item['seg_id']} #{item['candidate_rank']} "
                    f"{item['candidate_file']} subjects={subjects} actions={actions} "
                    f"conf={vi.get('overall_visual_confidence')}"
                )
            except Exception as e:
                outputs.append({
                    "seg_id": sample["seg_id"],
                    "candidate_rank": sample["candidate_rank"],
                    "candidate_file": sample["candidate"].get("file"),
                    "candidate_text": sample["candidate"].get("text", ""),
                    "error": str(e),
                })
                print(f"[ERR] {sample['seg_id']} #{sample['candidate_rank']}: {e}")

    outputs.sort(key=lambda x: (str(x.get("seg_id")), int(x.get("candidate_rank") or 0)))
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(outputs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved: {out_path}")


if __name__ == "__main__":
    main()
