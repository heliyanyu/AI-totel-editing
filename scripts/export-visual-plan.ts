/**
 * Standalone script to export visual_plan.json from blueprint + timing_map.
 *
 * Usage: npx tsx scripts/export-visual-plan.ts <case_out_dir>
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import type { Blueprint, TimingMap } from "../src/schemas/blueprint.js";
import { segmentsToRenderScenes } from "../src/compose/segment-to-scene.js";
import { buildRenderSegmentSequencePlans } from "../src/compose/pipeline-plan.js";
import { buildVisualPlan } from "../src/compose/visual-planner.js";

const VIDEO_FPS = 30;

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: npx tsx scripts/export-visual-plan.ts <case_out_dir>");
  process.exit(1);
}

const bpPath = resolve(dir, "blueprint.json");
const tmPath = resolve(dir, "timing_map.json");

const blueprint: Blueprint = JSON.parse(readFileSync(bpPath, "utf-8"));
const timingMap: TimingMap = JSON.parse(readFileSync(tmPath, "utf-8"));

const totalDurationFrames = Math.ceil(timingMap.totalDuration * VIDEO_FPS);
const renderInfos = segmentsToRenderScenes(blueprint, timingMap);
const renderSegmentPlans = buildRenderSegmentSequencePlans(
  renderInfos,
  timingMap,
  VIDEO_FPS,
  totalDurationFrames
);
const visualPlan = buildVisualPlan(blueprint, renderSegmentPlans);

const output = {
  fps: VIDEO_FPS,
  totalFrames: totalDurationFrames,
  segments: visualPlan.segments.map((s) => ({
    fromFrame: s.fromFrame,
    contentDurationInFrames: s.contentDurationInFrames,
    topicId: s.topicId,
    tone: s.tone,
  })),
  topicNodes: visualPlan.topicNodes,
  topicAppearances: visualPlan.topicAppearances,
};

const outPath = resolve(dir, "visual_plan.json");
writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
console.log(`Exported: ${outPath}`);
console.log(`  ${output.topicNodes.length} topics, ${output.segments.length} segments, ${totalDurationFrames} frames`);
