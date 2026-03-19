# Editing V1

This folder is the curated core of the current editing pipeline.

Included:
- `src/analyze`
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
- `src/analyze/index.ts`
- `src/timing/build-direct-timing-map.ts`
- `src/renderer/render.ts`
- `scripts/rebuild-output-from-blueprint.ts`

Current focus of the project:
- review -> semantic -> audio take/pass -> align -> timing -> renderer/compose
- source_direct audio path
- case03 downstream alignment and timing quality

Output convention:
- Do not create a new `output` folder inside `editing V1`
- Continue using the shared output root:
  `F:\AI total editing\output`
