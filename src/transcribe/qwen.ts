import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { Transcript } from "../schemas/blueprint.js";

export type QwenTranscribeDType = "bfloat16" | "float16" | "float32";

export interface QwenTranscribeManifest {
  version: number;
  tool: string;
  model: string;
  alignerModel: string | null;
  audioPath: string;
  outputTranscriptPath: string;
  outputTextPath: string;
  languageRequested: string;
  languageDetected: string;
  context: string;
  deviceMap: string;
  dtype: QwenTranscribeDType;
  summary: {
    duration: number;
    wordCount: number;
    textLength: number;
    maxInferenceBatchSize: number;
    maxNewTokens: number;
  };
}

export interface RunQwenTranscribeOptions {
  audioPath: string;
  outputDir: string;
  pythonExecutable?: string;
  model?: string;
  alignerModel?: string;
  language?: string;
  deviceMap?: string;
  dtype?: QwenTranscribeDType;
  maxInferenceBatchSize?: number;
  maxNewTokens?: number;
  context?: string;
}

export interface RunQwenTranscribeResult {
  rawTranscriptPath: string;
  rawTranscriptTextPath: string;
  manifestPath: string;
  transcript: Transcript;
  manifest: QwenTranscribeManifest;
}

interface QwenTranscribeStdout {
  transcriptPath: string;
  transcriptTextPath: string;
  manifestPath: string;
}

function buildPythonScriptPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "../../scripts/transcribe-qwen.py");
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

export function runQwenTranscribe(
  options: RunQwenTranscribeOptions
): RunQwenTranscribeResult {
  const pythonExecutable = resolvePythonExecutable(
    options.pythonExecutable,
    process.env.QWEN_TRANSCRIBE_PYTHON,
    process.env.PYTHON_PATH
  );
  const scriptPath = buildPythonScriptPath();
  const audioPath = resolve(options.audioPath);
  const outputDir = resolve(options.outputDir);

  const args = [
    scriptPath,
    "--audio",
    audioPath,
    "--output-dir",
    outputDir,
  ];

  appendOptionalArg(args, "--model", options.model);
  appendOptionalArg(args, "--aligner-model", options.alignerModel);
  appendOptionalArg(args, "--language", options.language);
  appendOptionalArg(args, "--device-map", options.deviceMap);
  appendOptionalArg(args, "--dtype", options.dtype);
  appendOptionalArg(
    args,
    "--max-inference-batch-size",
    options.maxInferenceBatchSize
  );
  appendOptionalArg(args, "--max-new-tokens", options.maxNewTokens);
  appendOptionalArg(args, "--context", options.context);

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
      `Qwen3-ASR invocation failed. Please verify qwen-asr and the target Python environment.\n${message}`
    );
  }

  const parsed = JSON.parse(stdout.trim()) as QwenTranscribeStdout;
  const transcriptPath = resolve(parsed.transcriptPath);
  const transcriptTextPath = resolve(parsed.transcriptTextPath);
  const manifestPath = resolve(parsed.manifestPath);

  for (const filePath of [transcriptPath, transcriptTextPath, manifestPath]) {
    if (!existsSync(filePath)) {
      throw new Error(`Qwen3-ASR output missing: ${filePath}`);
    }
  }

  return {
    rawTranscriptPath: transcriptPath,
    rawTranscriptTextPath: transcriptTextPath,
    manifestPath,
    transcript: readJsonFile<Transcript>(transcriptPath),
    manifest: readJsonFile<QwenTranscribeManifest>(manifestPath),
  };
}
