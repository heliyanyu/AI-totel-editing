import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

import { buildRenderSegmentSequencePlans } from "../compose/pipeline-plan.js";
import { segmentsToRenderScenes } from "../compose/segment-to-scene.js";
import { buildVisualPlan } from "../compose/visual-planner.js";
import { VIDEO_FPS } from "../remotion/utils.js";
import type { Blueprint, TimingMap } from "../schemas/blueprint.js";

interface Args {
  blueprintPath: string;
  timingMapPath: string;
  outputPath: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    blueprintPath: "",
    timingMapPath: "",
    outputPath: "",
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--blueprint" || arg === "-b") args.blueprintPath = argv[++i];
    else if (arg === "--timing-map" || arg === "-t") args.timingMapPath = argv[++i];
    else if (arg === "--output" || arg === "-o") args.outputPath = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.blueprintPath || !args.timingMapPath || !args.outputPath) {
    throw new Error(
      "Usage: npx tsx src/renderer/export-visual-plan.ts -b blueprint.json -t timing_map.json -o visual_plan.json"
    );
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const blueprint: Blueprint = JSON.parse(
    readFileSync(resolve(args.blueprintPath), "utf-8")
  );
  const timingMap: TimingMap = JSON.parse(
    readFileSync(resolve(args.timingMapPath), "utf-8")
  );
  const totalDurationFrames = Math.ceil(timingMap.totalDuration * VIDEO_FPS);
  const renderInfos = segmentsToRenderScenes(blueprint, timingMap);
  const renderSegmentPlans = buildRenderSegmentSequencePlans(
    renderInfos,
    timingMap,
    VIDEO_FPS,
    totalDurationFrames
  );
  const visualPlan = buildVisualPlan(blueprint, renderSegmentPlans);
  const outputPath = resolve(args.outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        fps: VIDEO_FPS,
        totalFrames: totalDurationFrames,
        segments: visualPlan.segments.map((s) => ({
          key: s.key,
          fromFrame: s.fromFrame,
          contentDurationInFrames: s.contentDurationInFrames,
          topicId: s.topicId,
          topicSegmentIndex: s.topicSegmentIndex,
          label:
            s.renderScene.items[0]?.text ??
            s.renderScene.title ??
            s.renderScene.variant_id ??
            s.key,
          tone: s.tone,
        })),
        topicNodes: visualPlan.topicNodes,
        topicAppearances: visualPlan.topicAppearances,
      },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`Wrote visual plan: ${outputPath}`);
}

main();
