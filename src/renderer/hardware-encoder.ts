import { execFileSync } from "child_process";

export type H264HardwareEncoder = "h264_nvenc";

let cachedEncoder: H264HardwareEncoder | null | undefined;

function canEncodeWith(encoder: H264HardwareEncoder): boolean {
  try {
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1280x720:d=0.2",
        "-frames:v",
        "1",
        "-an",
        "-c:v",
        encoder,
        "-f",
        "null",
        "-",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    return true;
  } catch {
    return false;
  }
}

export function resolveAvailableH264HardwareEncoder(): H264HardwareEncoder | null {
  if (cachedEncoder !== undefined) {
    return cachedEncoder;
  }

  const candidates: H264HardwareEncoder[] = ["h264_nvenc"];
  for (const candidate of candidates) {
    if (canEncodeWith(candidate)) {
      cachedEncoder = candidate;
      return candidate;
    }
  }

  cachedEncoder = null;
  return null;
}
