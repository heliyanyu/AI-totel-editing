import { execFileSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_SONNET_MODEL,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  DEFAULT_SEED_MODEL,
} from "../config/models.js";
import type { Transcript, Blueprint, Word } from "../schemas/blueprint.js";
import type { PlanningStrategy } from "../schemas/workflow.js";
import {
  SYSTEM_PROMPT_TAKE_PASS,
  buildUserPromptTakePass,
  parseMarkedTakePass,
  normalizeTakePassResult,
  applyTakePass,
  type TakePassResult,
} from "./audio/index.js";
import {
  SYSTEM_PROMPT_STEP2,
  buildUserPromptStep2,
  mergeStep2WithAtoms,
  parseStep2MarkedText,
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

const windowsUserEnvCache = new Map<string, string | null>();

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

function readWindowsUserEnv(name: string): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }

  if (windowsUserEnvCache.has(name)) {
    return windowsUserEnvCache.get(name) ?? undefined;
  }

  try {
    const value = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `[System.Environment]::GetEnvironmentVariable('${name}', 'User')`,
      ],
      { encoding: "utf8" }
    ).trim();

    const normalized = value || null;
    windowsUserEnvCache.set(name, normalized);
    return normalized ?? undefined;
  } catch {
    windowsUserEnvCache.set(name, null);
    return undefined;
  }
}

function getEnvVar(name: string): string | undefined {
  return process.env[name] || readWindowsUserEnv(name);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function getAnthropicOpenAICompatBaseUrl(
  explicitBaseUrl?: string
): string | undefined {
  const baseUrl =
    explicitBaseUrl ??
    getEnvVar("ANTHROPIC_OPENAI_BASE_URL") ??
    getEnvVar("ANTHROPIC_COMPAT_BASE_URL");

  return baseUrl ? normalizeBaseUrl(baseUrl) : undefined;
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
        : DEFAULT_ANTHROPIC_SONNET_MODEL;
  }

  return parsed;
}

function getAnthropicClient(clients: ClientPool): Anthropic {
  if (clients.anthropic) {
    return clients.anthropic;
  }
  const apiKey = getEnvVar("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ȱ�� ANTHROPIC_API_KEY��");
  }
  const baseURL = getEnvVar("ANTHROPIC_BASE_URL");
  const proxyURL = baseURL ? normalizeBaseUrl(baseURL) : undefined;
  clients.anthropic = new Anthropic({
    apiKey,
    ...(proxyURL
      ? { fetch: ((_url: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(proxyURL, init)) as typeof globalThis.fetch }
      : {}),
  });
  return clients.anthropic;
}

function getOpenAIClient(clients: ClientPool, baseUrl?: string): OpenAI {
  if (clients.openai) {
    return clients.openai;
  }
  const apiKey = getEnvVar("OPENAI_API_KEY") ?? getEnvVar("DEEPSEEK_API_KEY") ?? getEnvVar("ARK_API_KEY");
  if (!apiKey) {
    throw new Error("缺少 OPENAI_API_KEY。");
  }
  clients.openai = new OpenAI({
    apiKey,
    baseURL: normalizeBaseUrl(
      baseUrl ??
        getEnvVar("OPENAI_BASE_URL") ??
        getEnvVar("ARK_BASE_URL") ??
        DEFAULT_OPENAI_COMPATIBLE_BASE_URL
    ),
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
  returnRawText?: boolean;
}): Promise<unknown> {
  let rawText = "";

  if (options.provider === "anthropic") {
    const compatBaseUrl = getAnthropicOpenAICompatBaseUrl(options.openaiBaseUrl);

    if (compatBaseUrl) {
      const compatApiKey = getEnvVar("ANTHROPIC_API_KEY");
      if (!compatApiKey) {
        throw new Error("Missing ANTHROPIC_API_KEY.");
      }

      const client = new OpenAI({
        apiKey: compatApiKey,
        baseURL: compatBaseUrl,
      });
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
    } else {
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
    }
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
    throw new Error(`LLM [${options.debugPrefix}] 响应为空`);
  }

  writeFileSync(
    join(options.debugDir, `llm-${options.debugPrefix}-raw.txt`),
    rawText,
    "utf-8"
  );

  if (options.returnRawText) {
    return rawText;
  }

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

  const takePassRawText = await callLLM({
    provider: args.takePassProvider,
    model: args.takePassModel,
    systemPrompt: SYSTEM_PROMPT_TAKE_PASS,
    userPrompt: buildUserPromptTakePass(step1Result.atoms, reviewedTranscript.words),
    maxTokens: 8192,
    debugDir: outputDir,
    debugPrefix: "take-pass",
    clients,
    openaiBaseUrl: args.openaiBaseUrl,
    returnRawText: true,
  }) as string;

  let takePass: TakePassResult;
  try {
    takePass = parseMarkedTakePass(takePassRawText, step1Result.atoms);
  } catch (markedError) {
    try {
      takePass = normalizeTakePassResult(extractJson(takePassRawText));
    } catch {
      throw markedError;
    }
  }

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
    `  Take Pass 完成: ${takeStats.takeCount} �?take, ${takeStats.keptAtomCount} keep, ${takeStats.discardedAtomCount} discard`
  );

  const step2RawText = await callLLM({
    provider: args.step2Provider,
    model: args.step2Model,
    systemPrompt: SYSTEM_PROMPT_STEP2,
    userPrompt: buildUserPromptStep2(step1Taken, reviewedTranscript.words),
    maxTokens: 16384,
    debugDir: outputDir,
    debugPrefix: "step2",
    clients,
    openaiBaseUrl: args.openaiBaseUrl,
    returnRawText: true,
  }) as string;

  const step2Result = parseStep2MarkedText(step2RawText);
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
    throw new Error(`Blueprint Zod 校验失败:\n  ${validation.zodErrors.join("\n  ")}`);
  }
  if (validation.logicErrors?.length) {
    throw new Error(`Blueprint 逻辑校验失败:\n  ${validation.logicErrors.join("\n  ")}`);
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

