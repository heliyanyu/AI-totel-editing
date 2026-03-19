import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  DEFAULT_SEED_MODEL,
} from "../config/models.js";
import type { Transcript, Blueprint, Word } from "../schemas/blueprint.js";
import type { PlanningStrategy } from "../schemas/workflow.js";
import {
  SYSTEM_PROMPT_TAKE_PASS,
  buildUserPromptTakePass,
  normalizeTakePassResult,
  applyTakePass,
  type TakePassResult,
} from "./audio/index.js";
import {
  SYSTEM_PROMPT_STEP2,
  buildUserPromptStep2,
  mergeStep2WithAtoms,
} from "./semantic/index.js";
import {
  extractJson,
  autoRepairBlueprint,
  validateBlueprint,
} from "./schema.js";
import { postProcessBlueprint } from "../align/post-process.js";
import { buildStep2Diagnostics } from "./step2-diagnostics.js";
import { buildDirectTimingMap } from "../timing/build-direct-timing-map.js";
import { renderFinalVideo } from "../renderer/render.js";

type LLMProvider = "anthropic" | "openai";

interface ClientPool {
  anthropic?: Anthropic;
  openai?: OpenAI;
}

interface ReplayArgs {
  transcriptPath: string;
  reviewedTranscriptPath?: string;
  step1Path: string;
  outputDir: string;
  videoPath?: string;
  resultPath?: string;
  timingStrategy: PlanningStrategy;
  takePassProvider: LLMProvider;
  takePassModel: string;
  step2Provider: LLMProvider;
  step2Model: string;
  openaiBaseUrl?: string;
}

function parseArgs(): ReplayArgs {
  const args = process.argv.slice(2);
  const parsed: ReplayArgs = {
    transcriptPath: "",
    step1Path: "",
    outputDir: "",
    timingStrategy: "media_range_v2",
    takePassProvider: "anthropic",
    takePassModel: "",
    step2Provider: "anthropic",
    step2Model: DEFAULT_ANTHROPIC_MODEL,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--transcript":
        parsed.transcriptPath = args[++i];
        break;
      case "--reviewed-transcript":
        parsed.reviewedTranscriptPath = args[++i];
        break;
      case "--step1":
        parsed.step1Path = args[++i];
        break;
      case "--output-dir":
        parsed.outputDir = args[++i];
        break;
      case "--video":
        parsed.videoPath = args[++i];
        break;
      case "--result":
        parsed.resultPath = args[++i];
        break;
      case "--timing-strategy":
        parsed.timingStrategy = args[++i] as PlanningStrategy;
        break;
      case "--take-pass-provider":
        parsed.takePassProvider = args[++i] as LLMProvider;
        break;
      case "--take-pass-model":
        parsed.takePassModel = args[++i];
        break;
      case "--step2-provider":
        parsed.step2Provider = args[++i] as LLMProvider;
        break;
      case "--step2-model":
        parsed.step2Model = args[++i];
        break;
      case "--openai-base-url":
        parsed.openaiBaseUrl = args[++i];
        break;
    }
  }

  if (!parsed.transcriptPath || !parsed.step1Path || !parsed.outputDir) {
    throw new Error(
      "Usage: npx tsx src/analyze/replay-take-pass.ts --transcript transcript.json --step1 step1_result.json --output-dir out [--reviewed-transcript reviewed_transcript.json] [--video source.mp4 --result result.mp4]"
    );
  }

  if (!parsed.takePassModel) {
    parsed.takePassModel =
      parsed.takePassProvider === "openai"
        ? DEFAULT_SEED_MODEL
        : DEFAULT_ANTHROPIC_MODEL;
  }

  return parsed;
}

function getAnthropicClient(clients: ClientPool): Anthropic {
  if (clients.anthropic) {
    return clients.anthropic;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("»±…Ÿ ANTHROPIC_API_KEY°£");
  }
  clients.anthropic = new Anthropic({ apiKey });
  return clients.anthropic;
}

function getOpenAIClient(clients: ClientPool, baseUrl?: string): OpenAI {
  if (clients.openai) {
    return clients.openai;
  }
  const apiKey = process.env.ARK_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("»±…Ÿ ARK_API_KEY ªÚ OPENAI_API_KEY°£");
  }
  clients.openai = new OpenAI({
    apiKey,
    baseURL:
      baseUrl ??
      process.env.ARK_BASE_URL ??
      process.env.OPENAI_BASE_URL ??
      DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  });
  return clients.openai;
}

function extractOpenAITextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}

async function callLLM(options: {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  debugDir: string;
  debugPrefix: string;
  clients: ClientPool;
  openaiBaseUrl?: string;
}): Promise<unknown> {
  let rawText = "";

  if (options.provider === "anthropic") {
    const client = getAnthropicClient(options.clients);
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
      `  Token: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`
    );
    rawText ||= response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  } else {
    const client = getOpenAIClient(options.clients, options.openaiBaseUrl);
    const response = await client.chat.completions.create({
      model: options.model,
      temperature: 0,
      max_tokens: options.maxTokens,
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ],
    } as any);

    if (response.usage) {
      console.log(
        `  Token: input=${response.usage.prompt_tokens ?? 0}, output=${response.usage.completion_tokens ?? 0}`
      );
    }

    rawText = extractOpenAITextContent(
      response.choices?.[0]?.message?.content ?? ""
    );
  }

  if (!rawText) {
    throw new Error(`LLM [${options.debugPrefix}] ÂìçÂ∫î‰∏∫Á©∫`);
  }

  writeFileSync(
    join(options.debugDir, `llm-${options.debugPrefix}-raw.txt`),
    rawText,
    "utf-8"
  );

  const rawJson = extractJson(rawText);
  writeFileSync(
    join(options.debugDir, `llm-${options.debugPrefix}-parsed.json`),
    JSON.stringify(rawJson, null, 2),
    "utf-8"
  );

  return rawJson;
}

async function replay(): Promise<void> {
  const args = parseArgs();
  const outputDir = resolve(args.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const transcript: Transcript = JSON.parse(
    readFileSync(resolve(args.transcriptPath), "utf-8")
  );
  const reviewedTranscript: Transcript = args.reviewedTranscriptPath
    ? JSON.parse(readFileSync(resolve(args.reviewedTranscriptPath), "utf-8"))
    : transcript;
  const step1Result = JSON.parse(readFileSync(resolve(args.step1Path), "utf-8"));

  const clients: ClientPool = {};

  writeFileSync(
    join(outputDir, "replay_manifest.json"),
    JSON.stringify(
      {
        transcriptPath: resolve(args.transcriptPath),
        reviewedTranscriptPath: args.reviewedTranscriptPath
          ? resolve(args.reviewedTranscriptPath)
          : null,
        step1Path: resolve(args.step1Path),
        takePassProvider: args.takePassProvider,
        takePassModel: args.takePassModel,
        step2Provider: args.step2Provider,
        step2Model: args.step2Model,
        videoPath: args.videoPath ? resolve(args.videoPath) : null,
        resultPath: args.resultPath ? resolve(args.resultPath) : null,
      },
      null,
      2
    ),
    "utf-8"
  );

  const takePass = normalizeTakePassResult(
    await callLLM({
      provider: args.takePassProvider,
      model: args.takePassModel,
      systemPrompt: SYSTEM_PROMPT_TAKE_PASS,
      userPrompt: buildUserPromptTakePass(step1Result.atoms, reviewedTranscript.words),
      maxTokens: 8192,
      debugDir: outputDir,
      debugPrefix: "take-pass",
      clients,
      openaiBaseUrl: args.openaiBaseUrl,
    })
  );

  const step1Taken =
    typeof structuredClone === "function"
      ? structuredClone(step1Result)
      : JSON.parse(JSON.stringify(step1Result));
  const takeStats = applyTakePass(step1Taken, takePass);

  writeFileSync(
    join(outputDir, "take_pass_result.json"),
    JSON.stringify(takePass, null, 2),
    "utf-8"
  );
  writeFileSync(
    join(outputDir, "step1_taken.json"),
    JSON.stringify(step1Taken, null, 2),
    "utf-8"
  );

  console.log(
    `  Take Pass ÂÆåÊàê: ${takeStats.takeCount} ‰∏?take, ${takeStats.keptAtomCount} keep, ${takeStats.discardedAtomCount} discard`
  );

  const step2Result = await callLLM({
    provider: args.step2Provider,
    model: args.step2Model,
    systemPrompt: SYSTEM_PROMPT_STEP2,
    userPrompt: buildUserPromptStep2(step1Taken, reviewedTranscript.words),
    maxTokens: 8192,
    debugDir: outputDir,
    debugPrefix: "step2",
    clients,
    openaiBaseUrl: args.openaiBaseUrl,
  });

  writeFileSync(
    join(outputDir, "step2_result.json"),
    JSON.stringify(step2Result, null, 2),
    "utf-8"
  );

  const merged = mergeStep2WithAtoms(step1Taken, step2Result);
  writeFileSync(
    join(outputDir, "blueprint_merged.json"),
    JSON.stringify(merged, null, 2),
    "utf-8"
  );

  const repaired = autoRepairBlueprint(merged);
  const spokenDuration = transcript.words.reduce(
    (sum, w) => sum + (w.end - w.start),
    0
  );
  const validation = validateBlueprint(repaired, transcript.duration, spokenDuration);
  if (validation.zodErrors) {
    throw new Error(`Blueprint Zod Ê†°È™åÂ§±Ë¥•:\n  ${validation.zodErrors.join("\n  ")}`);
  }
  if (validation.logicErrors?.length) {
    throw new Error(`Blueprint ÈÄªËæëÊ†°È™åÂ§±Ë¥•:\n  ${validation.logicErrors.join("\n  ")}`);
  }

  const blueprint = validation.data as Blueprint;
  postProcessBlueprint(
    blueprint,
    transcript,
    reviewedTranscript,
    { debugPath: join(outputDir, "atom_alignment_debug.json") }
  );
  writeFileSync(
    join(outputDir, "blueprint.json"),
    JSON.stringify(blueprint, null, 2),
    "utf-8"
  );
  writeFileSync(
    join(outputDir, "step2_diagnostics.json"),
    JSON.stringify(buildStep2Diagnostics(blueprint), null, 2),
    "utf-8"
  );

  if (!args.videoPath) {
    return;
  }

  const timing = await buildDirectTimingMap(
    resolve(args.videoPath),
    blueprint,
    outputDir,
    args.timingStrategy,
    transcript
  );
  writeFileSync(
    join(outputDir, "timing_map.json"),
    JSON.stringify(timing.timingMap, null, 2),
    "utf-8"
  );

  if (!args.resultPath) {
    return;
  }

  await renderFinalVideo({
    blueprintPath: join(outputDir, "blueprint.json"),
    timingMapPath: join(outputDir, "timing_map.json"),
    sourceVideoPath: resolve(args.videoPath),
    outputPath: resolve(args.resultPath),
  });
}

replay().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

