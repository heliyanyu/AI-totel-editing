import { execFileSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  SYSTEM_PROMPT_STEP1,
  buildUserPromptStep1,
  SYSTEM_PROMPT_STEP2,
  buildUserPromptStep2,
  mergeStep2WithAtoms,
} from "../src/analyze/semantic/index.js";
import {
  SYSTEM_PROMPT_TRANSCRIPT_REVIEW,
  applyTranscriptReview,
  buildUserPromptTranscriptReview,
  normalizeTranscriptReview,
  transcriptToPlainText,
} from "../src/analyze/review/index.js";
import {
  SYSTEM_PROMPT_TAKE_PASS,
  buildUserPromptTakePass,
  normalizeTakePassResult,
  applyTakePass,
} from "../src/analyze/audio/index.js";
import {
  extractJson,
  autoRepairBlueprint,
  validateBlueprint,
} from "../src/analyze/schema.js";
import { extractScriptText } from "../src/analyze/step1-cleaning.js";
import { buildStep1Hints } from "../src/analyze/step1-hints.js";
import { buildStep2Diagnostics } from "../src/analyze/step2-diagnostics.js";
import { postProcessBlueprint } from "../src/align/post-process.js";
import { buildDirectTimingMap } from "../src/timing/build-direct-timing-map.js";
import { renderFinalVideo } from "../src/renderer/render.js";
import { DEFAULT_ANTHROPIC_MODEL } from "../src/config/models.js";
import type { Transcript, Blueprint, Word } from "../src/schemas/blueprint.js";

const DEFAULT_MODEL = "gemini-3.1-pro-preview";
const DEFAULT_TAKE_PASS_MODEL = DEFAULT_ANTHROPIC_MODEL;
const DEFAULT_VIDEO_PATH =
  "test/wj 支架的四个队友/3179cc2fca3e27948795d9c48d50636b_raw.mp4";
const DEFAULT_SCRIPT_PATH =
  "test/wj 支架的四个队友/常尚 wj 支架的四个队友.docx";
const DEFAULT_TRANSCRIPT_PATH =
  "output/3179cc2fca3e27948795d9c48d50636b_raw_20260318_034110/transcript.json";
const DEFAULT_OUTPUT_PREFIX = "case03_gemini31_native";
const MAX_RETRIES = 2;
const THINKING_BUDGET = 512;

interface Args {
  model: string;
  takePassModel: string;
  videoPath: string;
  scriptPath: string;
  transcriptPath: string;
  outputDir: string;
  skipRender: boolean;
}

interface GeminiCallOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  maxRetries: number;
  debugDir: string;
  debugPrefix: string;
}

interface AnthropicCallOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  maxRetries: number;
  debugDir: string;
  debugPrefix: string;
}

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
  let model = DEFAULT_MODEL;
  let takePassModel = DEFAULT_TAKE_PASS_MODEL;
  let videoPath = resolve(DEFAULT_VIDEO_PATH);
  let scriptPath = resolve(DEFAULT_SCRIPT_PATH);
  let transcriptPath = resolve(DEFAULT_TRANSCRIPT_PATH);
  let outputDir = resolve("output", `${DEFAULT_OUTPUT_PREFIX}_${timestamp()}`);
  let skipRender = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--model":
        model = args[++i];
        break;
      case "--video":
        videoPath = resolve(args[++i]);
        break;
      case "--take-pass-model":
        takePassModel = args[++i];
        break;
      case "--script":
        scriptPath = resolve(args[++i]);
        break;
      case "--transcript":
        transcriptPath = resolve(args[++i]);
        break;
      case "--output-dir":
        outputDir = resolve(args[++i]);
        break;
      case "--skip-render":
        skipRender = true;
        break;
    }
  }

  return {
    model,
    takePassModel,
    videoPath,
    scriptPath,
    transcriptPath,
    outputDir,
    skipRender,
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
    // Ignore and fall through to the final error.
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
    // Ignore and fall through to the final error.
  }

  throw new Error("Missing ANTHROPIC_API_KEY.");
}

function ensurePathExists(path: string, label: string) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
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

function cloneJson<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

async function run(): Promise<void> {
  const args = parseArgs();
  const apiKey = getGeminiApiKey();
  const anthropicApiKey = getAnthropicApiKey();

  ensurePathExists(args.videoPath, "video");
  ensurePathExists(args.scriptPath, "script");
  ensurePathExists(args.transcriptPath, "transcript");

  mkdirSync(args.outputDir, { recursive: true });

  const transcript = JSON.parse(
    readFileSync(args.transcriptPath, "utf-8")
  ) as Transcript;
  const scriptText = await extractScriptText(args.scriptPath);

  writeFileSync(
    join(args.outputDir, "transcript.json"),
    JSON.stringify(transcript, null, 2),
    "utf-8"
  );
  writeFileSync(
    join(args.outputDir, "transcript_plain.txt"),
    transcriptToPlainText(transcript.words),
    "utf-8"
  );
  writeFileSync(join(args.outputDir, "script_plain.txt"), scriptText, "utf-8");
  writeFileSync(
    join(args.outputDir, "gemini_run_manifest.json"),
    JSON.stringify(
      {
        model: args.model,
        takePassModel: args.takePassModel,
        videoPath: args.videoPath,
        scriptPath: args.scriptPath,
        transcriptPath: args.transcriptPath,
        outputDir: args.outputDir,
        createdAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`Output: ${args.outputDir}`);
  console.log(`Model:  ${args.model}`);
  console.log(`Take-pass model: ${args.takePassModel}`);

  const reviewRaw = await callGeminiJson({
    apiKey,
    model: args.model,
    systemPrompt: SYSTEM_PROMPT_TRANSCRIPT_REVIEW,
    userPrompt: buildUserPromptTranscriptReview(transcript.words, scriptText),
    maxOutputTokens: 8192,
    maxRetries: MAX_RETRIES,
    debugDir: args.outputDir,
    debugPrefix: "transcript-review",
  });
  const review = normalizeTranscriptReview(reviewRaw, transcript.words);
  const { reviewedTranscript, report } = applyTranscriptReview(transcript, review);
  const step1Transcript = reviewedTranscript;

  writeFileSync(
    join(args.outputDir, "transcript_review.json"),
    JSON.stringify(report, null, 2),
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
  if (report.reviewSpans?.length) {
    writeFileSync(
      join(args.outputDir, "review_spans.json"),
      JSON.stringify(report.reviewSpans, null, 2),
      "utf-8"
    );
  }

  const step1Hints = await buildStep1Hints(step1Transcript.words);
  if (step1Hints) {
    writeFileSync(
      join(args.outputDir, "step1_hints.json"),
      JSON.stringify(step1Hints, null, 2),
      "utf-8"
    );
  }

  const step1Result = await callGeminiJson<any>({
    apiKey,
    model: args.model,
    systemPrompt: SYSTEM_PROMPT_STEP1,
    userPrompt: buildUserPromptStep1(step1Transcript.words, step1Hints),
    maxOutputTokens: 16384,
    maxRetries: MAX_RETRIES,
    debugDir: args.outputDir,
    debugPrefix: "step1",
  });

  if (!Array.isArray(step1Result?.atoms)) {
    throw new Error("Step1 output is missing atoms[]");
  }

  for (const atom of step1Result.atoms) {
    atom.status = "keep";
    delete atom.reason;
  }

  writeFileSync(
    join(args.outputDir, "step1_result.json"),
    JSON.stringify(step1Result, null, 2),
    "utf-8"
  );

  const step1Cleaned = cloneJson(step1Result);
  writeFileSync(
    join(args.outputDir, "step1_cleaned.json"),
    JSON.stringify(step1Cleaned, null, 2),
    "utf-8"
  );

  const takePassRaw = await callAnthropicJson<any>({
    apiKey: anthropicApiKey,
    model: args.takePassModel,
    systemPrompt: SYSTEM_PROMPT_TAKE_PASS,
    userPrompt: buildUserPromptTakePass(step1Cleaned.atoms, step1Transcript.words),
    maxTokens: 8192,
    maxRetries: MAX_RETRIES,
    debugDir: args.outputDir,
    debugPrefix: "take-pass",
  });
  const takePass = normalizeTakePassResult(takePassRaw);
  const step1Taken = cloneJson(step1Cleaned);
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

  const step2Result = await callGeminiJson<any>({
    apiKey,
    model: args.model,
    systemPrompt: SYSTEM_PROMPT_STEP2,
    userPrompt: buildUserPromptStep2(step1Taken, step1Transcript.words),
    maxOutputTokens: 16384,
    maxRetries: MAX_RETRIES,
    debugDir: args.outputDir,
    debugPrefix: "step2",
  });

  writeFileSync(
    join(args.outputDir, "step2_result.json"),
    JSON.stringify(step2Result, null, 2),
    "utf-8"
  );

  const merged = mergeStep2WithAtoms(step1Taken, step2Result);
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
  postProcessBlueprint(blueprint, transcript, step1Transcript, {
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
    args.videoPath,
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
    sourceVideoPath: args.videoPath,
    outputPath: resultPath,
  });

  console.log(
    JSON.stringify(
      {
        outputDir: args.outputDir,
        blueprintPath: join(args.outputDir, "blueprint.json"),
        timingMapPath: timing.timingMapPath,
        resultPath,
        duration: timing.timingMap.totalDuration,
        clipCount: timing.timingMap.clips.length,
        sceneCount: blueprint.scenes.length,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
