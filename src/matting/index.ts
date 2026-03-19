/**
 * 抠像模块 - Phase 3.5
 *
 * 使用 rembg 对切割后的视频进行背景移除，输出带 alpha 通道的视频
 *
 * 流程：
 * 1. FFmpeg 提取所有帧 → _frames_in/
 * 2. rembg p 批量处理 → _frames_out/
 * 3. FFmpeg 重组带 alpha 的视频 → cut_video_alpha.webm
 *
 * 依赖: pip install rembg onnxruntime (或 onnxruntime-gpu)
 */

import { execFileSync } from "child_process";
import { resolve, join, dirname } from "path";
import { existsSync, mkdirSync, rmSync, readdirSync } from "fs";
import { fileURLToPath } from "url";

const __filename_m = fileURLToPath(import.meta.url);
const __dirname_m = dirname(__filename_m);

/** conda 环境 Python（GPU 加速） */
const PYTHON_BIN = process.env.PYTHON_BIN || "F:\\miniconda3\\envs\\asr\\python.exe";

export interface MattingOptions {
  /** rembg 模型 (默认: u2net) */
  model?: string;
  /** 提取帧的 fps（默认: 跟随源视频） */
  fps?: number;
}

/**
 * 对视频进行背景移除
 */
export async function removeBackground(
  inputPath: string,
  outputDir: string,
  options?: MattingOptions
): Promise<string> {
  inputPath = resolve(inputPath);
  outputDir = resolve(outputDir);

  const model = options?.model ?? "u2net";
  const outputPath = join(outputDir, "cut_video_alpha.webm");

  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  // ── Step 1: 用 FFmpeg 提取帧 ──
  const framesIn = join(outputDir, "_frames_in");
  const framesOut = join(outputDir, "_frames_out");

  mkdirSync(framesIn, { recursive: true });
  mkdirSync(framesOut, { recursive: true });

  // 先获取源视频 fps
  const probeResult = execFileSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=r_frame_rate",
    "-of", "csv=p=0",
    inputPath,
  ], { encoding: "utf-8" }).trim();

  // r_frame_rate 返回格式如 "25/1"
  const [num, den] = probeResult.split("/").map(Number);
  const sourceFps = den ? num / den : 25;
  // 默认 10fps（demo 模式，减少处理量 3x）；可用 --fps 覆盖为源 fps
  const fps = options?.fps ?? 10;
  console.log(`  Source FPS: ${sourceFps}, Processing FPS: ${fps}`);

  // 如果已经有提取的帧，跳过提取步骤
  const existingFrames = readdirSync(framesIn).filter(f => f.endsWith(".png")).length;
  if (existingFrames > 0) {
    console.log(`  Step 1/3: Skipping extraction, found ${existingFrames} existing frames`);
  } else {
    console.log(`  Step 1/3: Extracting frames...`);
    execFileSync("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-vf", `fps=${fps}`,
      "-qmin", "1", "-q:v", "1",
      join(framesIn, "%05d.png"),
    ], { stdio: "pipe" });
  }

  const frameCount = readdirSync(framesIn).filter(f => f.endsWith(".png")).length;
  console.log(`  Total frames: ${frameCount}`);

  // ── Step 2: rembg 批量去背景（使用 Python 脚本，避免 CLI 兼容问题） ──
  console.log(`  Step 2/3: Running rembg (model: ${model})... This may take a while.`);
  const batchScript = join(__dirname_m, "batch_rembg.py");
  try {
    execFileSync(PYTHON_BIN, [
      batchScript,
      framesIn,
      framesOut,
      model,
    ], {
      stdio: "inherit",
      timeout: 7200_000, // 2 hour timeout for large videos
    });
  } catch (err) {
    throw new Error(
      `rembg failed. Ensure it's installed: pip install rembg onnxruntime\n` +
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const outCount = readdirSync(framesOut).filter(f => f.endsWith(".png")).length;
  console.log(`  Processed ${outCount} frames`);

  if (outCount === 0) {
    throw new Error("rembg produced no output frames");
  }

  // ── Step 3: 重组为带 alpha 的 webm ──
  console.log(`  Step 3/3: Reassembling video with alpha...`);
  // 设置 TEMP/TMP 到 F 盘，避免 FFmpeg 临时文件撑满 C 盘
  const tempDir = join(outputDir, "_ffmpeg_tmp");
  mkdirSync(tempDir, { recursive: true });
  const ffmpegEnv = { ...process.env, TEMP: tempDir, TMP: tempDir };

  execFileSync("ffmpeg", [
    "-y",
    "-framerate", String(fps),
    "-i", join(framesOut, "%05d.png"),
    "-c:v", "libvpx-vp9",
    "-pix_fmt", "yuva420p",
    "-b:v", "2M",
    "-auto-alt-ref", "0",
    outputPath,
  ], { stdio: "pipe", env: ffmpegEnv, timeout: 600_000 });

  if (!existsSync(outputPath)) {
    throw new Error(`Output video not created: ${outputPath}`);
  }

  // ── 清理临时目录 ──
  console.log(`  Cleaning up temp frames...`);
  try {
    rmSync(framesIn, { recursive: true, force: true });
    rmSync(framesOut, { recursive: true, force: true });
    rmSync(tempDir, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }

  console.log(`  Matting done: ${outputPath}`);
  return outputPath;
}

// ── CLI ──────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  let inputPath = "";
  let outputDir = "";
  let model = "u2net";
  let fps: number | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--input":
      case "-i":
        inputPath = args[++i];
        break;
      case "--output":
      case "-o":
        outputDir = args[++i];
        break;
      case "--model":
      case "-m":
        model = args[++i];
        break;
      case "--fps":
        fps = Number(args[++i]);
        break;
    }
  }

  if (!inputPath) {
    console.error("Usage: npx tsx src/matting/index.ts -i cut_video.mp4 [-o output_dir] [-m u2net] [--fps 10]");
    process.exit(1);
  }

  if (!outputDir) {
    const { dirname: getDirname } = await import("path");
    outputDir = getDirname(resolve(inputPath));
  }

  console.log("Background removal...");
  const result = await removeBackground(inputPath, outputDir, { model, fps });
  console.log(`Done: ${result}`);
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("matting/index.ts") ||
    process.argv[1].endsWith("matting\\index.ts"));
if (isMainModule) {
  main().catch((err) => {
    console.error("Error:", err.message ?? err);
    process.exit(1);
  });
}
