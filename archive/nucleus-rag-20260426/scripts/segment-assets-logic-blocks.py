# -*- coding: utf-8 -*-
"""
用 Claude CLI 把 Nucleus 转录结果按三级语义结构（atom/logic/scene）切分。
借鉴 step1.ts 的 || 标记法：零信息损耗，只插边界不改原文。

输入：E:/nucleus download/whisper_output/*.json
输出：E:/nucleus download/asset_segments/*.json
"""
import os, sys, json, subprocess, time, re
sys.stdout.reconfigure(encoding='utf-8')

INPUT_DIR = r'E:\nucleus download\whisper_output'
OUTPUT_DIR = r'E:\nucleus download\asset_segments'

SYSTEM_PROMPT = '''你是医学科普视频的语义分析专家。任务：将逐字转录拆解为三级语义结构，并只通过边界标记输出结果。

三级结构：
- atom：最小连续语义单元（词组/短语/很短分句）
- logic：连续 atom 在论证角度变化处断开
- scene：连续 logic 在话题或表达意图变化处断开

atom 切分：
- 足够细，边界落在完整词语之间
- 固定搭配、专有名词、术语、数量短语不拆
- 英文按单词/短语切，中文按词组/分句切

输出格式：
- 不要 JSON、不要解释、不要代码块
- 只输出"原文 + 边界标记"
- "|" = 新 atom；"||" = 新 logic；"|||" = 新 scene
- 第一段必须以 "|||" 开头
- 删除所有竖线和空白后必须与原文逐字一致'''


def segment_transcript(transcript_text, tokens=None):
    """Single-file version (kept for testing)."""
    user_prompt = f'''转录原文（除插入边界标记外，不允许增删改任何一个字符）：
{transcript_text}

严格要求：
- 只能插入 "|" "||" "|||" 三种标记与必要的空白
- 不允许增加、删除、替换任何字符，包括标点符号
- 第一段必须以 "|||" 开头
- 删除所有竖线和空白后，结果必须与转录原文一字不差'''
    return _call_claude(SYSTEM_PROMPT + '\n\n' + user_prompt)


def segment_batch(transcripts):
    """Batch-segment multiple transcripts in a single Claude call.

    transcripts: list of strings.
    Returns: list of marked strings (same length as input).
    Raises RuntimeError with 'BATCH_PARSE_FAIL' if can't split output into expected pieces.
    """
    # Build batched input with unambiguous separators
    parts = []
    for i, t in enumerate(transcripts):
        parts.append(f'===FILE {i+1}===\n{t}')
    batched_input = '\n\n'.join(parts)

    user_prompt = f'''以下是 {len(transcripts)} 段独立的转录原文，用 "===FILE N===" 分隔。
请对每段独立做三级切分，插入 "|" "||" "|||" 边界标记。

输出格式严格按这个示例（必须保留 "===FILE N===" 行作为分隔）：
===FILE 1===
||| first transcript with | markers || more markers
===FILE 2===
||| second transcript with | markers || more markers

严格要求：
- 每段内部第一个 atom 必须以 "|||" 开头
- 只能插入 "|" "||" "|||" 与必要空白，不允许增删改任何原文字符
- 删除所有竖线和空白后，每段必须与对应的原文一字不差
- 输出必须保留 "===FILE N===" 分隔行，不要省略

输入：
{batched_input}'''

    output = _call_claude(SYSTEM_PROMPT + '\n\n' + user_prompt)

    # Split output by ===FILE N=== markers
    pattern = re.compile(r'===FILE\s+(\d+)===\s*', re.IGNORECASE)
    matches = list(pattern.finditer(output))
    if len(matches) < len(transcripts):
        raise RuntimeError(f'BATCH_PARSE_FAIL: expected {len(transcripts)} files, got {len(matches)} markers')

    results = [None] * len(transcripts)
    for i, m in enumerate(matches):
        idx = int(m.group(1)) - 1
        start = m.end()
        end = matches[i+1].start() if i+1 < len(matches) else len(output)
        if 0 <= idx < len(transcripts):
            results[idx] = output[start:end].strip()

    # Check all slots filled
    missing = [i for i, r in enumerate(results) if r is None]
    if missing:
        raise RuntimeError(f'BATCH_PARSE_FAIL: missing files {missing}')

    return results


def _call_claude(full_input):
    prompt_file = os.path.join(os.path.dirname(__file__), f'.segment_prompt_tmp_{os.getpid()}.txt')
    with open(prompt_file, 'w', encoding='utf-8') as f:
        f.write(full_input)

    result = subprocess.run(
        f'cat "{prompt_file}" | claude -p --model sonnet --output-format text',
        capture_output=True, text=True, encoding='utf-8', timeout=600, shell=True
    )
    output = result.stdout.strip()
    lower = output.lower()
    if 'hit your limit' in lower or ('resets' in lower and 'asia/shanghai' in lower):
        raise SystemExit(f'RATE_LIMIT_HIT: {output[:200]}')
    if 'api error' in lower and ('401' in output or '400' in output or '429' in output or '503' in output):
        raise SystemExit(f'API_ERROR: {output[:200]}')
    return output


def normalize(s):
    return re.sub(r'\s+', '', s).lower()


def parse_markers(marked_text):
    """Extract atoms with boundary markers from Claude output."""
    text = marked_text.strip()
    text = re.sub(r'^```[a-zA-Z0-9_-]*\s*', '', text)
    text = re.sub(r'\s*```$', '', text).strip()
    text = text.replace('｜', '|').replace('¦', '|')

    atoms_raw = []
    parts = re.split(r'(\|{1,3})', text)
    current_text = ''
    pending_boundary = None

    for part in parts:
        if part in ('|', '||', '|||'):
            if current_text.strip():
                atoms_raw.append({'text': current_text.strip(), 'boundary': pending_boundary})
            current_text = ''
            pending_boundary = {'|': None, '||': 'logic', '|||': 'scene'}[part]
        else:
            current_text += part

    if current_text.strip():
        atoms_raw.append({'text': current_text.strip(), 'boundary': pending_boundary})

    return atoms_raw


def verify_and_align(atoms_raw, words):
    """Hard-verify that atom texts (concatenated) match words exactly, then align.

    Returns (aligned_atoms, error_message). aligned_atoms is None if verification fails.
    """
    # Concatenate atom texts (normalized: no whitespace, lowercase)
    atoms_joined = ''.join(normalize(a['text']) for a in atoms_raw)
    # Concatenate words (same normalization)
    words_joined = ''.join(normalize(w['word']) for w in words)

    if atoms_joined != words_joined:
        # Find first diff position for debug
        for i, (a, b) in enumerate(zip(atoms_joined, words_joined)):
            if a != b:
                ctx_a = atoms_joined[max(0,i-20):i+20]
                ctx_b = words_joined[max(0,i-20):i+20]
                return None, f'char mismatch at pos {i}: atoms="{ctx_a}" vs words="{ctx_b}"'
        if len(atoms_joined) != len(words_joined):
            return None, f'length mismatch: atoms={len(atoms_joined)} vs words={len(words_joined)}'

    # Verified — now do exact character-level alignment
    aligned = []
    word_cursor = 0
    for atom in atoms_raw:
        atom_norm = normalize(atom['text'])
        if not atom_norm:
            continue

        start_wi = word_cursor
        matched = ''
        while word_cursor < len(words) and len(matched) < len(atom_norm):
            matched += normalize(words[word_cursor]['word'])
            word_cursor += 1

        if matched != atom_norm:
            return None, f'alignment drift at atom "{atom["text"][:40]}"'

        aligned.append({
            'text': atom['text'],
            'start': round(words[start_wi]['start'], 2),
            'end': round(words[word_cursor - 1]['end'], 2),
            'boundary': atom['boundary'],
        })

    return aligned, None


def parse_and_align(marked_text, words):
    atoms_raw = parse_markers(marked_text)
    if not atoms_raw:
        return [], 'no atoms parsed'
    aligned, err = verify_and_align(atoms_raw, words)
    if aligned is None:
        return [], err
    return aligned, None


def build_logic_blocks(atoms):
    """Group atoms into logic blocks."""
    if not atoms:
        return []

    blocks = []
    current = [atoms[0]]
    scene_start_time = atoms[0]['start']

    for atom in atoms[1:]:
        if atom['boundary'] in ('scene', 'logic'):
            # Flush
            blocks.append({
                'start': current[0]['start'],
                'end': current[-1]['end'],
                'text': ' '.join(a['text'] for a in current),
                'scene_start': scene_start_time,
                'n_atoms': len(current),
            })
            current = []
            if atom['boundary'] == 'scene':
                scene_start_time = atom['start']

        current.append(atom)

    if current:
        blocks.append({
            'start': current[0]['start'],
            'end': current[-1]['end'],
            'text': ' '.join(a['text'] for a in current),
            'scene_start': scene_start_time,
            'n_atoms': len(current),
        })

    return blocks


def process_file(json_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    segments = data.get('segments', [])
    if not segments:
        return {'skipped': True, 'reason': 'no segments'}

    all_words = []
    for seg in segments:
        for w in seg.get('words', []):
            if w.get('word', '').strip():
                all_words.append(w)

    if not all_words:
        return {'skipped': True, 'reason': 'no words'}

    # Skip if too short (likely "you" or junk)
    if len(all_words) < 5:
        return {'skipped': True, 'reason': 'too short'}

    transcript = ''.join(w['word'] for w in all_words)

    # 1 retry on verify failure (2 attempts total)
    max_attempts = 2
    atoms = None
    last_err = None
    last_marked = ''
    for attempt in range(1, max_attempts + 1):
        marked = segment_transcript(transcript)
        last_marked = marked
        atoms, err = parse_and_align(marked, all_words)
        if atoms:
            break
        last_err = err
        # Brief pause between retries to avoid rate spikes
        if attempt < max_attempts:
            time.sleep(1)

    if not atoms:
        return {
            'skipped': True,
            'reason': 'verify failed',
            'error': last_err,
            'attempts': max_attempts,
            'marked': last_marked[:500],
        }

    logic_blocks = build_logic_blocks(atoms)

    return {
        'file': data.get('file', ''),
        'language': data.get('language', 'unknown'),
        'atoms': atoms,
        'logic_blocks': logic_blocks,
    }


# Conservative batch size limit (chars of transcript per batch).
# Sonnet 4.6 output cap is 64K tokens; output is roughly transcript length in tokens.
# 12000 chars ≈ ~5000 tokens output per batch → plenty of headroom.
BATCH_CHAR_LIMIT = 12000
BATCH_FILE_LIMIT = 8  # also cap by file count to avoid too-many-separators confusion


def load_transcript(input_path):
    """Load whisper json and return (data, words, transcript_text) or (data, None, None) if should skip."""
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    segments = data.get('segments', [])
    if not segments:
        return data, None, None, 'no segments'
    all_words = []
    for seg in segments:
        for w in seg.get('words', []):
            if w.get('word', '').strip():
                all_words.append(w)
    if not all_words:
        return data, None, None, 'no words'
    if len(all_words) < 5:
        return data, None, None, 'too short'
    transcript = ''.join(w['word'] for w in all_words)
    return data, all_words, transcript, None


def process_batch(batch_files):
    """Process a batch of (fname, data, words, transcript) tuples.

    Returns list of (fname, result_dict) in the same order.
    """
    transcripts = [item[3] for item in batch_files]
    marked_list = segment_batch(transcripts)

    results = []
    for (fname, data, words, transcript), marked in zip(batch_files, marked_list):
        atoms, err = parse_and_align(marked, words)
        if not atoms:
            results.append((fname, {
                'skipped': True,
                'reason': 'verify failed',
                'error': err,
                'marked': marked[:1000],
            }))
            continue
        logic_blocks = build_logic_blocks(atoms)
        results.append((fname, {
            'file': data.get('file', ''),
            'language': data.get('language', 'unknown'),
            'atoms': atoms,
            'logic_blocks': logic_blocks,
        }))
    return results


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--shard', type=int, default=0)
    parser.add_argument('--total-shards', type=int, default=1)
    args = parser.parse_args()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    all_files = sorted([f for f in os.listdir(INPUT_DIR) if f.endswith('.json')])
    if args.total_shards > 1:
        all_files = [f for i, f in enumerate(all_files) if i % args.total_shards == args.shard]
        print(f"Shard {args.shard}/{args.total_shards}: {len(all_files)} files")

    done = set(f for f in os.listdir(OUTPUT_DIR) if f.endswith('.json'))
    todo = [f for f in all_files if f not in done]
    print(f"Total: {len(all_files)}, done: {len(done)}, to process: {len(todo)}")

    # Pre-load transcripts and immediately handle skip cases
    pending = []
    t0 = time.time()
    batches_run = 0
    files_ok = 0
    files_skipped = 0
    files_failed = 0

    def flush_batch():
        nonlocal batches_run, files_ok, files_skipped, files_failed
        if not pending:
            return
        batch = pending[:]
        pending.clear()
        try:
            results = process_batch(batch)
        except RuntimeError as e:
            # Batch-level parse fail: fall back to one-at-a-time for these files
            print(f"  [batch parse failed, falling back 1-by-1]")
            results = []
            for item in batch:
                fname, data, words, transcript = item
                try:
                    marked_list = segment_batch([transcript])
                    atoms, err = parse_and_align(marked_list[0], words)
                    if atoms:
                        results.append((fname, {
                            'file': data.get('file',''),
                            'language': data.get('language','unknown'),
                            'atoms': atoms,
                            'logic_blocks': build_logic_blocks(atoms),
                        }))
                    else:
                        results.append((fname, {'skipped': True, 'reason': 'verify failed',
                                                 'error': err, 'marked': marked_list[0][:1000]}))
                except Exception as e2:
                    results.append((fname, {'skipped': True, 'reason': 'exception', 'error': str(e2)[:200]}))

        batches_run += 1
        batch_chars = sum(len(item[3]) for item in batch)
        for fname, result in results:
            out_path = os.path.join(OUTPUT_DIR, fname)
            with open(out_path, 'w', encoding='utf-8') as fp:
                json.dump(result, fp, ensure_ascii=False, indent=2)
            if result.get('skipped'):
                if result.get('reason') == 'too short':
                    files_skipped += 1
                else:
                    files_failed += 1
            else:
                files_ok += 1
        elapsed = time.time() - t0
        total_processed = files_ok + files_failed + files_skipped
        rate = total_processed / elapsed * 3600 if elapsed > 0 else 0
        print(f"  batch {batches_run}: {len(batch)} files, {batch_chars} chars → ok:{files_ok} fail:{files_failed} skip:{files_skipped} ({rate:.0f}/hr)")

    current_chars = 0
    for i, fname in enumerate(todo):
        input_path = os.path.join(INPUT_DIR, fname)
        try:
            data, words, transcript, skip_reason = load_transcript(input_path)
        except Exception as e:
            with open(os.path.join(OUTPUT_DIR, fname), 'w', encoding='utf-8') as fp:
                json.dump({'skipped': True, 'reason': 'load error', 'error': str(e)[:200]}, fp, ensure_ascii=False)
            files_failed += 1
            continue

        if skip_reason:
            # Handle skip cases immediately without calling Claude
            with open(os.path.join(OUTPUT_DIR, fname), 'w', encoding='utf-8') as fp:
                json.dump({'skipped': True, 'reason': skip_reason}, fp, ensure_ascii=False)
            files_skipped += 1
            continue

        # Check if adding this file would exceed limits
        if pending and (current_chars + len(transcript) > BATCH_CHAR_LIMIT or len(pending) >= BATCH_FILE_LIMIT):
            flush_batch()
            current_chars = 0

        pending.append((fname, data, words, transcript))
        current_chars += len(transcript)

        # Also flush if this single file is close to the limit
        if current_chars >= BATCH_CHAR_LIMIT * 0.9:
            flush_batch()
            current_chars = 0

    flush_batch()

    print(f"\nDone! ok:{files_ok} skipped:{files_skipped} failed:{files_failed} in {batches_run} batches")


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'test':
        test_files = [
            'ANCE00174_Coronary Artery Angioplasty (Radial Access)_audio.json',
            'ANS00170_Atherosclerosis_audio.json',
            '1型糖尿病_audio.json',
        ]
        for f in test_files:
            path = os.path.join(INPUT_DIR, f)
            if not os.path.exists(path):
                print(f'Not found: {f}')
                continue
            print(f'\n=== {f} ===')
            result = process_file(path)
            if result.get('skipped'):
                print(f'  Skipped: {result["reason"]}')
                if 'error' in result:
                    print(f'  Error: {result["error"]}')
                if 'marked' in result:
                    print(f'  Claude output first 400 chars: {result["marked"][:400]}')
            else:
                print(f'  Language: {result["language"]}')
                print(f'  Atoms: {len(result["atoms"])}')
                print(f'  Logic blocks: {len(result["logic_blocks"])}')
                for lb in result['logic_blocks'][:3]:
                    print(f'    [{lb["start"]:.1f}-{lb["end"]:.1f}s] {lb["text"][:100]}')
    else:
        main()
