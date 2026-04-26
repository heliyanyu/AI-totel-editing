# Scripts Layout

This folder now keeps only scripts required by the current end-to-end editing
pipeline and the visual asset matching step inside it.

## Kept Scripts

- `build_visual_atom_index.py`
- `build_visual_segment_index.py`
- `transcribe-qwen.py`
- `force-align-qwen.py`
- `render_progress_bar.py`
- `render_navigation.py`
- `split-overlay-by-scene.py`
- `infer_blueprint_visual_needs.py`
- `infer_blueprint_visual_beats.py`
- `match_visual_beats_to_segments.py`
- `rerank_visual_matches_codex.py`
- `codex_rerank_schema.json`
- `generate-draft-from-matches.py`
- `generate-jianying-draft.py`
- `asset_feedback.py`
- `sync-asset-index-for-editor.ps1`

## Local Artifacts

Large indexes, logs, old experiments, old pipeline scripts, reports, and one-off
tools are kept out of git and archived under `local_artifacts/`.

Current deployable asset index files still live under `scripts/asset_index/` on
developer machines, but they are ignored by git and copied to editing servers
with `sync-asset-index-for-editor.ps1`.
