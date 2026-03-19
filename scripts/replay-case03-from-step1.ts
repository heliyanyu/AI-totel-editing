import { execFileSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import {
  SYSTEM_PROMPT_STEP2,
  buildUserPromptStep2,
  mergeStep2WithAtoms,
} from "../src/analyze/semantic/index.js";
import {
  SYSTEM_PROMPT_TAKE_PASS,
  buildUserPromptTakePass,
  normalizeTakePassResult,
  applyTakePass,
} from "../src/analyze/audio/index.js";
import {
  transcriptToPlainText,
} from "../src/analyze/review/index.js";
import {
  extractJson,
  autoRepairBlueprint,
  validateBlueprint,
} from "../src/analyze/schema.js";
import { buildStep2Diagnostics } from "../src/analyze/step2-diagnostics.js";
import { postProcessBlueprint } from "../src/align/post-process.js";
import { buildDirectTimingMap } from "../src/timing/build-direct-timing-map.js";
import { renderFinalVideo } from "../src/renderer/render.js";
import { DEFAULT_ANTHROPIC_MODEL } from "../src/config/models.js";
import type {
  Blueprint,
  Transcript,
  Word,
} from "../src/schemas/blueprint.js";

const DEFAULT_MODEL = "gemini-3.1-pro-preview";
const DEFAULT_TAKE_PASS_MODEL = DEFAULT_ANTHROPIC_MODEL;
const DEFAULT_SOURCE_DIR =
  "output/case03_gemini31_native_20260318_takepass_tuned_v2";
const DEFAULT_OUTPUT_PREFIX = "case03_gemini31_native_repairchain";
const MAX_RETRIES = 2;
const THINKING_BUDGET = 512;

type Args = {
  model: string;
  takePassModel: string;
  sourceDir: string;
  outputDir: string;
  videoPath: string;
  skipRender: boolean;
  resumeAt: "take-pass" | "step2";
};

type GeminiCallOptions = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  maxRetries: number;
  debugDir: string;
  debugPrefix: string;
};

type AnthropicCallOptions = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  maxRetries: number;
  debugDir: string;
  debugPrefix: string;
};

type Step1AtomLike = {
  id: number;
  text: string;
  time: { s: number; e: number };
  status?: "keep" | "discard";
  boundary?: "scene" | "logic";
  reason?: string;
  audio_span_id?: string;
};

type Step1Result = {
  atoms: Step1AtomLike[];
  audio_spans?: unknown[];
};

function timestamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(
    now.getMinutes()
  ).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let sourceDir = resolve(DEFAULT_SOURCE_DIR);
  let model = DEFAULT_MODEL;
  let takePassModel = DEFAULT_TAKE_PASS_MODEL;
  let outputDir = resolve("output", `${DEFAULT_OUTPUT_PREFIX}_${timestamp()}`);
  let videoPath = "";
  let skipRender = false;
  let resumeAt: "take-pass" | "step2" = "take-pass";

  for (let index = 0; index < args.length; index++) {
    switch (args[index]) {
      case "--model":
        model = args[++index] ?? model;
        break;
      case "--source-dir":
        sourceDir = resolve(args[++index] ?? sourceDir);
        break;
      case "--take-pass-model":
        takePassModel = args[++index] ?? takePassModel;
        break;
      case "--output-dir":
        outputDir = resolve(args[++index] ?? outputDir);
        break;
      case "--video":
        videoPath = resolve(args[++index] ?? "");
        break;
      case "--skip-render":
        skipRender = true;
        break;
      case "--resume-at":
        if (args[index + 1] === "step2") {
          resumeAt = "step2";
        } else {
          resumeAt = "take-pass";
        }
        index += 1;
        break;
    }
  }

  return {
    model,
    takePassModel,
    sourceDir,
    outputDir,
    videoPath,
    skipRender,
    resumeAt,
  };
}

function getGeminiApiKey(): string {
  const envKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (envKey) {
    return envKey;
  }

  try {
    const value = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "(Get-ItemProperty -Path 'HKCU:\\Environment').GEMINI_API_KEY",
      ],
      { encoding: "utf8" }
    ).trim();

    if (value) {
      return value;
    }
  } catch {
    // Ignore and fall through.
  }

  throw new Error("Missing GEMINI_API_KEY / GOOGLE_API_KEY.");
}

function getAnthropicApiKey(): string {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return envKey;
  }

  try {
    const value = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "(Get-ItemProperty -Path 'HKCU:\\Environment').ANTHROPIC_API_KEY",
      ],
      { encoding: "utf8" }
    ).trim();

    if (value) {
      return value;
    }
  } catch {
    // Ignore and fall through.
  }

  throw new Error("Missing ANTHROPIC_API_KEY.");
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function cloneJson<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function ensurePathExists(filePath: string, label: string) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function extractGeminiText(responseJson: any): string {
  return (
    responseJson?.candidates?.[0]?.content?.parts
      ?.map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("") ?? ""
  );
}

async function callGeminiJson<T>(options: GeminiCallOptions): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`  Retry ${attempt}/${options.maxRetries} ...`);
    }

    try {
      console.log(`  Calling ${options.model} [${options.debugPrefix}] ...`);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${options.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              role: "system",
              parts: [{ text: options.systemPrompt }],
            },
            contents: [
              {
                role: "user",
                parts: [{ text: options.userPrompt }],
              },
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: options.maxOutputTokens,
              responseMimeType: "application/json",
              thinkingConfig: {
                thinkingBudget: THINKING_BUDGET,
              },
            },
          }),
        }
      );

      const responseText = await response.text();
      writeFileSync(
        join(
          options.debugDir,
          `llm-${options.debugPrefix}-response-${attempt}.json`
        ),
        responseText,
        "utf-8"
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${responseText}`);
      }

      const responseJson = JSON.parse(responseText);
      const usage = responseJson?.usageMetadata;
      const finishReason =
        responseJson?.candidates?.[0]?.finishReason ?? "UNKNOWN";

      console.log(
        `  Tokens: input=${usage?.promptTokenCount ?? 0}, thought=${usage?.thoughtsTokenCount ?? 0}, output=${usage?.candidatesTokenCount ?? 0}, finish=${finishReason}`
      );

      const rawText = extractGeminiText(responseJson);
      if (!rawText) {
        throw new Error("Gemini response did not include text content");
      }

      writeFileSync(
        join(options.debugDir, `llm-${options.debugPrefix}-raw-${attempt}.txt`),
        rawText,
        "utf-8"
      );

      let rawJson: T;
      try {
        rawJson = JSON.parse(rawText) as T;
      } catch {
        rawJson = extractJson(rawText) as T;
      }

      writeFileSync(
        join(
          options.debugDir,
          `llm-${options.debugPrefix}-parsed-${attempt}.json`
        ),
        JSON.stringify(rawJson, null, 2),
        "utf-8"
      );

      return rawJson;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`  Attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  throw new Error(
    `Gemini [${options.debugPrefix}] failed: ${lastError?.message ?? "unknown error"}`
  );
}

async function callAnthropicJson<T>(
  options: AnthropicCallOptions
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`  Retry ${attempt}/${options.maxRetries} ...`);
    }

    try {
      console.log(`  Calling ${options.model} [${options.debugPrefix}] ...`);

      const client = new Anthropic({ apiKey: options.apiKey });
      let rawText = "";

      const stream = client.messages
        .stream({
          model: options.model,
          max_tokens: options.maxTokens,
          system: options.systemPrompt,
          messages: [{ role: "user", content: options.userPrompt }],
        })
        .on("text", (text) => {
          rawText += text;
        });

      const response = await stream.finalMessage();

      console.log(
        `  Tokens: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`
      );

      rawText ||= response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      if (!rawText) {
        throw new Error("Anthropic response did not include text content");
      }

      writeFileSync(
        join(options.debugDir, `llm-${options.debugPrefix}-raw-${attempt}.txt`),
        rawText,
        "utf-8"
      );

      const rawJson = extractJson(rawText) as T;
      writeFileSync(
        join(
          options.debugDir,
          `llm-${options.debugPrefix}-parsed-${attempt}.json`
        ),
        JSON.stringify(rawJson, null, 2),
        "utf-8"
      );

      return rawJson;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`  Attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  throw new Error(
    `Anthropic [${options.debugPrefix}] failed: ${lastError?.message ?? "unknown error"}`
  );
}

function resolveVideoPath(args: Args): string {
  if (args.videoPath) {
    return args.videoPath;
  }

  const manifestPath = join(args.sourceDir, "gemini_run_manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = readJsonFile<{ videoPath?: string }>(manifestPath);
    if (manifest.videoPath) {
      return resolve(manifest.videoPath);
    }
  }

  throw new Error(
    "Missing video path. Pass --video or ensure source dir has gemini_run_manifest.json"
  );
}

function copyIfExists(inputPath: string, outputPath: string) {
  if (existsSync(inputPath)) {
    mkdirSync(dirname(outputPath), { recursive: true });
    copyFileSync(inputPath, outputPath);
  }
}

async function run() {
  const args = parseArgs();
  const usesAnthropicForStep2 = args.model.startsWith("claude-");
  const apiKey = usesAnthropicForStep2 ? "" : getGeminiApiKey();
  const anthropicApiKey =
    args.resumeAt === "take-pass" || usesAnthropicForStep2
      ? getAnthropicApiKey()
      : "";
  const videoPath = resolveVideoPath(args);

  ensurePathExists(args.sourceDir, "sourceDir");
  ensurePathExists(videoPath, "video");

  const transcriptPath = join(args.sourceDir, "transcript.json");
  const reviewedTranscriptPath = join(args.sourceDir, "reviewed_transcript.json");
  const step1ResultPath = join(args.sourceDir, "step1_result.json");

  ensurePathExists(transcriptPath, "transcript");
  ensurePathExists(reviewedTranscriptPath, "reviewed_transcript");
  ensurePathExists(step1ResultPath, "step1_result");

  mkdirSync(args.outputDir, { recursive: true });

  const transcript = readJsonFile<Transcript>(transcriptPath);
  const reviewedTranscript = readJsonFile<Transcript>(reviewedTranscriptPath);
  const step1Result = readJsonFile<Step1Result>(step1ResultPath);

  const step1Cleaned = cloneJson(step1Result);
  for (const atom of step1Cleaned.atoms ?? []) {
    atom.status = "keep";
    delete atom.reason;
    delete atom.audio_span_id;
  }

  writeFileSync(
    join(args.outputDir, "replay_manifest.json"),
    JSON.stringify(
      {
        model: args.model,
        takePassModel: args.takePassModel,
        sourceDir: args.sourceDir,
        outputDir: args.outputDir,
        videoPath,
        resumeAt: args.resumeAt,
        resumedFrom: "step1",
        createdAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );

  writeFileSync(
    join(args.outputDir, "transcript.json"),
    JSON.stringify(transcript, null, 2),
    "utf-8"
  );
  writeFileSync(
    join(args.outputDir, "reviewed_transcript.json"),
    JSON.stringify(reviewedTranscript, null, 2),
    "utf-8"
  );
  writeFileSync(
    join(args.outputDir, "reviewed_transcript_map.json"),
    JSON.stringify(reviewedTranscript, null, 2),
    "utf-8"
  );
  writeFileSync(
    join(args.outputDir, "reviewed_transcript.txt"),
    transcriptToPlainText(reviewedTranscript.words),
    "utf-8"
  );
  writeFileSync(
    join(args.outputDir, "step1_result.json"),
    JSON.stringify(step1Result, null, 2),
    "utf-8"
  );
  writeFileSync(
    join(args.outputDir, "step1_cleaned.json"),
    JSON.stringify(step1Cleaned, null, 2),
    "utf-8"
  );

  copyIfExists(
    join(args.sourceDir, "review_spans.json"),
    join(args.outputDir, "review_spans.json")
  );
  copyIfExists(
    join(args.sourceDir, "transcript_review.json"),
    join(args.outputDir, "transcript_review.json")
  );
  copyIfExists(
    join(args.sourceDir, "script_plain.txt"),
    join(args.outputDir, "script_plain.txt")
  );
  copyIfExists(
    join(args.sourceDir, "step1_hints.json"),
    join(args.outputDir, "step1_hints.json")
  );

  console.log(`Source: ${args.sourceDir}`);
  console.log(`Output: ${args.outputDir}`);
  console.log(`Model:  ${args.model}`);
  console.log(`Take-pass model: ${args.takePassModel}`);
  let step1Taken: Step1Result;

  if (args.resumeAt === "step2") {
    const takePassPath = join(args.outputDir, "take_pass_result.json");
    const step1TakenPath = join(args.outputDir, "step1_taken.json");
    ensurePathExists(takePassPath, "take_pass_result");
    ensurePathExists(step1TakenPath, "step1_taken");
    step1Taken = readJsonFile<Step1Result>(step1TakenPath);
  } else {
    const takePassRaw = await callAnthropicJson<any>({
      apiKey: anthropicApiKey,
      model: args.takePassModel,
      systemPrompt: SYSTEM_PROMPT_TAKE_PASS,
      userPrompt: buildUserPromptTakePass(
        step1Cleaned.atoms,
        reviewedTranscript.words
      ),
      maxTokens: 8192,
      maxRetries: MAX_RETRIES,
      debugDir: args.outputDir,
      debugPrefix: "take-pass",
    });

    const takePass = normalizeTakePassResult(takePassRaw);
    step1Taken = cloneJson(step1Cleaned);
    applyTakePass(step1Taken, takePass);

    writeFileSync(
      join(args.outputDir, "take_pass_result.json"),
      JSON.stringify(takePass, null, 2),
      "utf-8"
    );
    writeFileSync(
      join(args.outputDir, "step1_taken.json"),
      JSON.stringify(step1Taken, null, 2),
      "utf-8"
    );
  }

  const step2Raw = usesAnthropicForStep2
    ? await callAnthropicJson<any>({
        apiKey: anthropicApiKey,
        model: args.model,
        systemPrompt: SYSTEM_PROMPT_STEP2,
        userPrompt: buildUserPromptStep2(step1Taken, reviewedTranscript.words),
        maxTokens: 16384,
        maxRetries: MAX_RETRIES,
        debugDir: args.outputDir,
        debugPrefix: "step2",
      })
    : await callGeminiJson<any>({
        apiKey,
        model: args.model,
        systemPrompt: SYSTEM_PROMPT_STEP2,
        userPrompt: buildUserPromptStep2(step1Taken, reviewedTranscript.words),
        maxOutputTokens: 16384,
        maxRetries: MAX_RETRIES,
        debugDir: args.outputDir,
        debugPrefix: "step2",
      });

  writeFileSync(
    join(args.outputDir, "step2_result.json"),
    JSON.stringify(step2Raw, null, 2),
    "utf-8"
  );

  const merged = mergeStep2WithAtoms(step1Taken, step2Raw);
  writeFileSync(
    join(args.outputDir, "blueprint_merged.json"),
    JSON.stringify(merged, null, 2),
    "utf-8"
  );

  const repaired = autoRepairBlueprint(merged);
  const spokenDuration = transcript.words.reduce(
    (sum: number, word: Word) => sum + (word.end - word.start),
    0
  );
  const validation = validateBlueprint(
    repaired,
    transcript.duration,
    spokenDuration
  );

  if (validation.zodErrors) {
    throw new Error(
      `Blueprint Zod validation failed:\n${validation.zodErrors.join("\n")}`
    );
  }
  if (validation.logicErrors?.length) {
    throw new Error(
      `Blueprint logic validation failed:\n${validation.logicErrors.join("\n")}`
    );
  }

  const blueprint = validation.data as Blueprint;
  postProcessBlueprint(blueprint, transcript, reviewedTranscript, {
    debugPath: join(args.outputDir, "atom_alignment_debug.json"),
  });

  writeFileSync(
    join(args.outputDir, "step2_diagnostics.json"),
    JSON.stringify(buildStep2Diagnostics(blueprint), null, 2),
    "utf-8"
  );
  writeFileSync(
    join(args.outputDir, "blueprint.json"),
    JSON.stringify(blueprint, null, 2),
    "utf-8"
  );

  const timing = await buildDirectTimingMap(
    videoPath,
    blueprint,
    args.outputDir,
    "media_range_v2",
    transcript
  );

  if (args.skipRender) {
    console.log(
      JSON.stringify(
        {
          outputDir: args.outputDir,
          blueprintPath: join(args.outputDir, "blueprint.json"),
          timingMapPath: timing.timingMapPath,
          skippedRender: true,
        },
        null,
        2
      )
    );
    return;
  }

  const resultPath = join(args.outputDir, "result.mp4");
  await renderFinalVideo({
    blueprintPath: join(args.outputDir, "blueprint.json"),
    timingMapPath: join(args.outputDir, "timing_map.json"),
    sourceVideoPath: videoPath,
    outputPath: resultPath,
  });

  console.log(
    JSON.stringify(
      {
        outputDir: args.outputDir,
        resultPath,
        blueprintPath: join(args.outputDir, "blueprint.json"),
        timingMapPath: timing.timingMapPath,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
