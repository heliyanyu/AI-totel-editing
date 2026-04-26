# Editing V1

This repo now keeps the current end-to-end doctor-video editing pipeline.

## Current Pipeline

1. Find raw doctor-video cases.
2. Use the case `.docx` as Qwen ASR context/hotwords when available.
3. Run Qwen ASR to create `transcript_raw.json`.
4. Run LLM transcript review with the `.docx` as terminology/reference text.
5. Run Qwen forced alignment on the reviewed tokens.
6. Analyze the reviewed/aligned transcript into the 3-level semantic blueprint.
7. Build the timing map and render overlay/subtitles.
8. Infer visual asset needs from the blueprint.
9. Recall candidate visual segments from the asset embedding index.
10. Rerank candidates with one LLM pass.
11. Generate a Jianying draft with doctor video, subtitles, overlay, and matched assets.
12. Collect editor feedback and apply it to future matches.

Main batch entry:

```powershell
.\run-batch.ps1
```

## Core Runtime

TypeScript pipeline:

- `src/analyze`
- `src/timing`
- `src/renderer`
- `src/remotion`
- `src/compose`
- `src/schemas`
- `src/transcribe`
- `src/force-align`

Python/PowerShell runtime scripts:

- `scripts/transcribe-qwen.py`
- `scripts/force-align-qwen.py`
- `scripts/render_progress_bar.py`
- `scripts/render_navigation.py`
- `scripts/split-overlay-by-scene.py`
- `scripts/infer_blueprint_visual_needs.py`
- `scripts/infer_blueprint_visual_beats.py`
- `scripts/match_visual_beats_to_segments.py`
- `scripts/rerank_visual_matches_llm.py`
- `scripts/rerank_visual_matches_codex.py`
- `scripts/codex_rerank_schema.json`
- `scripts/generate-draft-from-matches.py`
- `scripts/generate-jianying-draft.py`
- `scripts/asset_feedback.py`

Index build/deploy helpers:

- `scripts/build_visual_atom_index.py`
- `scripts/build_visual_segment_index.py`
- `scripts/sync-asset-index-for-editor.ps1`

## Asset Index

The generated asset index is intentionally not stored in git. On developer
machines it lives under:

```text
scripts/asset_index/
```

The current recommended deployable index bundle is:

```text
scripts/asset_index/visual_segments_cbj58_5000_plus_zh_chronic.jsonl
scripts/asset_index/visual_segment_embeddings_cbj58_5000_plus_zh_chronic.npy
scripts/asset_index/visual_segment_embeddings_cbj58_5000_plus_zh_chronic.keys.json
```

The real source videos referenced by the index currently point to:

```text
E:/nucleus download/totel nucleus video/...
```

The editing server must either keep the same path or rewrite `mp4_path` in the
index before generating drafts. Prefer configuring path mapping in `.env`:

```dotenv
ASSET_INDEX_SOURCE_ROOT=E:/nucleus download/totel nucleus video
ASSET_LOCAL_ROOT=D:/jianji/素材库
ASSET_DRAFT_ROOT=W:/素材库
DRAFT_PATH_SOURCE_ROOT=D:/jianji
DRAFT_PATH_TARGET_ROOT=W:/
```

## Local Artifacts

Old experiments, removed scripts, generated reports, temporary matches, logs,
and local index data are archived or generated under:

```text
local_artifacts/
```

That directory is ignored by git.

## Deployment Notes

See:

- `docs/editor-deployment-asset-matching.md`
- `docs/asset-feedback.md`
