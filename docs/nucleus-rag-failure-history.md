# Nucleus RAG Failure History

This note explains why the current branch uses `visual_needs -> visual_beats ->
RAG recall -> rerank`, instead of the older direct matching attempts.

## Stage 1: File and Title Matching

Early scripts labelled Nucleus files from filename/title and ASR narration.

Representative files:

```text
archive/nucleus-rag-20260426/scripts/label-nucleus-assets.py
archive/nucleus-rag-20260426/scripts/label-assets.py
archive/nucleus-rag-20260426/legacy_root/asset_index.json
```

Failure mode:

File names and narration are not the same as visible frames. A video about
heart attack may show arteries, a doctor, a drug, text, or a transition at any
given second.

## Stage 2: Category Matching

The next version clustered material into categories and asked the blueprint to
pick a category.

Representative files:

```text
archive/nucleus-rag-20260426/scripts/match-blueprint-assets.py
archive/nucleus-rag-20260426/scripts/cluster-step*.py
archive/nucleus-rag-20260426/script_data/asset_blocks_classified.json
```

Failure mode:

The category was too coarse. "Atherosclerosis", "blood clot", "stent", and
"coronary artery" are semantically close but visually different.

## Stage 3: Logic Block and Atom Matching

Long blueprint logic blocks diluted the vector signal, so matching moved to
atom-level recall.

Representative files:

```text
archive/nucleus-rag-20260426/scripts/match_blueprint.py
archive/nucleus-rag-20260426/scripts/match_blueprint_atom.py
archive/nucleus-rag-20260426/scripts/match-blueprint-atoms.py
```

Failure mode:

Atom recall improved granularity, but it was still primarily narration-to-
narration matching. The system did not truly know what was visible in the
candidate clip.

## Stage 4: Visual Atom and Segment Index

The current direction converts narration atoms into structured visual
descriptions, then builds variable-length visual segments.

Representative files:

```text
scripts/build_visual_atom_index.py
scripts/build_visual_segment_index.py
scripts/match_visual_beats_to_segments.py
```

This is better, but still not perfect. The visual description is inferred from
narration and context, not from full frame recognition. That is why the final
pipeline uses LLM rerank and human feedback before drafting.

## Current Principle

RAG is allowed to be generous during recall. It is not allowed to be trusted as
the final editor.

The correct failure behavior is:

```text
no confident match -> no asset clip
```

not:

```text
weak related match -> force a wrong medical animation into the draft
```

