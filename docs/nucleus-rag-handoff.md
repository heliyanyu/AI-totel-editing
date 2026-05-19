# Nucleus RAG Handoff

This branch is for the Nucleus RAG material-matching pipeline only.

Do not continue VU overlay work here. VU lives on `feature/vu-overlay-pipeline`.
Do not treat `main` as the RAG branch. `main` is the pre-RAG template pipeline.

## Goal

Take a finished pipeline case and add matched Nucleus medical animation clips into
the JianYing draft:

```text
blueprint.json
-> visual_needs.json
-> visual_beats.json
-> asset_matches_rag.json
-> asset_matches_visual_reranked.json
-> JianYing draft with an asset track
```

RAG is recall only. The final decision must go through rerank and feedback.
If confidence is low, leave the draft without a material clip.

## Main Entry

Use `run-batch.ps1` on this branch.

The relevant switches are:

```powershell
-SkipAssetMatching
-VisualSegments
-VisualSegmentEmbeddings
-VisualSegmentKeys
-VisualNeedProvider
-VisualNeedModel
-RerankProvider
-RerankModel
-AllowRagFallback
```

Default runtime index files:

```text
scripts/asset_index/visual_segments_cbj58_5000_plus_zh_chronic.jsonl
scripts/asset_index/visual_segment_embeddings_cbj58_5000_plus_zh_chronic.npy
scripts/asset_index/visual_segment_embeddings_cbj58_5000_plus_zh_chronic.keys.json
```

These files are stored with Git LFS. After cloning this branch, run:

```powershell
git lfs install
git lfs pull
```

## Required Scripts

Current runnable pipeline:

```text
scripts/infer_blueprint_visual_needs.py
scripts/infer_blueprint_visual_beats.py
scripts/match_visual_beats_to_segments.py
scripts/rerank_visual_matches_llm.py
scripts/rerank_visual_matches_codex.py
scripts/codex_rerank_schema.json
scripts/asset_feedback.py
scripts/generate-draft-from-matches.py
scripts/generate-jianying-draft.py
scripts/sync-asset-index-for-editor.ps1
```

Index build/rebuild scripts:

```text
scripts/build_visual_atom_index.py
scripts/build_visual_segment_index.py
```

## Asset Path Mapping

The index was built against:

```text
E:/nucleus download/totel nucleus video
```

If the real mp4 files live elsewhere, configure `.env`:

```dotenv
ASSET_INDEX_SOURCE_ROOT=E:/nucleus download/totel nucleus video
ASSET_LOCAL_ROOT=D:/素材库
ASSET_DRAFT_ROOT=W:/素材库
```

If generated drafts are written on a server path but opened from a shared drive:

```dotenv
DRAFT_PATH_SOURCE_ROOT=D:/jianji
DRAFT_PATH_TARGET_ROOT=W:/
```

## Validation Checklist

1. Run once with `-SkipAssetMatching` to verify the old draft pipeline still works.
2. Run without `-SkipAssetMatching`.
3. Confirm these files exist in the case `out` folder:

```text
visual_needs.json
visual_beats.json
asset_matches_rag.json
asset_matches_visual_reranked.json
```

4. Open the generated draft and inspect the asset track.
5. Reject bad matches with `scripts/asset_feedback.py`; do not lower the rerank threshold just to increase coverage.

## Development Rule

Accuracy is more important than coverage. A missing material clip is acceptable;
a wrong medical animation clip is not.
