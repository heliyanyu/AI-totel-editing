# Project Summary For Next Session

## Workspace Convention

- Core code workspace:
  `F:\AI total editing\editing V1`
- Shared output root:
  `F:\AI total editing\output`
- Architecture reference:
  `F:\AI total editing\ARCHITECTURE_REBUILD.md`

Do not start writing outputs into `editing V1\output`.
All new runs should continue to write into `F:\AI total editing\output`.

## What This Project Is

This project is an editing pipeline that turns a source talking-head video into a structured, rendered explainer video.

The intended formal pipeline is:

1. `review`
2. `semantic / step1`
3. `audio take/pass`
4. `step2 / blueprint`
5. `align / strong mapping`
6. `timing`
7. `renderer / compose`

In short:

`reviewed_transcript -> semantic atoms -> keep/discard -> blueprint -> media_range -> timing_map -> result.mp4`

## Current Folder Split

The old workspace had too much historical and experimental material mixed together.

`editing V1` now keeps only the core code:

- `src/analyze`
- `src/align`
- `src/timing`
- `src/renderer`
- `src/compose`
- `src/remotion`
- `src/schemas`
- `src/config`
- `scripts/rebuild-output-from-blueprint.ts`

Not included in `editing V1`:

- `editor`
- `output`
- `node_modules`
- `src/cut`
- `src/matting`
- `src/transcribe`
- historical scripts, reports, and test assets

## Formal Architecture Intent

Based on `ARCHITECTURE_REBUILD.md`, the important boundaries are:

### 1. Review Channel

Input:
- raw `transcript.json`
- optional doc reference

Output:
- `review_spans.json`
- `reviewed_transcript.json`

Responsibility:
- clean transcript text while keeping source anchoring

Not responsible for:
- take/pass
- logic splitting
- final audio cutting

### 2. Semantic Channel

Input:
- `reviewed_transcript.json`

Output:
- `step1_result.json`
- `step1_cleaned.json`
- semantic structure used by step2

Responsibility:
- split into `scene / logic / atom`

Not responsible for:
- final discard
- final audio spans

Important:
- semantic atoms are semantic editing units
- they are not guaranteed final audio playback units

### 3. Audio Take/Pass Channel

Input:
- semantic atoms
- reviewed transcript

Output:
- `take_pass_result.json`
- `step1_taken.json`
- implicit / explicit `audio_spans`

Responsibility:
- decide what is kept vs discarded for final spoken playback

Important:
- current accepted truth for case03 is mostly represented by `take_pass_annotation.md`

### 4. Step2 / Blueprint Channel

Responsibility:
- organize kept material into scene and render structure

Key output:
- `blueprint_merged.json`
- `blueprint.json`

### 5. Align / Strong Mapping Channel

Responsibility:
- map keep atoms back to source transcript timing
- produce `words` and `media_range` per keep atom

This is the current pain point.

### 6. Timing Channel

Responsibility:
- convert keep atoms / media ranges into final `timing_map.clips`

### 7. Renderer / Compose Channel

Responsibility:
- cut / concat source audio
- overlay subtitles and templates
- render final video

## Current Main Code Paths

### Analyze

- `F:\AI total editing\editing V1\src\analyze\review`
- `F:\AI total editing\editing V1\src\analyze\semantic`
- `F:\AI total editing\editing V1\src\analyze\audio`

### Align

- `F:\AI total editing\editing V1\src\align\subtitle-align.ts`
- `F:\AI total editing\editing V1\src\align\index.ts`
- `F:\AI total editing\editing V1\src\align\media-range.ts`

### Timing

- `F:\AI total editing\editing V1\src\timing\audio-plan.ts`
- `F:\AI total editing\editing V1\src\timing\build-direct-timing-map.ts`
- `F:\AI total editing\editing V1\src\timing\acoustic-tail.ts`

### Render

- `F:\AI total editing\editing V1\src\renderer\source-direct-audio.ts`
- `F:\AI total editing\editing V1\src\renderer\final-video.ts`
- `F:\AI total editing\editing V1\src\renderer\render.ts`

## Current Best Understanding Of The Problem

For case03, `take/pass` itself is not the main blocker anymore.
The user generally accepted the take/pass annotation result as the intended semantic truth.

The main unresolved issue is downstream:

- keep/discard truth is not being converted into stable final audio truth
- the biggest suspect is `align / media_range`

More specifically:

- current strong mapping is still too atom-local
- it aligns each keep atom mostly in isolation
- it does not fully understand restart / repair relationships on the left side
- it therefore can produce `media_range` choices that are structurally legal but not perceptually correct

This is why the user feels:

- some deleted starts still sound present
- some sentence ends still feel cut too early
- final audio does not always feel strictly aligned to the accepted take/pass result

## Case03 Status

### Case03 Truth User Mostly Accepts

Reference file:
- `F:\AI total editing\output\case03_opus46_repairpass_20260319_rerun1\take_pass_annotation.md`

This is currently the most important “semantic truth” reference for debugging downstream behavior.

### Recent Outputs Worth Inspecting

- `F:\AI total editing\output\case03_opus46_repairpass_20260319_rerun1`
- `F:\AI total editing\output\case03_opus46_repairpass_20260319_acoustictail_v3`
- `F:\AI total editing\output\case03_opus46_repairpass_20260319_repairaware_align_v1`

Useful files inside those runs:

- `take_pass_annotation.md`
- `step1_taken.json`
- `blueprint.json`
- `atom_alignment_debug.json`
- `timing_map.json`
- `source_direct_audio.wav`
- `result.mp4`

## Known Concrete Content Issues

### Step1 issue to remember later

Do not fix yet, but keep it on the list:

- `~~[深]~~ || A19{[度睡眠时]}`

Interpretation:
- `step1` split `深度睡眠时` incorrectly
- this is a future `step1 prompt / atomization` fix
- not the current downstream focus

### Downstream listening complaints repeatedly raised by the user

- sentence ends still feel cut too early in some places
- user believes some deleted starts still sound present
- user does not trust current downstream fidelity to take/pass

## Practical Rule For The Next Session

Do not restart from broad prompt tweaking.

Start from this assumption:

`take/pass semantic truth is acceptable enough for case03; focus on making downstream audio strictly obey that truth.`

That means the next session should primarily inspect:

1. `subtitle-align.ts`
2. `align/index.ts`
3. `media-range.ts`
4. `audio-plan.ts`
5. `source-direct-audio.ts`

## Recommended Starting Questions For The Next Session

1. Should strong mapping operate on isolated atoms, or on larger kept spans / restart-aware groups?
2. Should `discard` neighbors become hard exclusion constraints during occurrence selection, instead of only later timing clamps?
3. Should sentence-end cut decisions use stronger acoustic logic than plain word boundaries?
4. Should the accepted `take_pass_annotation.md` become a stricter downstream contract artifact?

## Rebuild Script Kept For Fast Debugging

To rebuild from existing outputs without rerunning LLMs:

- `F:\AI total editing\editing V1\scripts\rebuild-output-from-blueprint.ts`

This is meant for:

- load existing `blueprint_merged.json`
- rerun `postProcessBlueprint`
- rebuild `timing_map`
- rerender `result.mp4`

## Minimal Mental Model

If continuing quickly in a new session, use this short version:

- `review` cleans text
- `semantic` creates atoms
- `take/pass` decides keep/discard
- `step2` builds blueprint
- `align` decides actual source audio ranges
- `timing` turns ranges into clips
- `renderer` produces final audio/video

Current bottleneck:

- `align / media_range` is still not faithfully translating accepted take/pass truth into final audio
