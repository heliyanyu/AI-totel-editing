/**
 * 横版渲染入口（仅剪裁拼接原始 16:9 视频 + 字幕）
 *
 * 不依赖 Remotion，不生成 overlay layer。
 * 直接调用 renderSourceDirectCutVideo 输出横版剪辑视频，
 * 并生成（或复用已有）SRT 字幕文件。
 *
 * 用法:
 *   npx tsx src/renderer/render-landscape.ts \
 *     --source-video doctor.mp4 \
 *     --timing-map timing_map.json \
 *     --blueprint blueprint.json \
 *     --output-dir ./out
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import type { Blueprint, TimingMap } from "../schemas/blueprint.js";
import { renderSourceDirectCutVideo } from "./source-direct-video.js";
import { buildSrt } from "./export-srt.js";

async function main() {
  const args = process.argv.slice(2);

  let sourceVideoPath = "";
  let timingMapPath = "";
  let blueprintPath = "";
  let outputDir = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--source-video":
        sourceVideoPath = args[++i];
        break;
      case "--timing-map":
      case "-t":
        timingMapPath = args[++i];
        break;
      case "--blueprint":
      case "-b":
        blueprintPath = args[++i];
        break;
      case "--output-dir":
      case "-o":
        outputDir = args[++i];
        break;
    }
  }

  if (!sourceVideoPath || !timingMapPath || !blueprintPath || !outputDir) {
    console.error(
      "Usage: npx tsx src/renderer/render-landscape.ts \\\n" +
      "  --source-video doctor.mp4 \\\n" +
      "  --timing-map timing_map.json \\\n" +
      "  --blueprint blueprint.json \\\n" +
      "  --output-dir ./out"
    );
    process.exit(1);
  }

  const resolvedSourceVideo = resolve(sourceVideoPath);
  const resolvedTimingMap = resolve(timingMapPath);
  const resolvedBlueprint = resolve(blueprintPath);
  const resolvedOutputDir = resolve(outputDir);

  if (!existsSync(resolvedSourceVideo)) {
    console.error(`[ERROR] 原始视频不存在: ${resolvedSourceVideo}`);
    process.exit(1);
  }
  if (!existsSync(resolvedTimingMap)) {
    console.error(`[ERROR] timing_map 不存在: ${resolvedTimingMap}`);
    process.exit(1);
  }
  if (!existsSync(resolvedBlueprint)) {
    console.error(`[ERROR] blueprint 不存在: ${resolvedBlueprint}`);
    process.exit(1);
  }

  mkdirSync(resolvedOutputDir, { recursive: true });

  const timingMap: TimingMap = JSON.parse(
    readFileSync(resolvedTimingMap, "utf-8")
  );

  if (timingMap.mode !== "source_direct") {
    console.error(
      `[ERROR] 横版渲染仅支持 source_direct timing_map，当前 mode="${timingMap.mode}"`
    );
    process.exit(1);
  }

  // 1. 剪裁拼接横版视频
  const cutVideoPath = join(resolvedOutputDir, "landscape_cut_video.mp4");
  console.log(`\n[1/2] 渲染横版剪辑视频...`);
  console.log(`  原始视频: ${resolvedSourceVideo}`);
  console.log(`  输出: ${cutVideoPath}`);
  renderSourceDirectCutVideo(resolvedSourceVideo, timingMap, cutVideoPath);
  console.log(`  完成: ${cutVideoPath}`);

  // 2. 字幕：复用已有 SRT，否则重新生成
  const srtPath = join(resolvedOutputDir, "subtitles.srt");
  console.log(`\n[2/2] 字幕文件...`);
  if (existsSync(srtPath)) {
    console.log(`  已存在，复用: ${srtPath}`);
  } else {
    const blueprint: Blueprint = JSON.parse(
      readFileSync(resolvedBlueprint, "utf-8")
    );
    const srt = buildSrt(blueprint, timingMap);
    writeFileSync(srtPath, srt, "utf-8");
    console.log(`  生成: ${srtPath}`);
  }

  console.log(`\n[完成]`);
  console.log(`  横版视频: ${cutVideoPath}`);
  console.log(`  字幕文件: ${srtPath}`);
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
