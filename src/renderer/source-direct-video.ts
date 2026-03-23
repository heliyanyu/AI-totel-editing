import { execFileSync } from "child_process";
import type { TimingMap } from "../schemas/blueprint.js";
import { resolveAvailableH264HardwareEncoder } from "./hardware-encoder.js";

/**
 * Probe the audio stream's start_time offset (in seconds) relative to the
 * video stream.  ASR tools decode the audio signal starting from the first
 * audio sample, so their timestamps are offset by this amount compared to the
 * container PTS that ffmpeg's trim/atrim filters use.
 */
function probeAudioStartOffset(videoPath: string): number {
  try {
    const raw = execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=start_time",
        "-of", "csv=p=0",
        videoPath,
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    const audioStart = parseFloat(raw);
    if (!Number.isFinite(audioStart) || audioStart <= 0) return 0;

    const rawV = execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=start_time",
        "-of", "csv=p=0",
        videoPath,
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    const videoStart = parseFloat(rawV) || 0;

    const offset = audioStart - videoStart;
    if (offset > 0.01) {
      console.log(
        `  [source-direct] 检测到音频流偏移: audio_start=${audioStart.toFixed(3)}s, video_start=${videoStart.toFixed(3)}s, offset=${offset.toFixed(3)}s`
      );
    }
    return offset > 0.01 ? offset : 0;
  } catch {
    return 0;
  }
}

function buildConcatFilter(timingMap: TimingMap, audioOffset: number): string {
  if (timingMap.mode !== "source_direct") {
    throw new Error("Only source_direct timing maps can be rendered as direct video.");
  }

  const trims = timingMap.clips.flatMap((clip, index) => {
    // ASR timestamps are relative to the audio signal start, which may lag
    // behind the container timeline by `audioOffset` seconds.  Shift both
    // video and audio trim ranges so they target the correct container PTS.
    const start = (clip.source.start + audioOffset).toFixed(3);
    const end = (clip.source.end + audioOffset).toFixed(3);
    return [
      `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`,
      `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`,
    ];
  });

  const concatInputs = timingMap.clips
    .map((_, index) => `[v${index}][a${index}]`)
    .join("");

  return `${trims.join(";")};${concatInputs}concat=n=${timingMap.clips.length}:v=1:a=1[outv][outa]`;
}

export function renderSourceDirectCutVideo(
  sourceVideoPath: string,
  timingMap: TimingMap,
  outputPath: string
): string {
  if (timingMap.mode !== "source_direct") {
    throw new Error("source_direct 视频拼接需要 source_direct timing_map");
  }

  if (timingMap.clips.length === 0) {
    throw new Error("source_direct timing_map 缺少 clips");
  }

  const audioOffset = probeAudioStartOffset(sourceVideoPath);
  const filterGraph = buildConcatFilter(timingMap, audioOffset);
  const hardwareEncoder = resolveAvailableH264HardwareEncoder();
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      sourceVideoPath,
      "-filter_complex",
      filterGraph,
      "-map",
      "[outv]",
      "-map",
      "[outa]",
      "-c:v",
      hardwareEncoder ?? "libx264",
      ...(hardwareEncoder === "h264_nvenc"
        ? ["-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", "19", "-b:v", "0"]
        : ["-preset", "veryfast", "-crf", "18"]),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    {
      stdio: "inherit",
    }
  );

  return outputPath;
}
