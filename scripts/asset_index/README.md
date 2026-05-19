# Asset Index Directory

This directory is intentionally mostly ignored by git.

The Nucleus RAG branch tracks only the current runtime trio:

```text
visual_segments_cbj58_5000_plus_zh_chronic.jsonl
visual_segment_embeddings_cbj58_5000_plus_zh_chronic.npy
visual_segment_embeddings_cbj58_5000_plus_zh_chronic.keys.json
```

These files are required by:

```text
scripts/match_visual_beats_to_segments.py
```

The full local index inventory and SHA256 hashes are listed in:

```text
scripts/asset_index/INDEX_MANIFEST.md
```

Do not commit actual Nucleus mp4 files to this repository.

