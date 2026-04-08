/**
 * 程序化 Remotion 渲染
 *
 * 读取 blueprint + timing_map，输出透明 overlay layer。
 * 医生真人画面和其他素材层保持独立，供后期手工拼接。
 */

import { renderMedia, selectComposition } from "@remotion/renderer";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { basename, dirname, extname, resolve } from "path";
import { VIDEO_FPS } from "../remotion/utils.js";
import type { Blueprint, TimingMap } from "../schemas/blueprint.js";
import { allAtoms } from "../schemas/blueprint.js";
import {
  formatTimingValidationFailures,
  hasBlockingTimingIssues,
  validateTimingPlan,
} from "../timing/validate-timing-map.js";
import { resolveAvailableH264HardwareEncoder } from "./hardware-encoder.js";
import { prepareRemotionBinariesWithSystemFfmpeg } from "./remotion-binaries.js";
import { bundleRemotionProject } from "./bundle.js";
import { resolveRenderConcurrency } from "./render-concurrency.js";
import { renderSourceDirectCutVideo } from "./source-direct-video.js";
import { segmentsToRenderScenes } from "../compose/segment-to-scene.js";
import { buildRenderSegmentSequencePlans } from "../compose/pipeline-plan.js";
import { buildVisualPlan } from "../compose/visual-planner.js";

export interface RenderOptions {
  blueprintPath: string;
  timingMapPath: string;
  cutVideoPath?: string;
  sourceVideoPath?: string;
  outputPath: string;
  codec?: "h264" | "h265" | "vp8" | "vp9" | "prores";
  concurrency?: number;
}

export interface RenderArtifacts {
  overlayLayerPath: string;
  resultPath: string;
  cutSourceVideoPath?: string;
  sourceVideoPath?: string;
  timingMode: string;
  renderOutputsPath: string;
}

function applyNvencOverride(args: string[]): string[] {
  const overridden = [...args];
  const codecIndex = overridden.findIndex(
    (value, index) => value === "-c:v" && overridden[index + 1] === "libx264"
  );
  if (codecIndex !== -1) {
    overridden[codecIndex + 1] = "h264_nvenc";
  }

  for (let index = overridden.length - 2; index >= 0; index--) {
    const key = overridden[index];
    if (key === "-crf" || key === "-preset") {
      overridden.splice(index, 2);
    }
  }

  const outputPath = overridden[overridden.length - 1];
  const insertionIndex = Math.max(0, overridden.length - 2);
  overridden.splice(
    insertionIndex,
    0,
    "-preset",
    "p5",
    "-tune",
    "hq",
    "-rc",
    "vbr",
    "-cq",
    "19",
    "-b:v",
    "0"
  );

  overridden[overridden.length - 1] = outputPath;
  return overridden;
}

function logBrowserMessage(stage: "select" | "render") {
  return (log: { type: string; text: string }) => {
    if (log.text.includes("__remotion_level_verbose")) return;
    const prefix = `[remotion:${stage}:${log.type}]`;
    const message = `${prefix} ${log.text}`;
    if (log.type === "error") {
      console.error(message);
      return;
    }
    console.warn(message);
  };
}


function copyOrLinkFile(sourcePath: string, destPath: string): void {
  if (resolve(sourcePath).toLowerCase() === resolve(destPath).toLowerCase()) {
    return;
  }

  if (existsSync(destPath)) {
    copyFileSync(sourcePath, destPath);
    return;
  }

  try {
    linkSync(sourcePath, destPath);
  } catch {
    copyFileSync(sourcePath, destPath);
  }
}

function ensureCutSourceVideo(
  timingMap: TimingMap,
  options: RenderOptions
): { cutSourceVideoPath?: string; sourceVideoPath?: string } {
  const outputDir = dirname(resolve(options.outputPath));

  if (timingMap.mode === "source_direct") {
    if (!options.sourceVideoPath) {
      throw new Error("timing_map.mode=source_direct 时必须提供 sourceVideoPath");
    }

    const resolvedSourceVideoPath = resolve(options.sourceVideoPath);
    const cutSourceVideoPath = resolve(outputDir, "source_direct_cut_video.mp4");

    renderSourceDirectCutVideo(
      resolvedSourceVideoPath,
      timingMap,
      cutSourceVideoPath
    );

    return {
      cutSourceVideoPath,
      sourceVideoPath: resolvedSourceVideoPath,
    };
  }

  if (!options.cutVideoPath) {
    throw new Error("timing_map.mode=cut_video 时必须提供 cutVideoPath");
  }

  const resolvedCutVideoPath = resolve(options.cutVideoPath);
  const canonicalCutVideoPath = resolve(outputDir, "source_direct_cut_video.mp4");
  copyOrLinkFile(resolvedCutVideoPath, canonicalCutVideoPath);

  return {
    cutSourceVideoPath: canonicalCutVideoPath,
    sourceVideoPath: options.sourceVideoPath
      ? resolve(options.sourceVideoPath)
      : undefined,
  };
}

function normalizeOverlayOutputPath(
  outputPath: string,
  codec: RenderOptions["codec"]
): string {
  const resolvedOutputPath = resolve(outputPath);
  if (codec === "prores") {
    if (extname(resolvedOutputPath).toLowerCase() === ".mov") {
      return resolvedOutputPath;
    }

    const normalized = resolve(
      dirname(resolvedOutputPath),
      `${basename(resolvedOutputPath, extname(resolvedOutputPath))}.mov`
    );
    console.log(`  overlay 输出改写为 ProRes 容器: ${normalized}`);
    return normalized;
  }

  if (extname(resolvedOutputPath).toLowerCase() === ".mp4") {
    return resolvedOutputPath;
  }

  const normalized = resolve(
    dirname(resolvedOutputPath),
    `${basename(resolvedOutputPath, extname(resolvedOutputPath))}.mp4`
  );
  console.log(`  overlay 输出改写为 MP4 容器: ${normalized}`);
  return normalized;
}

export async function renderFinalVideo(
  options: RenderOptions
): Promise<RenderArtifacts> {
  const {
    blueprintPath,
    timingMapPath,
    outputPath,
    codec = "h264",
    concurrency,
  } = options;

  const blueprint: Blueprint = JSON.parse(
    readFileSync(resolve(blueprintPath), "utf-8")
  );
  const timingMap: TimingMap = JSON.parse(
    readFileSync(resolve(timingMapPath), "utf-8")
  );

  const atoms = allAtoms(blueprint);
  const totalDurationFrames = Math.ceil(timingMap.totalDuration * VIDEO_FPS);
  const timingValidation = validateTimingPlan(blueprint, timingMap);
  if (hasBlockingTimingIssues(timingValidation)) {
    throw new Error(
      `渲染前 timing 校验失败:\n${formatTimingValidationFailures(timingValidation)}`
    );
  }
  if (timingValidation.summary.warn_count > 0) {
    console.log(`  timing 警告: ${timingValidation.summary.warn_count} 条`);
  }

  const resolvedOutput = normalizeOverlayOutputPath(outputPath, codec);
  mkdirSync(dirname(resolvedOutput), { recursive: true });

  // Export visual plan JSON for Python renderers (progress_bar, navigation)
  const renderInfos = segmentsToRenderScenes(blueprint, timingMap);
  const renderSegmentPlans = buildRenderSegmentSequencePlans(
    renderInfos,
    timingMap,
    VIDEO_FPS,
    totalDurationFrames
  );
  const visualPlan = buildVisualPlan(blueprint, renderSegmentPlans);
  const visualPlanPath = resolve(dirname(resolvedOutput), "visual_plan.json");
  writeFileSync(
    visualPlanPath,
    JSON.stringify(
      {
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
      },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`  visual_plan.json: ${visualPlanPath}`);

  const media = ensureCutSourceVideo(timingMap, options);
  if (media.cutSourceVideoPath) {
    console.log(`  剪裁原视频: ${media.cutSourceVideoPath}`);
  }

  console.log(`  Blueprint: ${blueprint.scenes.length} 场景, ${atoms.length} 原子块`);
  console.log(`  模式: ${timingMap.mode}`);
  console.log(
    `  时长: ${timingMap.totalDuration.toFixed(2)}s (${totalDurationFrames} frames)`
  );

  const resolvedConcurrency = resolveRenderConcurrency(
    timingMap.mode,
    concurrency
  );
  if (resolvedConcurrency !== null) {
    console.log(`  并发: ${resolvedConcurrency}`);
  }

  console.log("  打包 Remotion 项目...");
  const bundleLocation = await bundleRemotionProject();
  const hardwareEncoder =
    codec === "h264" ? resolveAvailableH264HardwareEncoder() : null;
  const wantsNvenc = hardwareEncoder === "h264_nvenc";
  const remotionBinariesDirectory = wantsNvenc
    ? prepareRemotionBinariesWithSystemFfmpeg()
    : null;
  const useNvenc = wantsNvenc && Boolean(remotionBinariesDirectory);
  if (useNvenc) {
    console.log(`  overlay 编码: 使用 ${hardwareEncoder}`);
  } else if (codec === "h264") {
    console.log("  overlay 编码: 未检测到可用的 H.264 硬件编码器，回退到 libx264");
  }

  const outputDir = dirname(resolvedOutput);
  // progress_bar and navigation layers are now rendered by Python scripts
  // (render_progress_bar.py / render_navigation.py) using visual_plan.json.
  // Remotion only renders the main overlay layer.
  const layers: {
    name: string;
    output: string;
    props: Record<string, boolean>;
    transparent?: boolean;
  }[] = [
    {
      name: "overlay",
      output: resolvedOutput,
      props: { showContent: true, showNavigation: false, showProgressBar: false },
    },
  ];

  for (const layer of layers) {
    const inputProps = {
      blueprint,
      timingMap,
      durationInFrames: totalDurationFrames,
      ...layer.props,
    };

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      port: undefined,
      id: "AutoPipeline",
      inputProps,
      onBrowserLog: logBrowserMessage("select"),
    });

    const layerCodec = layer.transparent ? ("prores" as const) : codec;

    console.log(`  rendering ${layer.name} (${layerCodec})...`);
    await renderMedia({
      composition: {
        ...composition,
        durationInFrames: totalDurationFrames,
      },
      serveUrl: bundleLocation,
      port: undefined,
      codec: layerCodec,
      outputLocation: layer.output,
      inputProps,
      concurrency: resolvedConcurrency,
      ffmpegOverride: !layer.transparent && useNvenc
        ? ({ type, args }) => {
            if (type !== "pre-stitcher" && type !== "stitcher") {
              return args;
            }
            return applyNvencOverride(args);
          }
        : undefined,
      muted: true,
      ...(layer.transparent
        ? {
            imageFormat: "png" as const,
            pixelFormat: "yuva444p10le" as const,
            proResProfile: "4444" as const,
          }
        : layerCodec === "prores"
          ? {
              imageFormat: "png" as const,
              pixelFormat: "yuva444p10le" as const,
              proResProfile: "4444" as const,
            }
          : {}),
      binariesDirectory: remotionBinariesDirectory,
      dumpBrowserLogs: false,
      onBrowserLog: logBrowserMessage("render"),
      onProgress: undefined,
    });
    console.log(`  ${layer.name} done: ${layer.output}`);
  }

  const renderOutputsPath = resolve(dirname(resolvedOutput), "render_outputs.json");
  const artifacts: RenderArtifacts = {
    overlayLayerPath: resolvedOutput,
    resultPath: resolvedOutput,
    cutSourceVideoPath: media.cutSourceVideoPath,
    sourceVideoPath: media.sourceVideoPath,
    timingMode: timingMap.mode ?? "unknown",
    renderOutputsPath,
  };

  writeFileSync(renderOutputsPath, JSON.stringify(artifacts, null, 2), "utf-8");
  console.log(`  输出清单: ${renderOutputsPath}`);

  return artifacts;
}
