/**
 * 全链路编排脚本
 *
 * 一个命令跑通：MP4 → 转录 → 语义分析 → 时间规划 → 可选渲染合成
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, basename, join, dirname } from "path";
import { DEFAULT_ANTHROPIC_MODEL } from "./config/models.js";

/** conda 环境 Python（CUDA + faster-whisper） */
const PYTHON_BIN = process.env.PYTHON_BIN || "F:\\miniconda3\\envs\\asr\\python.exe";
import { analyzeTranscript } from "./analyze/index.js";
import { cutVideo } from "./cut/index.js";
import { renderFinalVideo } from "./renderer/render.js";
import { postProcessBlueprint } from "./align/post-process.js";
import { buildDirectTimingMap } from "./timing/build-direct-timing-map.js";
import type { Transcript, Blueprint, TimingMap } from "./schemas/blueprint.js";
import type { JobManifest, RenderMode, PlanningStrategy } from "./schemas/workflow.js";
import { keepAtoms, discardAtoms, allSegments } from "./schemas/blueprint.js";

const DEFAULT_MODEL = DEFAULT_ANTHROPIC_MODEL;

interface PipelineArgs {
  input: string;
  output?: string;
  model?: string;
  step1Provider?: "anthropic" | "openai";
  step1Model?: string;
  takePassProvider?: "anthropic" | "openai";
  takePassModel?: string;
  openaiBaseUrl?: string;
  renderMode?: RenderMode;
  timingStrategy?: PlanningStrategy;
  skipTranscribe?: boolean;
  skipAnalyze?: boolean;
  transcriptPath?: string;
  blueprintPath?: string;
  scriptPath?: string;
}

function parseArgs(): PipelineArgs {
  const args = process.argv.slice(2);
  const result: PipelineArgs = { input: "", renderMode: "source_direct", timingStrategy: "media_range_v2" };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--input":
      case "-i":
        result.input = args[++i];
        break;
      case "--output":
      case "-o":
        result.output = args[++i];
        break;
      case "--model":
      case "-m":
        result.model = args[++i];
        break;
      case "--step1-provider":
        result.step1Provider = args[++i] as "anthropic" | "openai";
        break;
      case "--step1-model":
        result.step1Model = args[++i];
        break;
      case "--take-pass-provider":
        result.takePassProvider = args[++i] as "anthropic" | "openai";
        break;
      case "--take-pass-model":
        result.takePassModel = args[++i];
        break;
      case "--openai-base-url":
        result.openaiBaseUrl = args[++i];
        break;
      case "--render-mode":
        result.renderMode = args[++i] as RenderMode;
        break;
      case "--timing-strategy":
        result.timingStrategy = args[++i] as PlanningStrategy;
        break;
      case "--skip-transcribe":
        result.skipTranscribe = true;
        break;
      case "--skip-analyze":
        result.skipAnalyze = true;
        break;
      case "--transcript":
        result.transcriptPath = args[++i];
        result.skipTranscribe = true;
        break;
      case "--blueprint":
        result.blueprintPath = args[++i];
        result.skipTranscribe = true;
        result.skipAnalyze = true;
        break;
      case "--script":
      case "-s":
        result.scriptPath = args[++i];
        break;
      default:
        if (!result.input) result.input = args[i];
    }
  }

  return result;
}

async function stepTranscribe(
  inputPath: string,
  outputDir: string
): Promise<Transcript> {
  const transcriptPath = join(outputDir, "transcript.json");

  console.log("\n" + "=".repeat(50));
  console.log("Step 1/6: 提取音频并转录");
  console.log("=".repeat(50));

  const { fileURLToPath } = await import("url");
  const pythonScript = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "transcribe/index.py"
  );

  const cmd = `"${PYTHON_BIN}" "${pythonScript}" "${inputPath}" -o "${transcriptPath}"`;
  console.log(`  执行: ${cmd}`);

  execSync(cmd, {
    stdio: "inherit",
    timeout: 600_000,
  });

  const transcript: Transcript = JSON.parse(
    readFileSync(transcriptPath, "utf-8")
  );
  console.log(
    `  转录完成: ${transcript.words.length} 个词, 时长 ${transcript.duration}s`
  );

  return transcript;
}

async function stepAnalyze(
  transcript: Transcript,
  outputDir: string,
  model: string,
  scriptPath?: string,
  stageOverrides?: {
    step1Provider?: "anthropic" | "openai";
    step1Model?: string;
    takePassProvider?: "anthropic" | "openai";
    takePassModel?: string;
    openaiBaseUrl?: string;
  }
): Promise<Blueprint> {
  console.log("\n" + "=".repeat(50));
  console.log("Step 1→2: 语义拆解 + 结构编排");
  console.log("=".repeat(50));

  const blueprint = await analyzeTranscript(transcript, {
    model,
    step1Provider: stageOverrides?.step1Provider,
    step1Model: stageOverrides?.step1Model,
    takePassProvider: stageOverrides?.takePassProvider,
    takePassModel: stageOverrides?.takePassModel,
    openaiBaseUrl: stageOverrides?.openaiBaseUrl,
    outputDir,
    scriptPath,
  });

  const blueprintPath = join(outputDir, "blueprint.json");
  writeFileSync(blueprintPath, JSON.stringify(blueprint, null, 2), "utf-8");
  console.log(`  已保存: ${blueprintPath}`);

  return blueprint;
}

async function stepCut(
  inputPath: string,
  blueprint: Blueprint,
  outputDir: string,
  strategy: PlanningStrategy,
  transcript?: Transcript
): Promise<{ cutVideoPath: string; timingMap: TimingMap }> {
  console.log("\n" + "=".repeat(50));
  console.log("Step 3/6: 切割视频");
  console.log("=".repeat(50));

  const result = await cutVideo(inputPath, blueprint, outputDir, strategy, transcript);
  console.log(`  切割完成: ${result.timingMap.totalDuration.toFixed(2)}s`);

  return result;
}

async function stepBuildDirectTiming(
  inputPath: string,
  blueprint: Blueprint,
  outputDir: string,
  strategy: PlanningStrategy,
  transcript?: Transcript
): Promise<TimingMap> {
  console.log("\n" + "=".repeat(50));
  console.log("Step 3/6: 构建 source_direct 时间计划");
  console.log("=".repeat(50));

  const result = await buildDirectTimingMap(inputPath, blueprint, outputDir, strategy, transcript);
  console.log(`  时间计划完成: ${result.timingMap.totalDuration.toFixed(2)}s, ${result.timingMap.clips.length} clips`);

  return result.timingMap;
}

async function stepRender(
  outputDir: string,
  resultPath: string,
  renderMode: RenderMode,
  inputPath: string
): Promise<string> {
  console.log("\n" + "=".repeat(50));
  console.log("Step 4/6: 渲染信息图形（实体视频）");
  console.log("=".repeat(50));

  const finalPath = await renderFinalVideo({
    blueprintPath: join(outputDir, "blueprint.json"),
    timingMapPath: join(outputDir, "timing_map.json"),
    cutVideoPath:
      renderMode === "cut_video" ? join(outputDir, "cut_video.mp4") : undefined,
    sourceVideoPath: renderMode === "source_direct" ? inputPath : undefined,
    outputPath: resultPath,
  });

  return finalPath;
}

async function main() {
  const pargs = parseArgs();

  if (!pargs.input) {
    console.error("用法: npx tsx src/pipeline.ts --input doctor.mp4 [--output result.mp4]");
    console.error("");
    console.error("选项:");
    console.error("  --input, -i       输入 MP4 视频文件");
    console.error("  --output, -o      输出文件路径 (默认: output/{名称}/result.mp4)");
    console.error(`  --model, -m       Claude 模型 (默认: ${DEFAULT_MODEL})`);
    console.error("  --step1-provider  anthropic | openai");
    console.error("  --step1-model     Step1 单独模型");
    console.error("  --take-pass-provider anthropic | openai");
    console.error("  --take-pass-model Take-pass 单独模型");
    console.error("  --openai-base-url OpenAI-compatible base URL（Seed/Ark 用）");
    console.error("  --render-mode     source_direct | cut_video (默认: source_direct)");
    console.error("  --timing-strategy media_range_v2 | occurrence_reanchor_v1 | legacy_time (默认: source_direct→media_range_v2, cut_video→legacy_time)");
    console.error("  --script, -s      参考文案路径 (.docx/.txt/.md)");
    console.error("  --transcript      提供已有的 transcript.json，跳过转录");
    console.error("  --blueprint       提供已有的 blueprint.json，跳过转录和分析");
    console.error("  --skip-transcribe 跳过转录步骤");
    console.error("  --skip-analyze    跳过分析步骤");
    process.exit(1);
  }

  const renderMode = pargs.renderMode ?? "source_direct";
  if (renderMode !== "cut_video" && renderMode !== "source_direct") {
    console.error(`错误: 不支持的 render mode: ${renderMode}`);
    process.exit(1);
  }

  const timingStrategy = pargs.timingStrategy ?? (renderMode === "source_direct" ? "media_range_v2" : "legacy_time");
  if (
    timingStrategy !== "media_range_v2" &&
    timingStrategy !== "legacy_time" &&
    timingStrategy !== "occurrence_reanchor_v1"
  ) {
    console.error(`错误: 不支持的 timing strategy: ${timingStrategy}`);
    process.exit(1);
  }

  const inputPath = resolve(pargs.input);
  if (!existsSync(inputPath)) {
    console.error(`错误: 输入文件不存在: ${inputPath}`);
    process.exit(1);
  }

  const inputName = basename(inputPath, ".mp4");
  const now = new Date();
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const outputDir = resolve("output", `${inputName}_${timestamp}`);
  mkdirSync(outputDir, { recursive: true });

  const resultPath = pargs.output
    ? resolve(pargs.output)
    : join(outputDir, "result.mp4");
  const manifestPath = join(outputDir, "job_manifest.json");

  const model = pargs.model ?? DEFAULT_MODEL;
  const effectiveTakePassProvider = pargs.takePassProvider ?? "anthropic";
  const effectiveTakePassModel = pargs.takePassModel ?? DEFAULT_ANTHROPIC_MODEL;
  const resolvedScriptPath = pargs.scriptPath ? resolve(pargs.scriptPath) : null;

  const manifest: JobManifest = {
    jobDir: outputDir,
    sourceVideoPath: inputPath,
    sourceScriptPath: resolvedScriptPath,
    createdAt: new Date().toISOString(),
    model,
    step1Provider: pargs.step1Provider,
    step1Model: pargs.step1Model ?? null,
    takePassProvider: effectiveTakePassProvider,
    takePassModel: effectiveTakePassModel,
    renderMode,
    planningStrategy: timingStrategy,
    transcriptPath: join(outputDir, "transcript.json"),
    blueprintPath: join(outputDir, "blueprint.json"),
    timingMapPath: join(outputDir, "timing_map.json"),
    cutVideoPath: renderMode === "cut_video" ? join(outputDir, "cut_video.mp4") : null,
    resultPath: resultPath,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║     全链路自动视频生产 Pipeline              ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`  输入:   ${inputPath}`);
  console.log(`  输出:   ${resultPath}`);
  console.log(`  工作区: ${outputDir}`);
  console.log(`  模型:   ${model}`);
  if (pargs.step1Provider || pargs.step1Model) {
    console.log(
      `  Step1:  ${(pargs.step1Provider ?? "anthropic")}:${pargs.step1Model ?? model}`
    );
  }
  console.log(`  Take:   ${effectiveTakePassProvider}:${effectiveTakePassModel}`);
  console.log(`  模式:   ${renderMode}`);
  console.log(`  策略:   ${timingStrategy}`);
  if (resolvedScriptPath) {
    console.log(`  文案:   ${resolvedScriptPath}`);
  }

  const startTime = Date.now();

  let transcript: Transcript;
  if (pargs.transcriptPath) {
    console.log(`\n  跳过转录，使用已有文件: ${pargs.transcriptPath}`);
    transcript = JSON.parse(readFileSync(resolve(pargs.transcriptPath), "utf-8"));
    writeFileSync(
      join(outputDir, "transcript.json"),
      JSON.stringify(transcript, null, 2),
      "utf-8"
    );
  } else if (pargs.skipTranscribe) {
    const existingPath = join(outputDir, "transcript.json");
    if (!existsSync(existingPath)) {
      throw new Error(`跳过转录但找不到 ${existingPath}`);
    }
    transcript = JSON.parse(readFileSync(existingPath, "utf-8"));
  } else {
    transcript = await stepTranscribe(inputPath, outputDir);
  }

  let blueprint: Blueprint;
  if (pargs.blueprintPath) {
    console.log(`\n  跳过分析，使用已有文件: ${pargs.blueprintPath}`);
    blueprint = JSON.parse(readFileSync(resolve(pargs.blueprintPath), "utf-8"));
    writeFileSync(
      join(outputDir, "blueprint.json"),
      JSON.stringify(blueprint, null, 2),
      "utf-8"
    );
  } else if (pargs.skipAnalyze) {
    const existingPath = join(outputDir, "blueprint.json");
    if (!existsSync(existingPath)) {
      throw new Error(`跳过分析但找不到 ${existingPath}`);
    }
    blueprint = JSON.parse(readFileSync(existingPath, "utf-8"));
  } else {
    blueprint = await stepAnalyze(transcript, outputDir, model, pargs.scriptPath, {
      step1Provider: pargs.step1Provider,
      step1Model: pargs.step1Model,
      takePassProvider: effectiveTakePassProvider,
      takePassModel: effectiveTakePassModel,
      openaiBaseUrl: pargs.openaiBaseUrl,
    });
  }

  if (pargs.blueprintPath) {
    console.log("\n" + "=".repeat(50));
    console.log("Step 2.5: Words 对齐后处理");
    console.log("=".repeat(50));

    let reviewedTranscript: Transcript | undefined;
    const reviewedCandidates = [
      join(outputDir, "reviewed_transcript.json"),
      join(dirname(resolve(pargs.blueprintPath)), "reviewed_transcript.json"),
    ];
    const reviewedPath = reviewedCandidates.find((candidate) => existsSync(candidate));
    if (reviewedPath) {
      reviewedTranscript = JSON.parse(readFileSync(reviewedPath, "utf-8"));
      console.log(`  使用 reviewed transcript: ${reviewedPath}`);
    }

    postProcessBlueprint(
      blueprint,
      transcript,
      reviewedTranscript ?? transcript,
      { debugPath: join(outputDir, "atom_alignment_debug.json") }
    );
    writeFileSync(
      join(outputDir, "blueprint.json"),
      JSON.stringify(blueprint, null, 2),
      "utf-8"
    );
  }

  let timingMap: TimingMap;
  let finalPath: string | null = null;

  if (renderMode === "source_direct") {
    timingMap = await stepBuildDirectTiming(inputPath, blueprint, outputDir, timingStrategy, transcript);
    if (timingStrategy === "occurrence_reanchor_v1") {
      writeFileSync(
        join(outputDir, "blueprint.json"),
        JSON.stringify(blueprint, null, 2),
        "utf-8"
      );
    }
    finalPath = await stepRender(outputDir, resultPath, renderMode, inputPath);
  } else {
    const cutResult = await stepCut(inputPath, blueprint, outputDir, timingStrategy, transcript);
    timingMap = cutResult.timingMap;
    finalPath = await stepRender(outputDir, resultPath, renderMode, inputPath);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const keeps = keepAtoms(blueprint);
  const discards = discardAtoms(blueprint);
  const segments = allSegments(blueprint);

  console.log("\n" + "=".repeat(50));
  console.log("完成!");
  console.log("=".repeat(50));
  if (finalPath) {
    console.log(`  输出:     ${finalPath}`);
  }
  console.log(`  原始时长: ${transcript.duration.toFixed(1)}s`);
  console.log(`  成片时长: ${timingMap.totalDuration.toFixed(1)}s`);
  console.log(`  场景:     ${blueprint.scenes.length} 个`);
  console.log(`  逻辑段:   ${segments.length} 个`);
  console.log(`  裁剪:     ${discards.length} 个废料原子块`);
  console.log(`  保留:     ${keeps.length} 个原子块`);
  console.log(`  耗时:     ${elapsed}s`);
  console.log("");
  console.log("中间产物:");
  console.log(`  ${manifestPath}`);
  console.log(`  ${join(outputDir, "transcript.json")}`);
  console.log(`  ${join(outputDir, "step1_result.json")}`);
  console.log(`  ${join(outputDir, "step1_cleaned.json")}`);
  console.log(`  ${join(outputDir, "step2_diagnostics.json")}`);
  console.log(`  ${join(outputDir, "blueprint.json")}`);
  console.log(`  ${join(outputDir, "timing_map.json")}`);
  console.log(`  ${join(outputDir, "timing_validation_report.json")}`);
  if (renderMode === "cut_video") {
    console.log(`  ${join(outputDir, "cut_video.mp4")}`);
  } else {
    console.log(`  ${join(outputDir, "timing_clips_debug.json")}`);
  }
}

main().catch((err) => {
  console.error("\n❌ Pipeline 错误:", err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});



