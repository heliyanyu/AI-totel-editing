# -*- coding: utf-8 -*-
"""
Match blueprint (logic_segment level) to Nucleus asset library (atom level).

Why atom-level recall:
  A 20s block that mixes 4 concepts ("纤维盖子稳" + "动脉变窄" + "血流降" + "供氧不足")
  averages into a diluted vector — no single concept's signal dominates, so queries
  asking about "纤维帽" miss this block entirely. Atoms are ~1.6s each, one idea per
  vector, so the "纤维帽" atom keeps a clean signal.

Pipeline:
  Phase A — Scene-level file shortlist (uses BLOCK index, coarser is fine for file agg):
    scene_query = title + all seg atoms_text
    score every file by mean(top-3 block cosines), keep top-M files per scene
  Phase B — Per-seg atom recall (restricted to scene's shortlisted files):
    embed seg.atoms_text, cosine over atoms in pool, take top-K atoms
    aggregate adjacent atoms per file (gap<2s, ≥2 atoms) into candidate segments
  Phase C — Claude CLI reranks candidate segments ("same picture" standard).

Usage:
  python match_blueprint_atom.py --bp-merged path/to/blueprint_merged.json --out matches/xxx.json
"""
import argparse, json, os, sys, io, subprocess, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = r'f:/AI total editing/editing V1/scripts'
ASSET_INDEX_DIR = os.path.join(ROOT, 'asset_index')
BLOCKS_PATH = os.path.join(ASSET_INDEX_DIR, 'blocks.jsonl')
BLOCK_EMB_PATH = os.path.join(ASSET_INDEX_DIR, 'embeddings.npy')
ATOMS_PATH = os.path.join(ASSET_INDEX_DIR, 'atoms.jsonl')
ATOM_EMB_PATH = os.path.join(ASSET_INDEX_DIR, 'atom_embeddings.npy')

EMBED_MODEL = 'text-embedding-v4'
EMBED_DIM = 1024
CLAUDE_MODEL = 'sonnet'
DEFAULT_ACCEPTED_MATCH_TYPES = {
    'same_visual_process',
    'same_visual_object',
    'direct_medical_action',
}


def load_block_index():
    blocks = []
    with open(BLOCKS_PATH, 'r', encoding='utf-8') as f:
        for line in f:
            blocks.append(json.loads(line))
    emb = np.load(BLOCK_EMB_PATH)
    mask = np.array([b['is_rep'] for b in blocks])
    kept_blocks = [b for b, m in zip(blocks, mask) if m]
    kept_emb = emb[mask]
    norms = np.linalg.norm(kept_emb, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    kept_emb = kept_emb / norms
    print(f'Block index: {len(kept_blocks)} rep blocks, shape {kept_emb.shape}')
    return kept_blocks, kept_emb


def load_atom_index():
    atoms = []
    with open(ATOMS_PATH, 'r', encoding='utf-8') as f:
        for line in f:
            atoms.append(json.loads(line))
    emb = np.load(ATOM_EMB_PATH)
    # Skip zero rows (failed embeddings)
    norms = np.linalg.norm(emb, axis=1, keepdims=True)
    zero_mask = (norms.squeeze() == 0)
    if zero_mask.any():
        print(f'  WARN: {zero_mask.sum()} atoms have zero embedding — excluded from recall')
    norms[zero_mask] = 1.0
    emb = emb / norms
    # Zero rows become all-zero (cosine always 0), never selected — OK
    print(f'Atom index: {len(atoms)} atoms, shape {emb.shape}')
    return atoms, emb


def load_blueprint_with_scenes(bp_merged):
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
            bp_atoms = ls.get('atoms', [])
            if not bp_atoms:
                continue
            atoms_text = ''.join(a['text'] for a in bp_atoms)
            t_start = bp_atoms[0]['time']['start']
            t_end = bp_atoms[-1]['time']['end']
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
    norms = np.linalg.norm(out, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return out / norms


def score_files_for_scene(scene_sim_row, file_to_blocks, top_n=3):
    scores = {}
    for fk, idxs in file_to_blocks.items():
        sims = scene_sim_row[idxs]
        if len(sims) <= top_n:
            scores[fk] = float(sims.mean())
        else:
            top = np.partition(sims, -top_n)[-top_n:]
            scores[fk] = float(top.mean())
    return scores


def aggregate_atoms_into_segments(top_atom_idxs, cosines, atoms, file_to_atoms_sorted,
                                  max_gap=2.0, min_atoms=2, min_dur=3.0, max_per_file=2):
    """Group temporally-adjacent top atoms (same file, gap<max_gap) into segments.
    Short clusters (<min_dur) get padded with neighboring atoms from the same file.
    """
    per_file = defaultdict(list)  # fk -> [(atom_idx, cos)]
    for ai, cos in zip(top_atom_idxs, cosines):
        fk = atoms[ai]['file_key']
        per_file[fk].append((int(ai), float(cos)))

    segments = []
    for fk, items in per_file.items():
        items.sort(key=lambda x: atoms[x[0]]['start'])
        clusters = []
        cur = [items[0]]
        for itm in items[1:]:
            prev_end = atoms[cur[-1][0]]['end']
            cur_start = atoms[itm[0]]['start']
            if cur_start - prev_end < max_gap:
                cur.append(itm)
            else:
                clusters.append(cur)
                cur = [itm]
        clusters.append(cur)

        file_atoms = file_to_atoms_sorted[fk]  # np.array of atom idx sorted by start
        ai_to_pos = {int(ai): pos for pos, ai in enumerate(file_atoms)}

        for cluster in clusters:
            if len(cluster) < min_atoms:
                continue
            atom_idxs = [x[0] for x in cluster]
            cluster_cosines = [x[1] for x in cluster]
            mean_cos = sum(cluster_cosines) / len(cluster_cosines)
            seg_start = min(atoms[ai]['start'] for ai in atom_idxs)
            seg_end = max(atoms[ai]['end'] for ai in atom_idxs)

            if seg_end - seg_start < min_dur:
                positions = sorted(ai_to_pos[ai] for ai in atom_idxs)
                lo, hi = positions[0], positions[-1]
                # Greedy: extend right, then left, until min_dur reached or no room
                for _ in range(20):  # cap to prevent runaway
                    if seg_end - seg_start >= min_dur:
                        break
                    extended = False
                    if hi + 1 < len(file_atoms):
                        nxt = int(file_atoms[hi + 1])
                        if atoms[nxt]['start'] - seg_end < max_gap * 2:
                            atom_idxs.append(nxt)
                            seg_end = max(seg_end, atoms[nxt]['end'])
                            hi += 1
                            extended = True
                    if seg_end - seg_start >= min_dur:
                        break
                    if lo > 0:
                        prv = int(file_atoms[lo - 1])
                        if seg_start - atoms[prv]['end'] < max_gap * 2:
                            atom_idxs.append(prv)
                            seg_start = min(seg_start, atoms[prv]['start'])
                            lo -= 1
                            extended = True
                    if not extended:
                        break

            atom_idxs.sort(key=lambda ai: atoms[ai]['start'])
            text = ''.join(atoms[ai]['text'] for ai in atom_idxs)
            a0 = atoms[atom_idxs[0]]
            segments.append({
                'file_key': fk,
                'cosine': mean_cos,
                'n_hit_atoms': len(cluster),
                'n_total_atoms': len(atom_idxs),
                'start': seg_start,
                'end': seg_end,
                'text': text,
                'atom_indices': atom_idxs,
                'lang': a0['lang'],
                'file': a0['file'],
                'mp4_path': a0['mp4_path'],
            })

    # Cap max_per_file (keep best by cosine)
    segments.sort(key=lambda s: -s['cosine'])
    per_file_count = defaultdict(int)
    final = []
    for s in segments:
        if per_file_count[s['file_key']] < max_per_file:
            per_file_count[s['file_key']] += 1
            final.append(s)
    return final


def claude_rerank_legacy(query_text, candidates):
    cand_lines = []
    for i, c in enumerate(candidates, 1):
        cand_lines.append(
            f"{i}. [{c['lang']}] [{c['file'][:70]} @ {c['start']:.1f}-{c['end']:.1f}s] {c['text'][:300]}"
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
        sub_env = {k: v for k, v in os.environ.items() if not k.startswith('ANTHROPIC_')}
        result = subprocess.run(
            ['claude', '-p', '--output-format', 'json', '--model', CLAUDE_MODEL, prompt],
            capture_output=True, text=True, encoding='utf-8', timeout=90, env=sub_env,
        )
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
        if raw.startswith('```'):
            raw = raw.split('\n', 1)[1].rsplit('```', 1)[0].strip()
            if raw.startswith('json\n'):
                raw = raw[5:]
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
        import re
        m_pick = re.search(r'"pick"\s*:\s*(\d+)', raw)
        m_reason = re.search(r'"reason"\s*:\s*"([^"]*)"', raw)
        if m_pick:
            return {'pick': int(m_pick.group(1)),
                    'reason': m_reason.group(1) if m_reason else '',
                    '_raw': raw[:300], '_fallback_regex': True}
        raise ValueError(f'no pick found in: {raw[:200]}')
    except subprocess.TimeoutExpired:
        return {'pick': 0, 'reason': 'claude CLI timeout', '_error': True}
    except Exception as e:
        debug = locals().get('_raw_debug', 'no raw')[:500]
        return {'pick': 0, 'reason': f'parse error: {e}', '_raw': debug, '_error': True}


def parse_accepted_match_types(value):
    if not value:
        return set(DEFAULT_ACCEPTED_MATCH_TYPES)
    return {x.strip() for x in value.split(',') if x.strip()}


def coerce_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def coerce_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_rerank_result(data):
    data = data or {}
    missing = data.get('missing', [])
    if isinstance(missing, str):
        missing = [missing]
    if not isinstance(missing, list):
        missing = []
    return {
        **data,
        'pick': coerce_int(data.get('pick'), 0),
        'fit_score': coerce_float(data.get('fit_score'), 0.0),
        'match_type': str(data.get('match_type') or 'none').strip(),
        'reason': str(data.get('reason') or ''),
        'missing': [str(x) for x in missing],
    }


def parse_rerank_raw(raw):
    raw = (raw or '').strip()
    raw_debug = raw
    if raw.startswith('```'):
        raw = raw.split('\n', 1)[1].rsplit('```', 1)[0].strip()
        if raw.startswith('json\n'):
            raw = raw[5:]
    try:
        return normalize_rerank_result(json.loads(raw))
    except json.JSONDecodeError:
        pass

    import re
    m_pick = re.search(r'"pick"\s*:\s*(\d+)', raw)
    m_fit = re.search(r'"fit_score"\s*:\s*([0-9.]+)', raw)
    m_type = re.search(r'"match_type"\s*:\s*"([^"]*)"', raw)
    m_reason = re.search(r'"reason"\s*:\s*"([^"]*)"', raw)
    if m_pick:
        return normalize_rerank_result({
            'pick': int(m_pick.group(1)),
            'fit_score': float(m_fit.group(1)) if m_fit else 0.0,
            'match_type': m_type.group(1) if m_type else 'none',
            'reason': m_reason.group(1) if m_reason else '',
            '_raw': raw_debug[:500],
            '_fallback_regex': True,
        })
    raise ValueError(f'no pick found in: {raw_debug[:200]}')


def acceptance_reject_reason(rr, picked, min_fit_score, accepted_match_types, min_cosine):
    if not picked:
        return 'no valid pick'
    if rr.get('fit_score', 0.0) < min_fit_score:
        return f"fit_score {rr.get('fit_score', 0.0):.2f} < {min_fit_score:.2f}"
    if rr.get('match_type') not in accepted_match_types:
        return f"match_type {rr.get('match_type')} not accepted"
    if picked.get('cosine', 0.0) < min_cosine:
        return f"cosine {picked.get('cosine', 0.0):.2f} < {min_cosine:.2f}"
    return ''


def claude_rerank(query_text, candidates):
    cand_lines = []
    for i, c in enumerate(candidates, 1):
        cand_lines.append(
            f"{i}. [{c['lang']}] [{c['file'][:70]} @ {c['start']:.1f}-{c['end']:.1f}s] {c['text'][:300]}"
        )
    cand_text = '\n'.join(cand_lines)
    prompt = f"""任务：从 {len(candidates)} 个候选中找出和中文稿描述同一个可见医学画面的动画片段。
中文稿（医生口播的一段）：{query_text}

候选素材旁白（每条背后都有对应医学动画画面）：
{cand_text}

判定标准：
- 只有候选和中文稿在可见主体、医学过程、动作/状态变化上基本一致，才算匹配。
- 如果中文稿有明确医学对象/解剖部位/疾病链条，候选也必须是同一个对象/部位/链条；不要只因为“缩小、稳定、运动、破裂”等抽象动作相似就匹配。
- 例如斑块/胆固醇/血管/血压的稿件，不能匹配癌细胞、腰椎、普通运动等不同医学对象的画面。
- 只是话题相关、风险相关、治疗建议相关、生活方式建议相关，都不算匹配。
- 中文稿如果只是提问、转场、观点、比喻、行动建议、情绪号召，通常应 pick=0。
- 宁可缺素材，也不要用“差不多相关”的片段硬凑。

match_type 只能使用以下值之一：
- same_visual_process：同一个可见医学过程/病理过程
- same_visual_object：同一个可见解剖结构或病理对象
- direct_medical_action：同一个可见医疗操作/药物操作
- supporting_context：只是支持性背景，不能直接承载这句话
- related_topic：话题相近但画面不同
- generic_advice：生活方式/行动建议/转场/观点
- none：没有匹配

fit_score 范围 0-1。只有 match_type 属于前三类且 fit_score >= 0.75 时才应该 pick 非 0。

输出严格 JSON（不要 markdown 代码块、不要其他文字）：
{{"pick": N, "fit_score": 0.0, "match_type": "none", "reason": "简短理由", "missing": ["缺失的关键视觉要素"]}}
N = 匹配的候选编号 1-{len(candidates)}；全部不匹配则 N = 0。"""

    try:
        sub_env = {k: v for k, v in os.environ.items() if not k.startswith('ANTHROPIC_')}
        result = subprocess.run(
            ['claude', '-p', '--output-format', 'json', '--model', CLAUDE_MODEL, prompt],
            capture_output=True, text=True, encoding='utf-8', timeout=90, env=sub_env,
        )
        stdout = (result.stdout or '').strip()
        if not stdout:
            return normalize_rerank_result({
                'pick': 0,
                'reason': f'claude empty stdout rc={result.returncode}',
                '_error': True,
            })
        try:
            outer = json.loads(stdout)
        except json.JSONDecodeError:
            return normalize_rerank_result({
                'pick': 0,
                'reason': f'outer JSON parse failed rc={result.returncode}: {stdout[:150]}',
                '_error': True,
            })
        if outer.get('is_error'):
            return normalize_rerank_result({
                'pick': 0,
                'reason': f'claude is_error: {outer.get("result", "")[:150]}',
                '_error': True,
            })
        return parse_rerank_raw(outer.get('result', ''))
    except subprocess.TimeoutExpired:
        return normalize_rerank_result({'pick': 0, 'reason': 'claude CLI timeout', '_error': True})
    except Exception as e:
        return normalize_rerank_result({'pick': 0, 'reason': f'parse error: {e}', '_error': True})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bp-merged', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--files-per-scene', type=int, default=5)
    ap.add_argument('--top-n-per-file', type=int, default=3)
    ap.add_argument('--top-atoms', type=int, default=40, help='Top atoms per seg from pool')
    ap.add_argument('--recall-pool-atoms', type=int, default=0,
                    help='Retrieve this many top atoms before diversity filtering; 0 = same as top-atoms')
    ap.add_argument('--atoms-per-file', type=int, default=4,
                    help='When --candidate-diversity=file, keep at most this many atoms from each file')
    ap.add_argument('--candidate-diversity', choices=['none', 'file'], default='none',
                    help='none = pure top atoms; file = diversify recalled atoms across asset files before aggregation')
    ap.add_argument('--top-segments', type=int, default=10, help='Top aggregated segments sent to LLM')
    ap.add_argument('--max-gap', type=float, default=2.0, help='Atom-cluster time gap (s)')
    ap.add_argument('--min-atoms', type=int, default=1, help='Min atoms per candidate segment')
    ap.add_argument('--min-dur', type=float, default=6.0, help='Min candidate seg duration (s), pad if shorter')
    ap.add_argument('--max-per-file', type=int, default=2)
    ap.add_argument('--recall-mode', choices=['scene', 'global'], default='scene',
                    help='scene = shortlist files by scene first; global = each logic segment searches all asset atoms')
    ap.add_argument('--min-fit-score', type=float, default=0.75,
                    help='Only accept rerank picks with fit_score >= this value')
    ap.add_argument('--min-cosine', type=float, default=0.0,
                    help='Only accept picked candidates with cosine >= this value')
    ap.add_argument('--accepted-match-types',
                    default=','.join(sorted(DEFAULT_ACCEPTED_MATCH_TYPES)),
                    help='Comma-separated match_type values allowed into the final asset plan')
    ap.add_argument('--concurrency', type=int, default=4)
    args = ap.parse_args()
    accepted_match_types = parse_accepted_match_types(args.accepted_match_types)

    # ---- load indexes ----
    asset_blocks, block_emb = (None, None)
    if args.recall_mode == 'scene':
        asset_blocks, block_emb = load_block_index()
    else:
        print('Block index: skipped (global atom recall)')
    atoms, atom_emb = load_atom_index()
    scenes, flat_segs, bp_title = load_blueprint_with_scenes(args.bp_merged)

    # file -> block idxs (for Phase A)
    file_to_blocks = defaultdict(list)
    if args.recall_mode == 'scene':
        for i, b in enumerate(asset_blocks):
            file_to_blocks[b['file_key']].append(i)
        file_to_blocks = {k: np.array(v) for k, v in file_to_blocks.items()}

    # file -> atom idxs, sorted by start time (for Phase B pool + aggregation)
    file_to_atoms = defaultdict(list)
    for i, a in enumerate(atoms):
        file_to_atoms[a['file_key']].append(i)
    file_to_atoms_sorted = {}
    for fk, idxs in file_to_atoms.items():
        idxs_sorted = sorted(idxs, key=lambda i: atoms[i]['start'])
        file_to_atoms_sorted[fk] = np.array(idxs_sorted, dtype=np.int64)
    print(f'Asset library: {len(file_to_blocks)} files (blocks), {len(file_to_atoms_sorted)} files (atoms)')

    scene_shortlist = {}
    if args.recall_mode == 'scene':
        # ---- Phase A: scene → file shortlist via block index ----
        print(f'\nPhase A: embedding {len(scenes)} scene queries...')
        scene_query_emb = embed_queries([s['scene_text'] for s in scenes])
        scene_sim = scene_query_emb @ block_emb.T

        print(f'\nPhase A: shortlisting top-{args.files_per_scene} files per scene')
        for si, sc in enumerate(scenes):
            scores = score_files_for_scene(scene_sim[si], file_to_blocks, top_n=args.top_n_per_file)
            top_files = sorted(scores.items(), key=lambda x: -x[1])[:args.files_per_scene]
            scene_shortlist[sc['scene_id']] = dict(top_files)
            files_summary = ', '.join(f'{fk[:40]}({s2:.2f})' for fk, s2 in top_files[:5])
            print(f"  [{sc['scene_id']}] {sc['scene_title'][:30]}: {files_summary}")
    else:
        print('\nPhase A: skipped (logic segment searches all asset atoms directly)')

    # ---- Phase B: per-seg atom recall within scene's shortlisted files ----
    print(f'\nPhase B: embedding {len(flat_segs)} seg queries...')
    seg_query_emb = embed_queries([s['atoms_text'] for s in flat_segs])
    # seg_sim over ALL atoms is fine: 50 × 71k = 3.5M floats; we'll mask by pool per-query.
    seg_atom_sim = seg_query_emb @ atom_emb.T
    print(f'  seg_atom_sim shape: {seg_atom_sim.shape}')

    all_atom_idxs = np.arange(len(atoms), dtype=np.int64)
    print(f'\nPhase B+C: per-seg atom recall → aggregate → claude rerank '
          f'(concurrency={args.concurrency}, top_atoms={args.top_atoms}, top_segments={args.top_segments})...')

    def rerank_one(qi):
        seg = flat_segs[qi]
        if args.recall_mode == 'global':
            # Logic-first retrieval: no scene/file prefilter. Each logic segment searches the
            # whole atom index, then adjacent hits are assembled into candidate clips.
            pool_idxs = all_atom_idxs
        else:
            scene_files = scene_shortlist[seg['scene_id']]
            # Pool of atom indices restricted to shortlisted files
            pool_chunks = [file_to_atoms_sorted[fk] for fk in scene_files.keys() if fk in file_to_atoms_sorted]
            if not pool_chunks:
                return qi, [], [], {'pick': 0, 'reason': 'no atoms in shortlisted files'}, 0.0
            pool_idxs = np.concatenate(pool_chunks)
        pool_sims = seg_atom_sim[qi, pool_idxs]
        # Top atoms. Optionally retrieve a wider internal pool, then keep a diverse
        # subset across files so one broad video cannot crowd out better alternates.
        pool_k = min(args.recall_pool_atoms or args.top_atoms, len(pool_idxs))
        top_pos_pool = np.argpartition(-pool_sims, pool_k - 1)[:pool_k]
        top_pos_pool = top_pos_pool[np.argsort(-pool_sims[top_pos_pool])]

        if args.candidate_diversity == 'file':
            selected_pos = []
            per_file_counts = defaultdict(int)
            for pos in top_pos_pool:
                atom_idx = int(pool_idxs[pos])
                fk = atoms[atom_idx]['file_key']
                if per_file_counts[fk] >= args.atoms_per_file:
                    continue
                selected_pos.append(pos)
                per_file_counts[fk] += 1
                if len(selected_pos) >= args.top_atoms:
                    break
            if len(selected_pos) < min(args.top_atoms, len(top_pos_pool)):
                selected = set(int(x) for x in selected_pos)
                for pos in top_pos_pool:
                    if int(pos) in selected:
                        continue
                    selected_pos.append(pos)
                    if len(selected_pos) >= args.top_atoms:
                        break
            top_pos = np.array(selected_pos, dtype=np.int64)
        else:
            top_pos = top_pos_pool[:min(args.top_atoms, len(top_pos_pool))]

        top_atom_idxs = pool_idxs[top_pos].tolist()
        top_cosines = pool_sims[top_pos].tolist()

        # Aggregate adjacent atoms
        cand_segs = aggregate_atoms_into_segments(
            top_atom_idxs, top_cosines, atoms, file_to_atoms_sorted,
            max_gap=args.max_gap, min_atoms=args.min_atoms,
            min_dur=args.min_dur, max_per_file=args.max_per_file,
        )
        cand_segs = cand_segs[:args.top_segments]
        for r, c in enumerate(cand_segs, 1):
            c['rank'] = r

        t0 = time.time()
        if not cand_segs:
            return qi, top_atom_idxs, cand_segs, {'pick': 0, 'reason': 'no aggregated segments'}, 0.0
        rr = claude_rerank(seg['atoms_text'], cand_segs)
        return qi, top_atom_idxs, cand_segs, rr, time.time() - t0

    results = [None] * len(flat_segs)
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futures = {ex.submit(rerank_one, i): i for i in range(len(flat_segs))}
        for fut in as_completed(futures):
            qi, top_atom_idxs, cand_segs, rr, dt = fut.result()
            seg = flat_segs[qi]
            raw_pick_idx = rr.get('pick', 0)
            raw_picked = cand_segs[raw_pick_idx - 1] if 1 <= raw_pick_idx <= len(cand_segs) else None
            reject_reason = acceptance_reject_reason(
                rr, raw_picked, args.min_fit_score, accepted_match_types, args.min_cosine
            )
            picked = None if reject_reason else raw_picked
            pick_idx = raw_pick_idx if picked else 0
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
                'raw_pick': raw_pick_idx,
                'pick': pick_idx,
                'accepted': bool(picked),
                'reject_reason': reject_reason,
                'fit_score': rr.get('fit_score', 0.0),
                'match_type': rr.get('match_type', 'none'),
                'missing': rr.get('missing', []),
                'rerank_reason': rr.get('reason', ''),
                'rerank_raw': rr.get('_raw', None),
                'picked': picked,
                'rejected_picked': raw_picked if raw_picked and reject_reason else None,
                'candidates_top_segments': cand_segs,
                '_rerank_seconds': round(dt, 2),
            }
            mark = 'X ' if pick_idx == 0 else f'#{pick_idx}'
            fname_short = picked['file'][:48] if picked else '(no pick)'
            span = f"{picked['start']:.1f}-{picked['end']:.1f}s" if picked else reject_reason
            print(
                f"  [{seg['seg_id']}] {mark} {fname_short} {span} "
                f"fit={rr.get('fit_score', 0.0):.2f} type={rr.get('match_type', 'none')} "
                f"({dt:.1f}s) nc={len(cand_segs)}"
            )

    out_data = {
        'bp_title': bp_title,
        'algo': f'{args.recall_mode}-atom-recall-then-aggregate',
        'params': {
            'recall_mode': args.recall_mode,
            'files_per_scene': args.files_per_scene,
            'top_n_per_file': args.top_n_per_file,
            'top_atoms': args.top_atoms,
            'recall_pool_atoms': args.recall_pool_atoms or args.top_atoms,
            'candidate_diversity': args.candidate_diversity,
            'atoms_per_file': args.atoms_per_file,
            'top_segments': args.top_segments,
            'max_gap': args.max_gap,
            'min_atoms': args.min_atoms,
            'min_dur': args.min_dur,
            'max_per_file': args.max_per_file,
            'min_fit_score': args.min_fit_score,
            'min_cosine': args.min_cosine,
            'accepted_match_types': sorted(accepted_match_types),
        },
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
