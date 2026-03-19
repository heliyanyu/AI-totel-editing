/**
 * 程序化 Remotion 渲染
 *
 * 读取 blueprint + timing_map，调用 Remotion 渲染输出实体 MP4 视频
 * （信息图形 + 字幕 + 音频）。医生真人画面由剪辑师在剪映中叠加。
 */

import { renderMedia, selectComposition } from "@remotion/renderer";
import { readFileSync } from "fs";
import { resolve, basename, dirname } from "path";
import { VIDEO_FPS } from "../remotion/utils.js";
import type { Blueprint, TimingMap } from "../schemas/blueprint.js";
import { allAtoms } from "../schemas/blueprint.js";
import {
  validateTimingPlan,
  hasBlockingTimingIssues,
  formatTimingValidationFailures,
} from "../timing/validate-timing-map.js";
import { bundleRemotionProject } from "./bundle.js";
import { resolveRenderConcurrency } from "./render-concurrency.js";
import { renderSourceDirectAudioTrack } from "./source-direct-audio.js";

export interface RenderOptions {
  blueprintPath: string;
  timingMapPath: string;
  cutVideoPath?: string;
  sourceVideoPath?: string;
  outputPath: string;
  codec?: "h264" | "h265" | "vp8" | "vp9";
  concurrency?: number;
}

function resolveMediaPath(
  timingMap: TimingMap,
  options: RenderOptions
): { publicDir: string; audioSrc?: string; sourceVideoSrc?: string } {
  if (timingMap.mode === "source_direct") {
    if (!options.sourceVideoPath) {
      throw new Error("timing_map.mode=source_direct 时必须提供 sourceVideoPath");
    }
    const audioTrackPath = resolve(
      dirname(options.outputPath),
      "source_direct_audio.wav"
    );
    renderSourceDirectAudioTrack(
      resolve(options.sourceVideoPath),
      timingMap,
      audioTrackPath
    );
    return {
      publicDir: dirname(audioTrackPath),
      audioSrc: basename(audioTrackPath),
    };
  }

  if (!options.cutVideoPath) {
    throw new Error("timing_map.mode=cut_video 时必须提供 cutVideoPath");
  }
  const mediaPath = resolve(options.cutVideoPath);
  return {
    publicDir: dirname(mediaPath),
    audioSrc: basename(mediaPath),
  };
}

export async function renderFinalVideo(options: RenderOptions): Promise<string> {
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
  const media = resolveMediaPath(timingMap, options);

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
  const bundleLocation = await bundleRemotionProject({
    publicDir: media.publicDir,
  });

  const inputProps = {
    audioSrc: media.audioSrc ?? "",
    sourceVideoSrc: media.sourceVideoSrc ?? "",
    blueprint,
    timingMap,
    durationInFrames: totalDurationFrames,
  };

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "AutoPipeline",
    inputProps,
  });

  console.log(`  开始渲染 (codec: ${codec})...`);
  const resolvedOutput = resolve(outputPath);

  await renderMedia({
    composition: {
      ...composition,
      durationInFrames: totalDurationFrames,
    },
    serveUrl: bundleLocation,
    codec,
    outputLocation: resolvedOutput,
    inputProps,
    concurrency: resolvedConcurrency,
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 10 === 0) {
        process.stdout.write(`\r  渲染进度: ${Math.round(progress * 100)}%`);
      }
    },
  });

  console.log(`\n  渲染完成: ${resolvedOutput}`);
  return resolvedOutput;
}
