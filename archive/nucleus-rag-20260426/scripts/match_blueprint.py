# -*- coding: utf-8 -*-
"""
Match blueprint blocks to Nucleus asset library.

Two-stage recall (scene-level → block placement):
  1. Embed scene query (scene_title + concatenated atoms) via Qwen3-Embedding
  2. Score every asset file by mean(top-3 block cosines) → shortlist top-M files per scene
  3. For each logic_segment, retrieve top-K blocks restricted to its scene's shortlisted files
  4. Claude CLI reranks the K candidates → pick best (or pick=0 if none fit)

Usage:
  python match_blueprint.py --bp-merged path/to/blueprint_merged.json --out matches/xxx.json
"""
import argparse, json, os, sys, io, subprocess, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = r'f:/AI total editing/editing V1/scripts'
ASSET_INDEX_DIR = os.path.join(ROOT, 'asset_index')
BLOCKS_PATH = os.path.join(ASSET_INDEX_DIR, 'blocks.jsonl')
EMB_PATH = os.path.join(ASSET_INDEX_DIR, 'embeddings.npy')
ALL_LABELS_PATH = os.path.join(ROOT, 'cluster_atoms', 'step1_all_labels.json')

EMBED_MODEL = 'text-embedding-v4'
EMBED_DIM = 1024
TOP_K = 15
CLAUDE_MODEL = 'sonnet'


def load_asset_index():
    blocks = []
    with open(BLOCKS_PATH, 'r', encoding='utf-8') as f:
        for line in f:
            blocks.append(json.loads(line))
    emb = np.load(EMB_PATH)
    # Only keep is_rep=True rows (current build has everything as rep)
    mask = np.array([b['is_rep'] for b in blocks])
    kept_blocks = [b for b, m in zip(blocks, mask) if m]
    kept_emb = emb[mask]
    # Normalize for cosine
    norms = np.linalg.norm(kept_emb, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    kept_emb = kept_emb / norms
    print(f'Asset index loaded: {len(kept_blocks)} rep blocks, embedding shape {kept_emb.shape}')
    return kept_blocks, kept_emb


def load_blueprint_with_scenes(bp_merged):
    """Load blueprint_merged.json into a scene-grouped structure.

    Returns:
      scenes: list of {scene_id, scene_title, scene_text, segs}
              scene_text = title + concatenation of all logic_seg atoms_text
              segs = list of seg dicts (each with seg_id, atoms_text, time_start/end, etc.)
      flat_segs: flat list of all seg dicts (in order)
    """
    with open(bp_merged, 'r', encoding='utf-8') as f:
        d = json.load(f)
    title = d.get('title', '')
    scenes = []
    flat_segs = []
    for sc in d['scenes']:
        scene_id = sc.get('id')
        scene_title = sc.get('title', '')
        segs = []
        for ls in sc.get('logic_segments', []):
            atoms = ls.get('atoms', [])
            if not atoms:
                continue
            atoms_text = ''.join(a['text'] for a in atoms)
            t_start = atoms[0]['time']['start']
            t_end = atoms[-1]['time']['end']
            seg = {
                'seg_id': ls['id'],
                'bp_title': title,
                'scene_id': scene_id,
                'scene_title': scene_title,
                'view': sc.get('view'),
                'template': ls.get('template'),
                'transition_type': ls.get('transition_type'),
                'items': [it.get('text', '') for it in ls.get('items', [])],
                'atoms_text': atoms_text,
                'time_start': t_start,
                'time_end': t_end,
            }
            segs.append(seg)
            flat_segs.append(seg)
        if not segs:
            continue
        scene_text = scene_title + '：' + ''.join(s['atoms_text'] for s in segs)
        scenes.append({
            'scene_id': scene_id,
            'scene_title': scene_title,
            'scene_text': scene_text,
            'segs': segs,
        })
    print(f'Blueprint "{title}": {len(scenes)} scenes, {len(flat_segs)} logic_segments')
    return scenes, flat_segs, title


def embed_queries(texts):
    from openai import OpenAI
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=r'f:/AI total editing/editing V1/.env')
    client = OpenAI(api_key=os.environ['OPENAI_API_KEY'], base_url=os.environ['OPENAI_BASE_URL'])
    BATCH = 10
    out = np.zeros((len(texts), EMBED_DIM), dtype=np.float32)
    for i in range(0, len(texts), BATCH):
        batch = texts[i:i + BATCH]
        resp = client.embeddings.create(
            model=EMBED_MODEL, input=batch, dimensions=EMBED_DIM, encoding_format='float')
        for j, d in enumerate(resp.data):
            out[i + j] = np.array(d.embedding, dtype=np.float32)
    # Normalize
    norms = np.linalg.norm(out, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return out / norms


def claude_rerank(query_text, candidates):
    """Call claude -p CLI to rerank candidates. Returns {'pick': int (1..K or 0), 'reason': str}."""
    cand_lines = []
    for i, c in enumerate(candidates, 1):
        cand_lines.append(
            f"{i}. [{c['lang']}] [{c['file'][:70]} @ {c['start']:.1f}-{c['end']:.1f}s] {c['text'][:250]}"
        )
    cand_text = '\n'.join(cand_lines)
    prompt = f"""任务：从 {len(candidates)} 个候选中找出和中文稿**描述同一个画面**的医学动画。

中文稿（医生口述的一段）：
{query_text}

候选素材旁白（每条背后都有一段对应的医学动画视频）：
{cand_text}

判断标准：
- 候选旁白和中文稿描述的是同一个视觉内容（同一段医学过程/解剖结构/动作/现象）→ 匹配
- 只是话题相关、领域相近、沾边 → 不算匹配
- 宁缺毋滥：没有真正匹配的就返回 0，不要强行凑

先逐个判断每个候选是否描述同一画面，再决定输出。

输出严格 JSON（不要 markdown 代码块、不要其他文字）：
{{"pick": N}}
N = 匹配的候选编号 1-{len(candidates)}；全都不匹配则 N = 0。"""

    try:
        # Strip ANTHROPIC_* env vars so claude CLI uses its own logged-in session, not the proxy in .env
        sub_env = {k: v for k, v in os.environ.items() if not k.startswith('ANTHROPIC_')}
        result = subprocess.run(
            ['claude', '-p', '--output-format', 'json', '--model', CLAUDE_MODEL, prompt],
            capture_output=True, text=True, encoding='utf-8', timeout=90, env=sub_env,
        )
        # claude CLI sometimes exits rc=1 despite successful output on Windows; parse stdout regardless
        stdout = (result.stdout or '').strip()
        if not stdout:
            return {'pick': 0, 'reason': f'claude empty stdout rc={result.returncode}', '_error': True}
        try:
            outer = json.loads(stdout)
        except json.JSONDecodeError:
            return {'pick': 0, 'reason': f'outer JSON parse failed rc={result.returncode}: {stdout[:150]}', '_error': True}
        if outer.get('is_error'):
            return {'pick': 0, 'reason': f'claude is_error: {outer.get("result", "")[:150]}', '_error': True}
        raw = outer.get('result', '').strip()
        _raw_debug = raw
        # Strip potential ```json fences
        if raw.startswith('```'):
            raw = raw.split('\n', 1)[1].rsplit('```', 1)[0].strip()
            if raw.startswith('json\n'):
                raw = raw[5:]
        # First try strict parse
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
        # Fallback: extract pick/reason via regex (more tolerant of malformed JSON)
        import re
        m_pick = re.search(r'"pick"\s*:\s*(\d+)', raw)
        m_reason = re.search(r'"reason"\s*:\s*"([^"]*)"', raw)
        if m_pick:
            return {'pick': int(m_pick.group(1)),
                    'reason': m_reason.group(1) if m_reason else '(no reason)',
                    '_raw': raw[:300], '_fallback_regex': True}
        # Give up
        raise ValueError(f'no pick found in: {raw[:200]}')
    except subprocess.TimeoutExpired:
        return {'pick': 0, 'reason': 'claude CLI timeout', '_error': True}
    except Exception as e:
        debug = locals().get('_raw_debug', 'no raw')[:500]
        return {'pick': 0, 'reason': f'parse error: {e}', '_raw': debug, '_error': True}


def score_files_for_scene(scene_sim_row, file_to_blocks, top_n=3):
    """For one scene query, score each file by mean of its top-N block cosines."""
    scores = {}
    for fk, idxs in file_to_blocks.items():
        sims = scene_sim_row[idxs]
        if len(sims) <= top_n:
            scores[fk] = float(sims.mean())
        else:
            top = np.partition(sims, -top_n)[-top_n:]
            scores[fk] = float(top.mean())
    return scores


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bp-merged', required=True, help='Path to blueprint_merged.json')
    ap.add_argument('--out', required=True, help='Output match_result.json path')
    ap.add_argument('--top-k', type=int, default=TOP_K, help='Block-level rerank candidates per seg')
    ap.add_argument('--files-per-scene', type=int, default=5, help='Shortlist top-M files per scene')
    ap.add_argument('--top-n-per-file', type=int, default=3, help='top-N blocks to mean for file scoring')
    ap.add_argument('--concurrency', type=int, default=4, help='Parallel claude calls')
    args = ap.parse_args()

    asset_blocks, asset_emb = load_asset_index()
    scenes, flat_segs, bp_title = load_blueprint_with_scenes(args.bp_merged)

    # file_key -> list of block indices in asset_emb
    file_to_blocks = defaultdict(list)
    for i, b in enumerate(asset_blocks):
        file_to_blocks[b['file_key']].append(i)
    file_to_blocks = {k: np.array(v) for k, v in file_to_blocks.items()}
    print(f'Asset library: {len(file_to_blocks)} files')

    # ---- Phase A: scene-level file shortlist ----
    print(f'\nPhase A: embedding {len(scenes)} scene queries...')
    scene_query_emb = embed_queries([s['scene_text'] for s in scenes])
    scene_sim = scene_query_emb @ asset_emb.T  # (n_scenes, n_blocks)

    scene_shortlist = {}  # scene_id -> {file_key: file_score} for top-M
    print(f'\nPhase A: shortlisting top-{args.files_per_scene} files per scene')
    for si, sc in enumerate(scenes):
        scores = score_files_for_scene(scene_sim[si], file_to_blocks, top_n=args.top_n_per_file)
        top_files = sorted(scores.items(), key=lambda x: -x[1])[:args.files_per_scene]
        scene_shortlist[sc['scene_id']] = dict(top_files)
        files_summary = ', '.join(f'{fk[:40]}({sc:.2f})' for fk, sc in top_files[:5])
        print(f"  [{sc['scene_id']}] {sc['scene_title'][:30]}: {files_summary}")

    # ---- Phase B: per-segment block recall within shortlisted files ----
    print(f'\nPhase B: embedding {len(flat_segs)} segment queries...')
    seg_query_emb = embed_queries([s['atoms_text'] for s in flat_segs])
    seg_sim = seg_query_emb @ asset_emb.T  # (n_segs, n_blocks)

    print(f'\nPhase B+C: per-seg restricted recall + claude rerank '
          f'(concurrency={args.concurrency}, top_k={args.top_k})...')

    def rerank_one(qi):
        seg = flat_segs[qi]
        scene_files = scene_shortlist[seg['scene_id']]
        # Pool of candidate block indices restricted to shortlisted files
        pool_idxs = np.concatenate([file_to_blocks[fk] for fk in scene_files.keys()])
        pool_sims = seg_sim[qi, pool_idxs]
        # Top-K within the pool
        k = min(args.top_k, len(pool_idxs))
        top_in_pool = np.argpartition(-pool_sims, k - 1)[:k]
        top_in_pool = top_in_pool[np.argsort(-pool_sims[top_in_pool])]
        cands = []
        for rank, p in enumerate(top_in_pool):
            aidx = int(pool_idxs[p])
            cos = float(pool_sims[p])
            a = asset_blocks[aidx]
            cands.append({
                'rank': rank + 1,
                'cosine': cos,
                'asset_idx': aidx,
                'file': a['file'],
                'file_key': a['file_key'],
                'lang': a['lang'],
                'text': a['text'],
                'start': a['start'],
                'end': a['end'],
                'scene_start': a['scene_start'],
                'mp4_path': a['mp4_path'],
            })
        t0 = time.time()
        rr = claude_rerank(seg['atoms_text'], cands)
        return qi, cands, rr, time.time() - t0

    results = [None] * len(flat_segs)
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = {ex.submit(rerank_one, i): i for i in range(len(flat_segs))}
        for fut in as_completed(futures):
            qi, cands, rr, dt = fut.result()
            seg = flat_segs[qi]
            pick_idx = rr.get('pick', 0)
            picked = cands[pick_idx - 1] if 1 <= pick_idx <= len(cands) else None
            results[qi] = {
                'seg_id': seg['seg_id'],
                'bp_title': seg['bp_title'],
                'scene_id': seg['scene_id'],
                'scene_title': seg['scene_title'],
                'atoms_text': seg['atoms_text'],
                'template': seg['template'],
                'items': seg['items'],
                'time_start': seg['time_start'],
                'time_end': seg['time_end'],
                'pick': pick_idx,
                'rerank_reason': rr.get('reason', ''),
                'rerank_raw': rr.get('_raw', None),
                'picked': picked,
                'candidates_top_k': cands,
                '_rerank_seconds': round(dt, 2),
            }
            mark = 'X ' if pick_idx == 0 else f'#{pick_idx}'
            fname_short = picked['file'][:48] if picked else '(no pick)'
            print(f"  [{seg['seg_id']}] {mark} {fname_short} ({dt:.1f}s) — {rr.get('reason','')[:50]}")

    out_data = {
        'bp_title': bp_title,
        'algo': 'scene-recall-then-block-place',
        'top_k': args.top_k,
        'files_per_scene': args.files_per_scene,
        'n_scenes': len(scenes),
        'n_segs': len(flat_segs),
        'n_picked': sum(1 for r in results if r['pick'] > 0),
        'scene_shortlist': {sid: list(sc.items()) for sid, sc in scene_shortlist.items()},
        'results': results,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or '.', exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(out_data, f, ensure_ascii=False, indent=2)
    print(f'\nSaved: {args.out}')
    print(f'Picked: {out_data["n_picked"]}/{out_data["n_segs"]}')


if __name__ == '__main__':
    main()
