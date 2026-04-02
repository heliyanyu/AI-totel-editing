# Editing V1

This folder is the curated core of the current editing pipeline.

Included:
- `src/analyze`
- `src/transcribe`
- `src/force-align`
- `src/align`
- `src/compose`
- `src/config`
- `src/remotion`
- `src/renderer`
- `src/schemas`
- `src/timing`
- `scripts/rebuild-output-from-blueprint.ts`
- `ARCHITECTURE_REBUILD.md`

Intentionally excluded:
- `editor`
- `output`
- `node_modules`
- `src/cut`
- `src/matting`
- `src/transcribe`
- most ad-hoc scripts and reports
- test assets and historical experiments

Recommended reading order:
1. `ARCHITECTURE_REBUILD.md`
2. `src/analyze`
3. `src/align`
4. `src/timing`
5. `src/renderer`
6. `src/compose`

Main runtime entry points kept here:
- `scripts/transcribe-qwen.py`
- `scripts/force-align-qwen.py`
- `src/analyze/index.ts`
- `src/timing/build-direct-timing-map.ts`
- `src/renderer/render.ts`
- `scripts/rebuild-output-from-blueprint.ts`

Current focus of the project:
- transcribe -> force-align -> review -> semantic -> audio take/pass -> align -> timing -> renderer/compose
- source_direct audio path
- case03 downstream alignment and timing quality

Analyze-stage LLM defaults:
- `review`, `step1`, `take-pass`, `step2` now default to `claude-sonnet-4-6` via Anthropic API
- preferred env var: `ANTHROPIC_API_KEY`

Qwen3-ASR integration:
- standalone:
  `python scripts/transcribe-qwen.py --audio doctor.mp4 --output-dir F:\AI total editing\output\caseXX`
- integrated analyze:
  `npx tsx src/analyze/index.ts --audio doctor.mp4 --transcribe-qwen -o blueprint.json`
- outputs:
  `transcript.json`
  `transcript.txt`
  `transcribe_qwen_manifest.json`

Qwen3-ForcedAligner integration:
- standalone:
  `python scripts/force-align-qwen.py --audio doctor.mp4 --transcript transcript.json --output-dir F:\AI total editing\output\caseXX`
- integrated analyze:
  `npx tsx src/analyze/index.ts --transcript transcript.json --audio doctor.mp4 --force-align-qwen -o blueprint.json`
- outputs:
  `transcript_aligned_words.json`
  `transcript_aligned_tokens.json`
  `force_align_manifest.json`

Output convention:
- Do not create a new `output` folder inside `editing V1`
- Continue using the shared output root:
  `F:\AI total editing\output`
- Every render output directory now has two canonical video artifacts:
  `overlay_layer.mp4` (silent overlay/render layer for manual downstream compositing)
  `source_direct_cut_video.mp4` (the cut original-doctor video used for downstream stitching)
- Every render output directory also writes:
  `render_outputs.json`
