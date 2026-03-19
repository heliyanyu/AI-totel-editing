/**
 * 视频切割模块
 *
 * 按 blueprint 中 status=keep 的时间段切割原始视频，
 * 拼接为一个连续视频，并生成 timing_map.json。
 */

import { execFileSync } from "child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  existsSync,
} from "fs";
import { resolve, join } from "path";
import type {
  Blueprint,
  TimingMap,
  Transcript,
} from "../schemas/blueprint.js";
import type { PlanningStrategy } from "../schemas/workflow.js";
import {
  buildTimingMapFromBlueprint,
  getVideoDuration,
} from "../timing/planner.js";
import {
  validateTimingPlan,
  hasBlockingTimingIssues,
  formatTimingValidationFailures,
  writeTimingValidationReport,
} from "../timing/validate-timing-map.js";

const FADE_DURATION = 0.03;

export async function cutVideo(
  inputPath: string,
  blueprint: Blueprint,
  outputDir: string,
  strategy: PlanningStrategy = "legacy_time",
  transcript?: Transcript
): Promise<{ cutVideoPath: string; timingMap: TimingMap }> {
  inputPath = resolve(inputPath);
  outputDir = resolve(outputDir);
  mkdirSync(outputDir, { recursive: true });

  const totalDuration = getVideoDuration(inputPath);
  const timingMap = buildTimingMapFromBlueprint(
    blueprint,
    totalDuration,
    "cut_video",
    strategy,
    transcript
  );
  const timingValidation = validateTimingPlan(blueprint, timingMap);
  writeTimingValidationReport(outputDir, timingValidation);
  if (hasBlockingTimingIssues(timingValidation)) {
    throw new Error(`timing_map 校验失败:\n${formatTimingValidationFailures(timingValidation)}`);
  }
  const clips = timingMap.clips;

  console.log(`  提取 ${clips.length} 个 keep clip`);
  if (clips.length === 0) {
    throw new Error("没有 keep 段可以切割");
  }

  const tempFiles: string[] = [];
  const concatListPath = join(outputDir, "_concat_list.txt");

  try {
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const segFile = join(outputDir, `_seg_${String(i).padStart(3, "0")}.mp4`);
      tempFiles.push(segFile);

      const duration = clip.source.end - clip.source.start;
      console.log(
        `  切割段 ${i + 1}/${clips.length}: ${clip.source.start.toFixed(3)}s → ${clip.source.end.toFixed(3)}s (${duration.toFixed(3)}s)`
      );

      const audioFilters: string[] = [];
      if (i > 0) {
        audioFilters.push(`afade=t=in:st=0:d=${FADE_DURATION}`);
      }
      if (i < clips.length - 1) {
        const fadeOutStart = Math.max(0, duration - FADE_DURATION);
        audioFilters.push(`afade=t=out:st=${fadeOutStart}:d=${FADE_DURATION}`);
      }

      const ffmpegArgs = [
        "-y",
        "-ss",
        clip.source.start.toFixed(3),
        "-i",
        inputPath,
        "-t",
        duration.toFixed(3),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        ...(audioFilters.length > 0 ? ["-af", audioFilters.join(",")] : []),
        segFile,
      ];

      execFileSync("ffmpeg", ffmpegArgs, { stdio: "pipe" });
    }

    const concatContent = tempFiles
      .map((filePath) => `file '${filePath.replace(/\\/g, "/")}'`)
      .join("\n");
    writeFileSync(concatListPath, concatContent, "utf-8");

    const cutVideoPath = join(outputDir, "cut_video.mp4");
    console.log(`  拼接 ${clips.length} 个片段 → cut_video.mp4`);

    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatListPath,
        "-c",
        "copy",
        cutVideoPath,
      ],
      { stdio: "pipe" }
    );

    const timingMapPath = join(outputDir, "timing_map.json");
    writeFileSync(timingMapPath, JSON.stringify(timingMap, null, 2), "utf-8");
    console.log(`  timing_map 已保存: ${timingMapPath}`);

    return { cutVideoPath, timingMap };
  } finally {
    for (const filePath of tempFiles) {
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch {}
    }
    try {
      if (existsSync(concatListPath)) unlinkSync(concatListPath);
    } catch {}
  }
}

async function main() {
  const args = process.argv.slice(2);

  let inputPath = "";
  let blueprintPath = "";
  let outputDir = "";
  let transcriptPath = "";
  let strategy: PlanningStrategy = "legacy_time";

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
        outputDir = args[++i];
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
      "用法: npx tsx src/cut/index.ts --input doctor.mp4 --blueprint blueprint.json [-o output/]"
    );
    process.exit(1);
  }

  inputPath = resolve(inputPath);
  blueprintPath = resolve(blueprintPath);
  if (!outputDir) {
    outputDir = join(resolve("."), "output");
  }

  console.log(`输入视频: ${inputPath}`);
  console.log(`Blueprint: ${blueprintPath}`);
  console.log(`输出目录: ${outputDir}`);

  const blueprint: Blueprint = JSON.parse(readFileSync(blueprintPath, "utf-8"));
  const transcript: Transcript | undefined =
    transcriptPath && existsSync(resolve(transcriptPath))
      ? (JSON.parse(readFileSync(resolve(transcriptPath), "utf-8")) as Transcript)
      : undefined;

  console.log("\n开始切割...");
  const { cutVideoPath, timingMap } = await cutVideo(
    inputPath,
    blueprint,
    outputDir,
    strategy,
    transcript
  );

  console.log(`\n完成!`);
  console.log(`  切割视频: ${cutVideoPath}`);
  console.log(`  总时长: ${timingMap.totalDuration.toFixed(2)}s`);
  console.log(`  段数: ${timingMap.segments.length}`);
  console.log(`  clip数: ${timingMap.clips.length}`);
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("cut/index.ts") ||
    process.argv[1].endsWith("cut\\index.ts"));
if (isMainModule) {
  main().catch((err) => {
    console.error("错误:", err.message);
    process.exit(1);
  });
}



