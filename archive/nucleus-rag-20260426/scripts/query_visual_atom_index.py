# -*- coding: utf-8 -*-
"""Query a visual atom index with visual need descriptions.

This is a small audit tool for the new pipeline:
  blueprint visual need -> embedding -> visual_atoms.jsonl retrieval

It deliberately does not use raw narration embeddings.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
EMBED_MODEL = "text-embedding-v4"
EMBED_DIM = 1024


CBJ58_DEMO_QUERIES = [
    {
        "query_id": "S2-L3",
        "doctor_text": "它就是长在血管壁里面的是胆固醇堆积受损的内膜之后慢慢堆出来的外面裹着一层纤维帽",
        "visual_need": {
            "scene_type": "pathology_process",
            "visual": "血管横截面中，LDL或胆固醇颗粒在受损血管内膜/血管壁内沉积堆积，逐渐形成斑块，外层有纤维帽包裹",
            "subjects": ["LDL", "胆固醇", "血管壁", "动脉内膜", "斑块", "纤维帽"],
            "actions": ["沉积", "堆积", "形成", "包裹"],
        },
    },
    {
        "query_id": "S4-L2",
        "doctor_text": "很多心梗的病人血管其实堵的并不严重但斑块突然破了血栓一形成血管就堵死了",
        "visual_need": {
            "scene_type": "pathology_process",
            "visual": "动脉斑块突然破裂，血小板/血凝块在破裂处聚集形成血栓，血管腔被快速堵塞",
            "subjects": ["斑块", "血栓", "血小板", "动脉", "血管腔"],
            "actions": ["破裂", "聚集", "形成血栓", "堵塞"],
        },
    },
    {
        "query_id": "S5-L2",
        "doctor_text": "第一把低密度脂蛋白胆固醇降下来",
        "visual_need": {
            "scene_type": "drug_mechanism",
            "visual": "LDL低密度脂蛋白/坏胆固醇水平下降，血液中的LDL颗粒减少，或图表显示LDL数值降低",
            "subjects": ["LDL", "低密度脂蛋白", "坏胆固醇", "血脂图表"],
            "actions": ["降低", "减少", "下降"],
        },
    },
    {
        "query_id": "S6-L2",
        "doctor_text": "斑块外面就薄薄一层帽子血压高的时候血液冲击力大就像拿着高压水枪冲一面有裂缝的墙迟早会冲破",
        "visual_need": {
            "scene_type": "pathology_process",
            "visual": "高血压导致血流压力增大，强烈血流冲击血管壁和薄纤维帽斑块，斑块被冲击后可能破裂",
            "subjects": ["高血压", "血流", "血管壁", "斑块", "纤维帽"],
            "actions": ["压力升高", "冲击", "冲破", "破裂"],
        },
    },
    {
        "query_id": "S3-L4",
        "doctor_text": "已经钙化变硬的斑块基本缩不了",
        "visual_need": {
            "scene_type": "pathology_process",
            "visual": "钙化斑块在血管壁内变硬，白色钙化沉积使斑块固定，难以缩小或消退",
            "subjects": ["钙化斑块", "血管壁", "钙化沉积"],
            "actions": ["钙化", "变硬", "不缩小"],
        },
    },
    {
        "query_id": "S7-L2",
        "doctor_text": "烟里面的东西会直接让斑块变松散变脆弱",
        "visual_need": {
            "scene_type": "pathology_process",
            "visual": "吸烟产生的有害物质进入血管，损伤血管内皮或斑块结构，使斑块变得不稳定、松散、脆弱",
            "subjects": ["吸烟", "烟草毒素", "血管内皮", "斑块"],
            "actions": ["损伤", "变松散", "变脆弱", "不稳定"],
        },
    },
]


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--visual-atoms", default="scripts/asset_index/visual_atoms_sample_cardiovascular_500.jsonl")
    ap.add_argument("--emb", default="scripts/asset_index/visual_atom_embeddings_sample_cardiovascular_500.npy")
    ap.add_argument("--keys", default="scripts/asset_index/visual_atom_embeddings_sample_cardiovascular_500.keys.json")
    ap.add_argument("--queries-json", help="Optional JSON file containing query objects")
    ap.add_argument("--out-md", default="scripts/matches/cbj58_visual_atom_sample500_recall.md")
    ap.add_argument("--out-csv", default="scripts/matches/cbj58_visual_atom_sample500_recall.csv")
    ap.add_argument("--top-k", type=int, default=8)
    return ap.parse_args()


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


def query_to_text(query: dict) -> str:
    need = query.get("visual_need", {})
    subjects = need.get("subjects", [])
    actions = need.get("actions", [])
    return "\n".join(
        [
            f"scene_type: {need.get('scene_type', '')}",
            f"visual: {need.get('visual', '')}",
            f"subjects: {' '.join(str(x) for x in subjects)}",
            f"actions: {' '.join(str(x) for x in actions)}",
        ]
    )


def embed_texts(texts: list[str]) -> np.ndarray:
    from dotenv import load_dotenv
    from openai import OpenAI

    load_dotenv(dotenv_path=str(ROOT.parent / ".env"))
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


def load_queries(path: str | None) -> list[dict]:
    if not path:
        return CBJ58_DEMO_QUERIES
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    return data.get("queries", [])


def short(value: str, limit: int = 90) -> str:
    value = (value or "").replace("\n", " ").strip()
    return value if len(value) <= limit else value[: limit - 1] + "..."


def main() -> None:
    args = parse_args()
    rows = load_jsonl(Path(args.visual_atoms))
    emb = normalize_matrix(np.load(args.emb))
    keys = json.loads(Path(args.keys).read_text(encoding="utf-8"))

    atom_id_to_row = {int(row["atom_id"]): row for row in rows}
    emb_rows = []
    emb_kept = []
    for i, key in enumerate(keys):
        atom_id = int(key["atom_id"])
        row = atom_id_to_row.get(atom_id)
        if row is None:
            continue
        if float(row.get("visual_confidence") or 0.0) <= 0.0:
            continue
        emb_rows.append(row)
        emb_kept.append(emb[i])
    cand_emb = normalize_matrix(np.vstack(emb_kept))

    queries = load_queries(args.queries_json)
    query_texts = [query_to_text(q) for q in queries]
    query_emb = embed_texts(query_texts)
    sim = query_emb @ cand_emb.T

    all_hits = []
    md = [
        "# cbj58 visual-atom sample500 recall",
        "",
        f"- visual_atoms: `{args.visual_atoms}`",
        f"- candidates: {len(emb_rows)}",
        f"- top_k: {args.top_k}",
        "",
    ]

    for qi, query in enumerate(queries):
        top_k = min(args.top_k, len(emb_rows))
        idxs = np.argpartition(-sim[qi], top_k - 1)[:top_k]
        idxs = idxs[np.argsort(-sim[qi, idxs])]
        md.extend(
            [
                f"## {query['query_id']}",
                "",
                f"- doctor: {query.get('doctor_text', '')}",
                f"- visual_need: {query.get('visual_need', {}).get('visual', '')}",
                "",
            ]
        )
        for rank, idx in enumerate(idxs.tolist(), 1):
            row = emb_rows[idx]
            score = float(sim[qi, idx])
            subjects = " / ".join(
                str(s.get("subject", "")) for s in row.get("primary_subjects", [])[:4] if isinstance(s, dict)
            )
            actions = " / ".join(
                str(a.get("action", "")) for a in row.get("visible_actions", [])[:4] if isinstance(a, dict)
            )
            hit = {
                "query_id": query["query_id"],
                "rank": rank,
                "score": score,
                "atom_id": row.get("atom_id"),
                "file": row.get("file"),
                "start": row.get("start"),
                "end": row.get("end"),
                "scene_type": row.get("visual_scene_type"),
                "confidence": row.get("visual_confidence"),
                "visual_one_line": row.get("visual_one_line"),
                "subjects": subjects,
                "actions": actions,
                "narration_text": row.get("narration_text"),
            }
            all_hits.append(hit)
            md.extend(
                [
                    f"{rank}. score={score:.3f} conf={row.get('visual_confidence')} `{row.get('file')}` "
                    f"{float(row.get('start', 0.0)):.2f}-{float(row.get('end', 0.0)):.2f}s",
                    f"   - visual: {row.get('visual_one_line', '')}",
                    f"   - subjects: {subjects or '-'}",
                    f"   - actions: {actions or '-'}",
                    f"   - narration: {short(row.get('narration_text', ''))}",
                    "",
                ]
            )

    out_md = Path(args.out_md)
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_md.write_text("\n".join(md), encoding="utf-8")

    out_csv = Path(args.out_csv)
    with out_csv.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(all_hits[0].keys()))
        writer.writeheader()
        writer.writerows(all_hits)

    print(f"Saved: {out_md}")
    print(f"Saved: {out_csv}")
    print(f"queries={len(queries)} candidates={len(emb_rows)} hits={len(all_hits)}")


if __name__ == "__main__":
    main()
