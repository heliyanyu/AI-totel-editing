import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type {
  AlignedTokenTranscript,
  Transcript,
} from "../schemas/blueprint.js";

export type QwenForcedAlignDType = "bfloat16" | "float16" | "float32";

export interface QwenForcedAlignChunkSummary {
  index: number;
  startWordIndex: number;
  endWordIndex: number;
  wordCount: number;
  alignableTokenCount: number;
  audioStart: number;
  audioEnd: number;
  contentStart: number;
  contentEnd: number;
  preview: string;
}

export interface QwenForcedAlignManifest {
  version: number;
  tool: string;
  model: string;
  language: string;
  deviceMap: string;
  dtype: QwenForcedAlignDType;
  audioPath: string;
  transcriptPath: string;
  outputs: {
    alignedWordTranscriptPath: string;
    alignedTokenTranscriptPath: string;
    manifestPath: string;
  };
  summary: {
    rawWordCount: number;
    alignedWordCount: number;
    alignedTokenCount: number;
    fallbackWordCount: number;
    chunkCount: number;
    batchSize: number;
    maxChunkSeconds: number;
    minChunkSeconds: number;
    gapThresholdSeconds: number;
    paddingSeconds: number;
  };
  chunks: QwenForcedAlignChunkSummary[];
}

export interface RunQwenForcedAlignOptions {
  audioPath: string;
  transcriptPath: string;
  outputDir: string;
  pythonExecutable?: string;
  model?: string;
  language?: string;
  deviceMap?: string;
  dtype?: QwenForcedAlignDType;
  maxChunkSeconds?: number;
  minChunkSeconds?: number;
  gapThresholdSeconds?: number;
  paddingSeconds?: number;
  batchSize?: number;
}

export interface RunQwenForcedAlignResult {
  manifestPath: string;
  alignedWordTranscriptPath: string;
  alignedTokenTranscriptPath: string;
  manifest: QwenForcedAlignManifest;
  alignedWordTranscript: Transcript;
  alignedTokenTranscript: AlignedTokenTranscript;
}

interface QwenForcedAlignStdout {
  manifestPath: string;
  alignedWordTranscriptPath: string;
  alignedTokenTranscriptPath: string;
}

function buildPythonScriptPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "../../scripts/force-align-qwen.py");
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function appendOptionalArg(
  args: string[],
  name: string,
  value: string | number | undefined
): void {
  if (value === undefined || value === "") {
    return;
  }
  args.push(name, String(value));
}

function resolvePythonExecutable(
  explicitPython?: string,
  envPython?: string,
  fallbackPython?: string
): string {
  const candidates = [
    explicitPython,
    envPython,
    fallbackPython,
    process.platform === "win32"
      ? "D:\\Anaconda_envs\\qwen-asr\\python.exe"
      : undefined,
    "python",
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (candidate.toLowerCase().endsWith(".exe") && !existsSync(candidate)) {
      continue;
    }

    return candidate;
  }

  return "python";
}

export function runQwenForcedAlign(
  options: RunQwenForcedAlignOptions
): RunQwenForcedAlignResult {
  const pythonExecutable = resolvePythonExecutable(
    options.pythonExecutable,
    process.env.QWEN_FORCE_ALIGN_PYTHON,
    process.env.PYTHON_PATH
  );
  const scriptPath = buildPythonScriptPath();
  const transcriptPath = resolve(options.transcriptPath);
  const audioPath = resolve(options.audioPath);
  const outputDir = resolve(options.outputDir);

  const args = [
    scriptPath,
    "--audio",
    audioPath,
    "--transcript",
    transcriptPath,
    "--output-dir",
    outputDir,
  ];

  appendOptionalArg(args, "--model", options.model);
  appendOptionalArg(args, "--language", options.language);
  appendOptionalArg(args, "--device-map", options.deviceMap);
  appendOptionalArg(args, "--dtype", options.dtype);
  appendOptionalArg(args, "--max-chunk-seconds", options.maxChunkSeconds);
  appendOptionalArg(args, "--min-chunk-seconds", options.minChunkSeconds);
  appendOptionalArg(args, "--gap-threshold-seconds", options.gapThresholdSeconds);
  appendOptionalArg(args, "--padding-seconds", options.paddingSeconds);
  appendOptionalArg(args, "--batch-size", options.batchSize);

  let stdout = "";
  try {
    stdout = execFileSync(pythonExecutable, args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Qwen3-ForcedAligner invocation failed. Please verify qwen-asr, ffmpeg, and the target Python environment.\n${message}`
    );
  }

  const parsed = JSON.parse(stdout.trim()) as QwenForcedAlignStdout;
  const manifestPath = resolve(parsed.manifestPath);
  const alignedWordTranscriptPath = resolve(parsed.alignedWordTranscriptPath);
  const alignedTokenTranscriptPath = resolve(parsed.alignedTokenTranscriptPath);

  for (const filePath of [
    manifestPath,
    alignedWordTranscriptPath,
    alignedTokenTranscriptPath,
  ]) {
    if (!existsSync(filePath)) {
      throw new Error(`Qwen3-ForcedAligner output missing: ${filePath}`);
    }
  }

  return {
    manifestPath,
    alignedWordTranscriptPath,
    alignedTokenTranscriptPath,
    manifest: readJsonFile<QwenForcedAlignManifest>(manifestPath),
    alignedWordTranscript: readJsonFile<Transcript>(alignedWordTranscriptPath),
    alignedTokenTranscript: readJsonFile<AlignedTokenTranscript>(alignedTokenTranscriptPath),
  };
}
