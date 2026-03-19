import { execFileSync } from "child_process";
import type { TimingMap } from "../schemas/blueprint.js";

function buildConcatFilter(timingMap: TimingMap): string {
  if (timingMap.mode !== "source_direct") {
    throw new Error("Only source_direct timing maps can be rendered as direct audio.");
  }

  const trims = timingMap.clips.map((clip, index) => {
    const start = clip.source.start.toFixed(3);
    const end = clip.source.end.toFixed(3);
    return `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`;
  });

  if (timingMap.clips.length === 1) {
    return `${trims[0]};[a0]anull[outa]`;
  }

  const concatInputs = timingMap.clips.map((_, index) => `[a${index}]`).join("");
  return `${trims.join(";")};${concatInputs}concat=n=${timingMap.clips.length}:v=0:a=1[outa]`;
}

export function renderSourceDirectAudioTrack(
  sourceVideoPath: string,
  timingMap: TimingMap,
  outputPath: string
): string {
  if (timingMap.mode !== "source_direct") {
    throw new Error("source_direct 音轨渲染需要 source_direct timing_map");
  }

  if (timingMap.clips.length === 0) {
    throw new Error("source_direct timing_map 缺少 clips");
  }

  const filterGraph = buildConcatFilter(timingMap);
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
      "[outa]",
      "-c:a",
      "pcm_s16le",
      "-ar",
      "48000",
      outputPath,
    ],
    {
      stdio: "inherit",
    }
  );

  return outputPath;
}
