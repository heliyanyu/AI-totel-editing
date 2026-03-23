import { execFileSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";

const require = createRequire(import.meta.url);

function resolveSystemExecutable(name: "ffmpeg" | "ffprobe"): string | null {
  try {
    const output = execFileSync("where.exe", [name], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const first = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return first ? resolve(first) : null;
  } catch {
    return null;
  }
}

function resolveRemotionExecutableDir(): string | null {
  try {
    if (process.platform === "win32" && process.arch === "x64") {
      const pkg = require("@remotion/compositor-win32-x64-msvc") as {
        dir?: string;
      };
      return pkg.dir ? resolve(pkg.dir) : null;
    }
  } catch {
    return null;
  }

  return null;
}

function syncFile(sourcePath: string, destPath: string): void {
  const sourceStats = statSync(sourcePath);
  const destExists = existsSync(destPath);
  if (destExists) {
    const destStats = statSync(destPath);
    if (
      destStats.size === sourceStats.size &&
      destStats.mtimeMs >= sourceStats.mtimeMs
    ) {
      return;
    }
  }

  copyFileSync(sourcePath, destPath);
}

export function prepareRemotionBinariesWithSystemFfmpeg(): string | null {
  const remotionDir = resolveRemotionExecutableDir();
  const ffmpegPath = resolveSystemExecutable("ffmpeg");
  const ffprobePath = resolveSystemExecutable("ffprobe");

  if (!remotionDir || !ffmpegPath || !ffprobePath) {
    return null;
  }

  const targetDir = join(tmpdir(), "editing-v1-remotion-system-ffmpeg");
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(remotionDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const sourcePath = join(remotionDir, entry.name);
    const destPath = join(targetDir, entry.name);
    syncFile(sourcePath, destPath);
  }

  syncFile(ffmpegPath, join(targetDir, basename(ffmpegPath)));
  syncFile(ffprobePath, join(targetDir, basename(ffprobePath)));

  return targetDir;
}

