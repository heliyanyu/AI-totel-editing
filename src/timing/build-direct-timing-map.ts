import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import type { Blueprint, Transcript } from "../schemas/blueprint.js";
import type { PlanningStrategy } from "../schemas/workflow.js";
import {
  validateTimingPlan,
  hasBlockingTimingIssues,
  formatTimingValidationFailures,
  writeTimingValidationReport,
} from "./validate-timing-map.js";
import {
  buildTimingMapFromBlueprint,
  buildTimingSegments,
  getVideoDuration,
} from "./planner.js";
import { reanchorBlueprintOccurrences } from "./reanchor-occurrences.js";
import { refineSourceDirectClipsWithAcousticTails } from "./acoustic-tail.js";

export async function buildDirectTimingMap(
  inputPath: string,
  blueprint: Blueprint,
  outputTarget: string,
  strategy: PlanningStrategy = "media_range_v2",
  transcript?: Transcript
) {
  const resolvedInput = resolve(inputPath);
  const resolvedOutputTarget = resolve(outputTarget);
  const isJsonTarget = resolvedOutputTarget.toLowerCase().endsWith(".json");
  const resolvedOutputDir = isJsonTarget ? dirname(resolvedOutputTarget) : resolvedOutputTarget;
  mkdirSync(resolvedOutputDir, { recursive: true });

  const effectiveBlueprint =
    strategy === "occurrence_reanchor_v1" && transcript
      ? reanchorBlueprintOccurrences(blueprint, transcript, {
          debugDir: resolvedOutputDir,
        })
      : blueprint;

  const totalDuration = getVideoDuration(resolvedInput);
  const timingMap = buildTimingMapFromBlueprint(
    effectiveBlueprint,
    totalDuration,
    "source_direct",
    strategy,
    transcript
  );
  timingMap.clips = refineSourceDirectClipsWithAcousticTails(
    resolvedInput,
    effectiveBlueprint,
    timingMap.clips
  );
  timingMap.segments = buildTimingSegments(
    effectiveBlueprint,
    timingMap.clips,
    strategy
  );
  timingMap.totalDuration =
    timingMap.clips.length > 0
      ? timingMap.clips[timingMap.clips.length - 1].output.end
      : 0;

  const timingMapPath = isJsonTarget ? resolvedOutputTarget : join(resolvedOutputDir, "timing_map.json");
  const debugPath = join(resolvedOutputDir, "timing_clips_debug.json");
  const timingValidation = validateTimingPlan(effectiveBlueprint, timingMap);
  const timingValidationPath = writeTimingValidationReport(resolvedOutputDir, timingValidation);

  if (hasBlockingTimingIssues(timingValidation)) {
    throw new Error(
      `timing_map 校验失败:\n${formatTimingValidationFailures(timingValidation)}`
    );
  }

  writeFileSync(timingMapPath, JSON.stringify(timingMap, null, 2), "utf-8");
  writeFileSync(debugPath, JSON.stringify(timingMap.clips, null, 2), "utf-8");

  return { timingMapPath, timingMap, timingValidationPath, timingValidation };
}

async function main() {
  const args = process.argv.slice(2);
  let inputPath = "";
  let blueprintPath = "";
  let outputPath = "";
  let transcriptPath = "";
  let strategy: PlanningStrategy = "media_range_v2";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--input":
      case "-i":
        inputPath = args[++i];
        break;
      case "--blueprint":
      case "-b":
        blueprintPath = args[++i];
        break;
      case "--output":
      case "-o":
        outputPath = args[++i];
        break;
      case "--transcript":
      case "-t":
        transcriptPath = args[++i];
        break;
      case "--strategy":
        strategy = args[++i] as PlanningStrategy;
        break;
    }
  }

  if (!inputPath || !blueprintPath) {
    console.error(
      "用法: npx tsx src/timing/build-direct-timing-map.ts --input doctor.mp4 --blueprint blueprint.json [--transcript transcript.json] [--strategy media_range_v2|occurrence_reanchor_v1|legacy_time] [-o timing_map.json]"
    );
    process.exit(1);
  }

  const resolvedBlueprintPath = resolve(blueprintPath);
  const blueprint: Blueprint = JSON.parse(
    readFileSync(resolvedBlueprintPath, "utf-8")
  );
  const resolvedTranscriptPath = transcriptPath
    ? resolve(transcriptPath)
    : join(dirname(resolvedBlueprintPath), "transcript.json");
  const transcript: Transcript | undefined = existsSync(resolvedTranscriptPath)
    ? (JSON.parse(readFileSync(resolvedTranscriptPath, "utf-8")) as Transcript)
    : undefined;
  const outputTarget = outputPath
    ? resolve(outputPath)
    : dirname(resolvedBlueprintPath);

  const { timingMapPath, timingMap, timingValidationPath } = await buildDirectTimingMap(
    inputPath,
    blueprint,
    outputTarget,
    strategy,
    transcript
  );

  console.log(`timing_map 已保存: ${timingMapPath}`);
  console.log(`timing 校验报告: ${timingValidationPath}`);
  console.log(`模式: ${timingMap.mode}`);
  console.log(`策略: ${strategy}`);
  console.log(`clips: ${timingMap.clips.length}`);
  console.log(`segments: ${timingMap.segments.length}`);
  console.log(`总时长: ${timingMap.totalDuration.toFixed(2)}s`);
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("timing/build-direct-timing-map.ts") ||
    process.argv[1].endsWith("timing\\build-direct-timing-map.ts"));
if (isMainModule) {
  main().catch((err) => {
    console.error("错误:", err.message);
    process.exit(1);
  });
}
