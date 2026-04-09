/**
 * 分析主链路（当前架构版本）
 *
 * 这里负责把几条独立通道串起来，而不是让它们重新混线。
 *
 * 通道 0：force-align / 强制对齐（可选）
 * - 输入：原始 transcript + 原音视频
 * - 输出：aligned word transcript + aligned token transcript
 * - 职责：把后续链路要信任的时间戳从 ASR 初稿提升为强制对齐结果
 *
 * 通道 1：review / 文本清洗
 * - 输入：word-level transcript + 可选 docx
 * - 输出：review_spans + reviewed_transcript
 * - 职责：纠错并强绑定回 source words
 *
 * 通道 2：Step1 / 语义结构
 * - 输入：reviewed_transcript
 * - 输出：scene / logic / semantic atoms
 * - 职责：只切语义结构，不负责最终 discard
 *
 * 通道 3：take-pass / 音频选块
 * - 输入：semantic atoms + reviewed_transcript
 * - 输出：最终 keep/discard 取舍
 * - 职责：只负责可播音频块选择，不改文本、不改语义结构
 *
 * 通道 4：Step2 / 结构编排
 * - 输入：take 后的语义结构
 * - 输出：view / template / items 等编排信息
 *
 * 通道 5：post-process / 渲染前补齐
 * - 输入：blueprint + aligned token transcript
 * - 输出：字幕对齐、media_range 等执行信息
 *
 * 最终流程：
 * transcript.json -> force-align? -> review -> Step1 -> take-pass -> Step2 -> merge ->
 * post-process -> blueprint.json
 */

import { execFileSync, spawnSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve, join } from "path";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_ANTHROPIC_SONNET_MODEL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_QWEN_MODEL,
  DEFAULT_QWEN_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  DEFAULT_SEED_MODEL,
} from "../config/models.js";
import {
  SYSTEM_PROMPT_STEP1,
  buildUserPromptStep1,
  normalizeStep1Result,
  SYSTEM_PROMPT_STEP2,
  buildUserPromptStep2,
  buildSubtitleOnlyBlueprint,
  mergeStep2WithAtoms,
  parseStep2MarkedText,
} from "./semantic/index.js";
import {
  extractJson,
  autoRepairBlueprint,
  validateBlueprint,
} from "./schema.js";
import { extractScriptText } from "./step1-cleaning.js";
import {
  buildStep1Hints,
} from "./step1-hints.js";
import {
  SYSTEM_PROMPT_TRANSCRIPT_REVIEW,
  applyTranscriptReview,
  buildUserPromptTranscriptReview,
  normalizeTranscriptReview,
  transcriptToPlainText,
  type TranscriptReview,
} from "./review/index.js";
import {
  SYSTEM_PROMPT_TAKE_PASS,
  buildUserPromptTakePass,
  normalizeTakePassResult,
  toLegacyTakePassResult,
  parseMarkedTakePass,
  applyTakePass,
  type TakePassResult,
} from "./audio/index.js";
import type {
  AlignedTokenTranscript,
  Transcript,
  Blueprint,
  ReviewedTokenDocument,
  Word,
} from "../schemas/blueprint.js";
import { buildStep2Diagnostics } from "./step2-diagnostics.js";
import { deriveBlueprintAtomsFromTranscript } from "./derive/atom-from-tokens.js";
import {
  runQwenForcedAlign,
  type QwenForcedAlignDType,
} from "../force-align/qwen.js";
import {
  runQwenTranscribe,
  type QwenTranscribeDType,
} from "../transcribe/qwen.js";

const DEFAULT_PROVIDER: LLMProvider = "anthropic";
const DEFAULT_MODEL = DEFAULT_ANTHROPIC_SONNET_MODEL;
const MAX_RETRIES = 2;
const MAX_TOKENS_REVIEW = 8192;
const MAX_TOKENS_STEP1 = 16384;
const MAX_TOKENS_TAKE_PASS = 8192;
const MAX_TOKENS_STEP2 = 16384;
const DEFAULT_GEMINI_API_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";

const TAKE_PASS_JSON_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["discard_ranges"],
  properties: {
    discard_ranges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["start_atom_id", "end_atom_id"],
        properties: {
          start_atom_id: { type: "integer" },
          end_atom_id: { type: "integer" },
        },
      },
    },
  },
};

export type LLMProvider = "anthropic" | "openai" | "gemini" | "cli";

interface StageModelConfig {
  provider: LLMProvider;
  model: string;
}

interface AnalyzeModelOptions {
  provider?: LLMProvider;
  model?: string;
  reviewProvider?: LLMProvider;
  reviewModel?: string;
  step1Provider?: LLMProvider;
  step1Model?: string;
  takePassProvider?: LLMProvider;
  takePassModel?: string;
  step2Provider?: LLMProvider;
  step2Model?: string;
}

interface ClientPool {
  anthropic?: Anthropic;
  openai?: OpenAI;
}

const windowsUserEnvCache = new Map<string, string | null>();

type JsonSchema = Record<string, unknown>;

interface CallLLMOptions {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  maxRetries: number;
  debugDir: string;
  debugPrefix: string;
  clients: ClientPool;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  geminiApiKey?: string;
  geminiApiBaseUrl?: string;
  expectJson?: boolean;
  responseJsonSchema?: JsonSchema;
  returnRawText?: boolean;
  geminiThinkingLevel?: "low" | "high";
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

interface LLMCredentials {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  geminiApiKey?: string;
  geminiApiBaseUrl?: string;
}

interface ForceAlignRuntimeOptions {
  audioPath?: string;
  enabled?: boolean;
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

function getOpenAIClient(options: {
  clients: ClientPool;
  apiKey?: string;
  baseUrl?: string;
}): OpenAI {
  if (options.clients.openai) {
    return options.clients.openai;
  }

  const apiKey =
    options.apiKey ??
    getEnvVar("OPENAI_API_KEY") ??
    getEnvVar("DEEPSEEK_API_KEY") ??
    getEnvVar("ARK_API_KEY");

  if (!apiKey) {
    throw new Error(
      "缺少 API Key。请设置 OPENAI_API_KEY。"
    );
  }

  const baseURL =
    options.baseUrl ??
    getEnvVar("OPENAI_BASE_URL") ??
    getEnvVar("ARK_BASE_URL") ??
    DEFAULT_OPENAI_COMPATIBLE_BASE_URL;

  options.clients.openai = new OpenAI({
    apiKey,
    baseURL: normalizeBaseUrl(baseURL),
  });

  return options.clients.openai;
}

function getAnthropicClient(options: {
  clients: ClientPool;
  apiKey?: string;
}): Anthropic {
  if (options.clients.anthropic) {
    return options.clients.anthropic;
  }

  const apiKey = options.apiKey ?? getEnvVar("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("缺少 ANTHROPIC_API_KEY。");
  }

  const baseURL = getEnvVar("ANTHROPIC_BASE_URL");
  const proxyURL = baseURL ? normalizeBaseUrl(baseURL) : undefined;
  options.clients.anthropic = new Anthropic({
    apiKey,
    ...(proxyURL
      ? { fetch: ((_url: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(proxyURL, init)) as typeof globalThis.fetch }
      : {}),
  });
  return options.clients.anthropic;
}

function getGeminiApiKey(explicitApiKey?: string): string {
  const apiKey =
    explicitApiKey ?? getEnvVar("GEMINI_API_KEY") ?? getEnvVar("GOOGLE_API_KEY");

  if (!apiKey) {
    throw new Error("缺少 Gemini API Key。请设置 GEMINI_API_KEY 或 GOOGLE_API_KEY。");
  }

  return apiKey;
}

function normalizeGeminiApiBaseUrl(explicitBaseUrl?: string): string {
  const baseUrl =
    explicitBaseUrl ?? getEnvVar("GEMINI_BASE_URL") ?? DEFAULT_GEMINI_API_BASE_URL;
  return normalizeBaseUrl(baseUrl);
}

function normalizeGeminiModelName(model: string): string {
  return model.startsWith("models/") ? model.slice("models/".length) : model;
}

function isGeminiDirectProvider(provider: LLMProvider): boolean {
  return provider === "gemini";
}

function extractGeminiTextContent(response: GeminiGenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? "").join("");
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

function buildReviewedTokensFromTranscript(transcript: Transcript): ReviewedTokenDocument {
  return {
    text: transcriptToPlainText(transcript.words),
    tokens: transcript.words.map((word, index) => ({
      id: index,
      text: word.text,
      raw_word_indices: word.source_word_indices ?? [index],
      source_start: word.source_start ?? word.start,
      source_end: word.source_end ?? word.end,
      synthetic: word.synthetic,
    })),
  };
}

function reviewedTokensToApproxTranscript(
  reviewedTokens: ReviewedTokenDocument,
  fallbackDuration: number
): Transcript {
  return {
    duration: fallbackDuration,
    words: reviewedTokens.tokens.map((token, index) => ({
      text: token.text,
      start: token.source_start ?? 0,
      end: token.source_end ?? token.source_start ?? 0,
      source_word_indices: token.raw_word_indices ?? [index],
      source_start: token.source_start,
      source_end: token.source_end,
      synthetic: token.synthetic,
    })),
  };
}

function alignedTokensToTranscript(transcript: AlignedTokenTranscript): Transcript {
  return {
    duration: transcript.duration,
    words: transcript.tokens.map((token, index) => ({
      text: token.text,
      start: token.start,
      end: token.end,
      source_word_indices: token.raw_word_indices ?? [index],
      source_start: token.source_start ?? token.start,
      source_end: token.source_end ?? token.end,
      synthetic: token.synthetic,
    })),
  };
}

function loadTranscriptDocument(filePath: string): Transcript {
  const payload = JSON.parse(readFileSync(filePath, "utf-8")) as {
    duration?: unknown;
    words?: unknown;
    tokens?: unknown;
  };

  if (typeof payload.duration !== "number") {
    throw new Error(`Invalid transcript payload: missing numeric duration in ${filePath}`);
  }

  if (Array.isArray(payload.words)) {
    return payload as Transcript;
  }

  if (Array.isArray(payload.tokens)) {
    return alignedTokensToTranscript(payload as AlignedTokenTranscript);
  }

  throw new Error(
    `Unsupported transcript payload in ${filePath}. Expected either {duration, words} or {duration, tokens}.`
  );
}

async function callLLM(opts: CallLLMOptions): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`  重试 ${attempt}/${opts.maxRetries} ...`);
    }

    let ticker: ReturnType<typeof setInterval> | null = null;
    try {
      const startMs = Date.now();
      process.stdout.write(
        `  调用 ${opts.provider}:${opts.model} [${opts.debugPrefix}] `
      );
      ticker = setInterval(() => process.stdout.write("."), 5000);

      let rawText = "";
      let parsedJson: unknown | undefined;

      if (opts.provider === "anthropic") {
        const compatBaseUrl = getAnthropicOpenAICompatBaseUrl(opts.openaiBaseUrl);

        if (compatBaseUrl) {
          const compatApiKey = opts.anthropicApiKey ?? getEnvVar("ANTHROPIC_API_KEY");
          if (!compatApiKey) {
            throw new Error("缺少 ANTHROPIC_API_KEY。");
          }

          const client = new OpenAI({
            apiKey: compatApiKey,
            baseURL: compatBaseUrl,
          });
          const response = await client.chat.completions.create({
            model: opts.model,
            max_tokens: opts.maxTokens,
            messages: [
              { role: "system", content: opts.systemPrompt },
              { role: "user", content: opts.userPrompt },
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
          const client = getAnthropicClient({
            clients: opts.clients,
            apiKey: opts.anthropicApiKey,
          });
          const userPrompt = opts.expectJson
            ? opts.userPrompt + "\n\n请直接输出 JSON，不要输出任何解释、分析或其他文字。"
            : opts.userPrompt;
          const stream = client.messages
            .stream({
              model: opts.model,
              max_tokens: opts.maxTokens,
              system: opts.systemPrompt,
              messages: [{ role: "user", content: userPrompt }],
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
      } else if (isGeminiDirectProvider(opts.provider)) {
        const apiKey = getGeminiApiKey(opts.geminiApiKey);
        const baseUrl = normalizeGeminiApiBaseUrl(opts.geminiApiBaseUrl);
        const modelName = normalizeGeminiModelName(opts.model);
        const generationConfig: Record<string, unknown> = {
          maxOutputTokens: opts.maxTokens,
        };

        if (opts.geminiThinkingLevel) {
          generationConfig.thinkingConfig = {
            thinkingLevel: opts.geminiThinkingLevel,
          };
        }

        if (opts.expectJson) {
          generationConfig.responseMimeType = "application/json";
        }
        if (opts.responseJsonSchema) {
          generationConfig.responseJsonSchema = opts.responseJsonSchema;
        }

        const response = await fetch(
          `${baseUrl}/models/${modelName}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: opts.systemPrompt }],
              },
              contents: [
                {
                  role: "user",
                  parts: [{ text: opts.userPrompt }],
                },
              ],
              generationConfig,
            }),
          }
        );

        const responseText = await response.text();
        if (!response.ok) {
          throw new Error(
            `Gemini API request failed (${response.status}): ${responseText}`
          );
        }

        const payload = JSON.parse(responseText) as GeminiGenerateContentResponse;
        if (payload.usageMetadata) {
          console.log(
            `  Token: input=${payload.usageMetadata.promptTokenCount ?? 0}, output=${payload.usageMetadata.candidatesTokenCount ?? 0}`
          );
        }

        const finishReason = payload.candidates?.[0]?.finishReason;
        if (finishReason && finishReason !== "STOP") {
          console.warn(`  Gemini finishReason: ${finishReason}`);
        }

        rawText = extractGeminiTextContent(payload);
        if (opts.expectJson) {
          parsedJson = JSON.parse(rawText);
        }
      } else if (opts.provider === "cli") {
        // 通过 claude CLI 调用（无需 API Key，使用已登录的 Claude Code session）
        const combinedInput = `<instructions>\n${opts.systemPrompt}\n</instructions>\n\n${opts.userPrompt}`;
        const childEnv = { ...process.env };
        delete childEnv.CLAUDECODE;
        const result = spawnSync(
          "claude",
          ["--print", "--output-format", "text", "--model", opts.model],
          {
            input: combinedInput,
            encoding: "utf-8",
            env: childEnv,
            maxBuffer: 20 * 1024 * 1024,
            timeout: 900_000,
          }
        );
        if (result.error) {
          throw new Error(`claude CLI 启动失败: ${result.error.message}`);
        }
        if (result.status !== 0) {
          throw new Error(
            `claude CLI 退出码 ${result.status}: ${(result.stderr ?? "").trim()}`
          );
        }
        rawText = result.stdout;
      } else {
        const client = getOpenAIClient({
          clients: opts.clients,
          apiKey: opts.openaiApiKey,
          baseUrl: opts.openaiBaseUrl,
        });
        const response = await client.chat.completions.create({
          model: opts.model,
          max_tokens: opts.maxTokens,
          messages: [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: opts.userPrompt },
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

      clearInterval(ticker);
      ticker = null;
      process.stdout.write(` ${((Date.now() - startMs) / 1000).toFixed(0)}s\n`);

      if (!rawText) {
        throw new Error("LLM 响应中没有文本内容");
      }

      if (opts.debugDir) {
        writeFileSync(
          join(opts.debugDir, `llm-${opts.debugPrefix}-raw-${attempt}.txt`),
          rawText,
          "utf-8"
        );
      }

      if (opts.returnRawText) {
        return rawText;
      }

      const rawJson =
        parsedJson !== undefined
          ? parsedJson
          : opts.expectJson
            ? JSON.parse(rawText)
            : extractJson(rawText);

      if (opts.debugDir) {
        writeFileSync(
          join(opts.debugDir, `llm-${opts.debugPrefix}-parsed-${attempt}.json`),
          JSON.stringify(rawJson, null, 2),
          "utf-8"
        );
      }

      return rawJson;
    } catch (err) {
      if (ticker !== null) {
        clearInterval(ticker);
        ticker = null;
        process.stdout.write("\n");
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`  尝试 ${attempt + 1} 失败: ${lastError.message}`);
    }
  }

  throw new Error(`LLM [${opts.debugPrefix}] 失败: ${lastError?.message}`);
}

function resolveStageConfig(
  stage: "review" | "step1" | "takePass" | "step2",
  options?: AnalyzeModelOptions
): StageModelConfig {
  const defaultProvider = options?.provider ?? DEFAULT_PROVIDER;
  const defaultModel = options?.model ?? DEFAULT_MODEL;
  const modelForProvider = (provider: LLMProvider): string => {
    switch (provider) {
      case "anthropic":
        return DEFAULT_ANTHROPIC_MODEL;
      case "openai":
        return DEFAULT_SEED_MODEL;
      case "cli":
        return DEFAULT_ANTHROPIC_SONNET_MODEL;
      case "gemini":
      default:
        return DEFAULT_GEMINI_MODEL;
    }
  };
  const pickModel = (
    provider: LLMProvider,
    explicitModel: string | undefined
  ): string => {
    if (explicitModel) {
      return explicitModel;
    }
    if (provider === defaultProvider) {
      return defaultModel;
    }
    return modelForProvider(provider);
  };

  switch (stage) {
    case "review":
      {
        const provider = options?.reviewProvider ?? defaultProvider;
        return {
          provider,
          model: pickModel(provider, options?.reviewModel),
        };
      }
    case "step1":
      {
        const provider = options?.step1Provider ?? defaultProvider;
        return {
          provider,
          model: pickModel(provider, options?.step1Model),
        };
      }
    case "takePass":
      {
        const provider = options?.takePassProvider ?? defaultProvider;
        const model = options?.takePassModel
          ?? (provider === "anthropic" || provider === "cli" ? DEFAULT_ANTHROPIC_SONNET_MODEL : pickModel(provider, undefined));
        return { provider, model };
      }
    case "step2":
      {
        const provider = options?.step2Provider ?? defaultProvider;
        return {
          provider,
          model: pickModel(provider, options?.step2Model),
        };
      }
  }
}

async function callTranscriptReview(
  transcriptWords: Word[],
  scriptText: string,
  stage: StageModelConfig,
  clients: ClientPool,
  maxRetries: number,
  debugDir: string,
  credentials?: LLMCredentials
): Promise<TranscriptReview> {
  const transcriptText = transcriptToPlainText(transcriptWords);
  console.log("\n  ── Review: transcript 全文纠错 ──");
  console.log(`  transcript: ${transcriptText.length} 字, docx: ${scriptText.length} 字`);

  const rawJson = await callLLM({
    provider: stage.provider,
    model: stage.model,
    systemPrompt: SYSTEM_PROMPT_TRANSCRIPT_REVIEW,
    userPrompt: buildUserPromptTranscriptReview(transcriptWords, scriptText),
    maxTokens: MAX_TOKENS_REVIEW,
    maxRetries,
    debugDir,
    debugPrefix: "transcript-review",
    clients,
    anthropicApiKey: credentials?.anthropicApiKey,
    openaiApiKey: credentials?.openaiApiKey,
    openaiBaseUrl: credentials?.openaiBaseUrl,
    geminiApiKey: credentials?.geminiApiKey,
    geminiApiBaseUrl: credentials?.geminiApiBaseUrl,
  });

  return normalizeTranscriptReview(rawJson, transcriptWords);
}

async function callStep1(
  words: Word[],
  stage: StageModelConfig,
  clients: ClientPool,
  maxRetries: number,
  debugDir: string,
  credentials?: LLMCredentials
): Promise<any> {
  console.log("\n  ── Step 1: 语义拆解（只切 atom / scene / logic） ──");
  console.log(`  输入: ${words.length} 个词`);

  const rawJson = await callLLM({
    provider: stage.provider,
    model: stage.model,
    systemPrompt: SYSTEM_PROMPT_STEP1,
    userPrompt: buildUserPromptStep1(words),
    maxTokens: MAX_TOKENS_STEP1,
    maxRetries,
    debugDir,
    debugPrefix: "step1",
    clients,
    anthropicApiKey: credentials?.anthropicApiKey,
    openaiApiKey: credentials?.openaiApiKey,
    openaiBaseUrl: credentials?.openaiBaseUrl,
    geminiApiKey: credentials?.geminiApiKey,
    geminiApiBaseUrl: credentials?.geminiApiBaseUrl,
    returnRawText: true,
  });

  const result = normalizeStep1Result(rawJson, words);
  if (!result?.atoms || !Array.isArray(result.atoms)) {
    throw new Error("Step 1 输出格式错误: 缺少 atoms 数组");
  }

  // Step 1 不再负责 discard；进入主链前统一回正为 keep，避免后续链路继续把 Step1 当成最终取舍层。
  for (const atom of result.atoms) {
    atom.status = "keep";
    delete atom.reason;
  }

  const sceneCount = result.atoms.filter((a: any) => a.boundary === "scene").length;
  const logicCount = result.atoms.filter((a: any) => a.boundary === "logic").length;

  console.log(
    `  Step 1 完成: ${result.atoms.length} 原子块, ` +
    `${sceneCount + 1} 场景, ${sceneCount + logicCount + 1} 逻辑块`
  );

  return result;
}

async function callStep2(
  step1Result: any,
  words: Word[],
  stage: StageModelConfig,
  clients: ClientPool,
  maxRetries: number,
  debugDir: string,
  credentials?: LLMCredentials,
  availableAssetSubScenes?: string[]
): Promise<any> {
  console.log("\n  ── Step 2: 结构编排（view / template / items） ──");
  if (availableAssetSubScenes?.length) {
    console.log(`  可用素材场景: ${availableAssetSubScenes.length} 个`);
  }

  const rawText = await callLLM({
    provider: stage.provider,
    model: stage.model,
    systemPrompt: SYSTEM_PROMPT_STEP2,
    userPrompt: buildUserPromptStep2(step1Result, words, availableAssetSubScenes),
    maxTokens: MAX_TOKENS_STEP2,
    maxRetries,
    debugDir,
    debugPrefix: "step2",
    clients,
    anthropicApiKey: credentials?.anthropicApiKey,
    openaiApiKey: credentials?.openaiApiKey,
    openaiBaseUrl: credentials?.openaiBaseUrl,
    geminiApiKey: credentials?.geminiApiKey,
    geminiApiBaseUrl: credentials?.geminiApiBaseUrl,
    geminiThinkingLevel: "low",
    returnRawText: true,
  }) as string;

  const result = parseStep2MarkedText(rawText);
  if (!result?.scenes || !Array.isArray(result.scenes) || result.scenes.length === 0) {
    throw new Error("Step 2 输出格式错误: 缺少 scenes");
  }

  const totalSegments = result.scenes.reduce(
    (sum: number, s: any) => sum + (s.logic_segments?.length ?? 0), 0
  );
  console.log(
    `  Step 2 完成: "${result.title}", ${result.scenes.length} 场景, ${totalSegments} 逻辑段`
  );

  return result;
}

async function callTakePass(
  atoms: Array<{
    id: number;
    text: string;
    time: { s: number; e: number };
    status?: "keep" | "discard";
    boundary?: "scene" | "logic";
    reason?: string;
  }>,
  words: Word[],
  stage: StageModelConfig,
  clients: ClientPool,
  maxRetries: number,
  debugDir: string,
  credentials?: LLMCredentials
): Promise<TakePassResult> {
  console.log("\n  ── Take Pass: 音频选块（最终 keep/discard 取舍） ──");
  console.log(`  输入: ${atoms.length} 个 atoms`);

  const rawText = (await callLLM({
    provider: stage.provider,
    model: stage.model,
    systemPrompt: SYSTEM_PROMPT_TAKE_PASS,
    userPrompt: buildUserPromptTakePass(atoms, words),
    maxTokens: MAX_TOKENS_TAKE_PASS,
    maxRetries,
    debugDir,
    debugPrefix: "take-pass",
    clients,
    anthropicApiKey: credentials?.anthropicApiKey,
    openaiApiKey: credentials?.openaiApiKey,
    openaiBaseUrl: credentials?.openaiBaseUrl,
    geminiApiKey: credentials?.geminiApiKey,
    geminiApiBaseUrl: credentials?.geminiApiBaseUrl,
    returnRawText: true,
  })) as string;

  // Primary: parse marked text format (~[text] / [text]).
  // Fallback: try JSON format for backward compatibility.
  try {
    return parseMarkedTakePass(rawText, atoms);
  } catch (markedError) {
    try {
      const json = extractJson(rawText);
      return normalizeTakePassResult(json);
    } catch {
      throw markedError;
    }
  }
}

export async function analyzeTranscript(
  transcript: Transcript,
  options?: AnalyzeModelOptions & {
    sourceTranscript?: Transcript;
    audioPath?: string;
    forceAlign?: ForceAlignRuntimeOptions;
    apiKey?: string;
    anthropicApiKey?: string;
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    geminiApiKey?: string;
    geminiApiBaseUrl?: string;
    maxRetries?: number;
    outputDir?: string;
    scriptPath?: string;
    skipStep2?: boolean;
    skipReview?: boolean;
    assetIndexPath?: string;
  }
): Promise<Blueprint> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;
  const debugDir = options?.outputDir ?? "";
  const runtimeOutputDir = debugDir || resolve(process.cwd(), ".analyze-runtime");
  let runtimeSourceTranscript = options?.sourceTranscript ?? transcript;
  if (debugDir) {
    mkdirSync(debugDir, { recursive: true });
  }
  const credentials = {
    anthropicApiKey: options?.anthropicApiKey ?? options?.apiKey,
    openaiApiKey: options?.openaiApiKey ?? options?.apiKey,
    openaiBaseUrl: options?.openaiBaseUrl,
    geminiApiKey: options?.geminiApiKey ?? options?.apiKey,
    geminiApiBaseUrl: options?.geminiApiBaseUrl,
  };
  const clients: ClientPool = {};
  const reviewStage = resolveStageConfig("review", options);
  const step1Stage = resolveStageConfig("step1", options);
  const takePassStage = resolveStageConfig("takePass", options);
  const step2Stage = resolveStageConfig("step2", options);

  // 加载素材索引，提取可用子场景列表
  let availableAssetSubScenes: string[] | undefined;
  if (options?.assetIndexPath) {
    try {
      const assetIndex = JSON.parse(readFileSync(options.assetIndexPath, "utf-8"));
      const subSceneSet = new Set<string>();
      for (const asset of assetIndex.assets ?? []) {
        for (const sc of asset.sub_scenes ?? []) {
          subSceneSet.add(sc);
        }
      }
      availableAssetSubScenes = [...subSceneSet].sort();
      console.log(`  素材索引: ${assetIndex.assets?.length ?? 0} 个素材, ${availableAssetSubScenes.length} 个子场景`);
    } catch (e) {
      console.warn(`  [WARN] 无法加载素材索引 ${options.assetIndexPath}: ${e}`);
    }
  }

  console.log(
    `  模型配置: review=${reviewStage.provider}:${reviewStage.model}, ` +
      `step1=${step1Stage.provider}:${step1Stage.model}, ` +
      `take-pass=${takePassStage.provider}:${takePassStage.model}, ` +
      `step2=${step2Stage.provider}:${step2Stage.model}`
  );

  let step1Transcript = transcript;
  let reviewedTokens = buildReviewedTokensFromTranscript(transcript);

  // 通道 1：文本清洗
  if (options?.scriptPath && !options?.skipReview) {
    const scriptText = await extractScriptText(options.scriptPath);
    const transcriptText = transcriptToPlainText(transcript.words);

    if (debugDir) {
      writeFileSync(join(debugDir, "transcript_plain.txt"), transcriptText, "utf-8");
      writeFileSync(join(debugDir, "script_plain.txt"), scriptText, "utf-8");
    }

    try {
      const review = await callTranscriptReview(
        transcript.words,
        scriptText,
        reviewStage,
        clients,
        maxRetries,
        debugDir,
        credentials
      );
      const { reviewedTranscript, reviewedTokens: nextReviewedTokens, report } =
        applyTranscriptReview(transcript, review);
      step1Transcript = reviewedTranscript;
      reviewedTokens = nextReviewedTokens;

      if (report.reviewMode === "anchored_spans") {
        console.log(
          `  Review 完成: ${report.reviewSpans?.length ?? 0} 个 source-anchored spans 生效 ` +
          `(${report.originalText.length} -> ${report.reviewedText.length} 字)`
        );
      } else if (report.reviewMode === "corrected_text") {
        console.log(
          `  Review 完成: 全文纠错生效 ` +
          `(${report.originalText.length} -> ${report.reviewedText.length} 字)`
        );
      } else {
        console.log(
          `  Review 完成: ${report.acceptedEdits.length} 条补丁生效 ` +
          `(replace ${report.summary.replaceCount} / delete ${report.summary.deleteCount} / dedupe ${report.summary.dedupeCount}), ` +
          `${report.rejectedEdits.length} 条被拒绝` +
          (report.usedReview ? "" : "（回退原始 transcript）")
        );
      }

      if (debugDir) {
        writeFileSync(
          join(debugDir, "transcript_review.json"),
          JSON.stringify(report, null, 2),
          "utf-8"
        );
        if (report.reviewSpans && report.reviewSpans.length > 0) {
          writeFileSync(
            join(debugDir, "review_spans.json"),
            JSON.stringify(report.reviewSpans, null, 2),
            "utf-8"
          );
        }
        writeFileSync(
          join(debugDir, "reviewed_tokens.json"),
          JSON.stringify(reviewedTokens, null, 2),
          "utf-8"
        );
        writeFileSync(
          join(debugDir, "reviewed_text.txt"),
          reviewedTokens.text,
          "utf-8"
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  Review 失败，回退原始 transcript: ${message}`);
      reviewedTokens = buildReviewedTokensFromTranscript(transcript);
      if (debugDir) {
        writeFileSync(join(debugDir, "transcript_review_error.txt"), message, "utf-8");
        writeFileSync(
          join(debugDir, "reviewed_tokens.json"),
          JSON.stringify(reviewedTokens, null, 2),
          "utf-8"
        );
        writeFileSync(join(debugDir, "reviewed_text.txt"), reviewedTokens.text, "utf-8");
      }
    }
  }

  // 通道 2：force-align（Review 后的文本 + 原音频 → 精确时间戳）
  const shouldForceAlign =
    Boolean(options?.forceAlign?.enabled) && Boolean(options?.audioPath);

  if (shouldForceAlign && options?.audioPath) {
    mkdirSync(runtimeOutputDir, { recursive: true });
    const reviewedTokensPath = join(runtimeOutputDir, "reviewed_tokens.json");
    writeFileSync(
      reviewedTokensPath,
      JSON.stringify(reviewedTokens, null, 2),
      "utf-8"
    );
    if (debugDir) {
      writeFileSync(join(debugDir, "reviewed_text.txt"), reviewedTokens.text, "utf-8");
    }

    console.log("\n  鈹€鈹€ Force Align: Qwen3-ForcedAligner 鈹€鈹€");
    const forceAlignResult = runQwenForcedAlign({
      audioPath: options.audioPath,
      transcriptPath: reviewedTokensPath,
      outputDir: runtimeOutputDir,
      pythonExecutable: options?.forceAlign?.pythonExecutable,
      model: options?.forceAlign?.model,
      language: options?.forceAlign?.language,
      deviceMap: options?.forceAlign?.deviceMap,
      dtype: options?.forceAlign?.dtype,
      maxChunkSeconds: options?.forceAlign?.maxChunkSeconds,
      minChunkSeconds: options?.forceAlign?.minChunkSeconds,
      gapThresholdSeconds: options?.forceAlign?.gapThresholdSeconds,
      paddingSeconds: options?.forceAlign?.paddingSeconds,
      batchSize: options?.forceAlign?.batchSize,
    });

    runtimeSourceTranscript = alignedTokensToTranscript(
      forceAlignResult.alignedTokenTranscript
    );
    step1Transcript = runtimeSourceTranscript;

    console.log(`  aligned tokens: ${forceAlignResult.alignedTokenTranscriptPath}`);
    console.log(
      `  chunks=${forceAlignResult.manifest.summary.chunkCount}, ` +
        `tokens=${forceAlignResult.manifest.summary.alignedTokenCount}, ` +
        `fallback words=${forceAlignResult.manifest.summary.fallbackWordCount}`
    );
  }

  const step1Hints = await buildStep1Hints(step1Transcript.words);

  if (debugDir && step1Hints) {
    writeFileSync(
      join(debugDir, "step1_hints.json"),
      JSON.stringify(step1Hints, null, 2),
      "utf-8"
    );
  }

  const step1Result = await callStep1(
    step1Transcript.words,
    step1Stage,
    clients,
    maxRetries,
    debugDir,
    credentials
  );

  if (debugDir) {
    writeFileSync(
      join(debugDir, "step1_result.json"),
      JSON.stringify(step1Result, null, 2),
      "utf-8"
    );
  }

  const step1Cleaned =
    typeof structuredClone === "function"
      ? structuredClone(step1Result)
      : JSON.parse(JSON.stringify(step1Result));

  if (debugDir) {
    writeFileSync(
      join(debugDir, "step1_cleaned.json"),
      JSON.stringify(step1Cleaned, null, 2),
      "utf-8"
    );
  }

  // 通道 3：音频选块
  const takePass = await callTakePass(
    step1Cleaned.atoms,
    step1Transcript.words,
    takePassStage,
    clients,
    maxRetries,
    debugDir,
    credentials
  );
  const step1Taken =
    typeof structuredClone === "function"
      ? structuredClone(step1Cleaned)
      : JSON.parse(JSON.stringify(step1Cleaned));
  const takeStats = applyTakePass(step1Taken, toLegacyTakePassResult(takePass));
  console.log(
    `  Take Pass 完成: ${takeStats.takeCount} 个 take, ` +
      `${takeStats.keptAtomCount} keep, ${takeStats.discardedAtomCount} discard`
  );

  if (debugDir) {
    writeFileSync(
      join(debugDir, "take_pass_result.json"),
      JSON.stringify(takePass, null, 2),
      "utf-8"
    );
    writeFileSync(
      join(debugDir, "step1_taken.json"),
      JSON.stringify(step1Taken, null, 2),
      "utf-8"
    );
  }

  let merged: Blueprint;
  if (options?.skipStep2) {
    console.log("\n  ── 跳过 Step 2：生成医生字幕版最小 Blueprint ──");
    const subtitleOnlyBlueprint = buildSubtitleOnlyBlueprint(
      step1Taken,
      "医生字幕版"
    );
    merged = subtitleOnlyBlueprint as Blueprint;
    if (debugDir) {
      writeFileSync(
        join(debugDir, "step2_result.json"),
        JSON.stringify(
          {
            skipped: true,
            mode: "subtitle_only",
          },
          null,
          2
        ),
        "utf-8"
      );
    }
  } else {
    // 通道 4：结构编排
    const step2Result = await callStep2(
      step1Taken,
      step1Transcript.words,
      step2Stage,
      clients,
      maxRetries,
      debugDir,
      credentials,
      availableAssetSubScenes
    );

    if (debugDir) {
      writeFileSync(
        join(debugDir, "step2_result.json"),
        JSON.stringify(step2Result, null, 2),
        "utf-8"
      );
    }

    console.log("\n  ── 合并 Step 1 + Step 2 ──");
    merged = mergeStep2WithAtoms(step1Taken, step2Result) as Blueprint;
  }

  const derived = deriveBlueprintAtomsFromTranscript(
    merged,
    runtimeSourceTranscript
  );

  if (debugDir) {
    writeFileSync(
      join(debugDir, "blueprint_merged.json"),
      JSON.stringify(merged, null, 2),
      "utf-8"
    );
    writeFileSync(
      join(debugDir, "blueprint_derived.json"),
      JSON.stringify(derived, null, 2),
      "utf-8"
    );
  }

  const repaired = autoRepairBlueprint(derived);

  const spokenDuration = runtimeSourceTranscript.words.reduce(
    (sum, w) => sum + (w.end - w.start),
    0
  );

  const validation = validateBlueprint(
    repaired,
    runtimeSourceTranscript.duration,
    spokenDuration
  );

  if (validation.zodErrors) {
    throw new Error(`Blueprint Zod 校验失败:\n  ${validation.zodErrors.join("\n  ")}`);
  }

  if (validation.logicErrors && validation.logicErrors.length > 0) {
    throw new Error(`Blueprint 逻辑校验失败:\n  ${validation.logicErrors.join("\n  ")}`);
  }

  if (validation.warnings && validation.warnings.length > 0) {
    console.log(`\n  警告 (${validation.warnings.length}):`);
    for (const w of validation.warnings) {
      console.log(`    ? ${w}`);
    }
  }

  if (validation.stats) {
    console.log(
      `\n  统计: ${validation.stats.sceneCount} 场景, ` +
      `${validation.stats.segmentCount} 逻辑段, ` +
      `${validation.stats.keepAtomCount} keep + ${validation.stats.discardAtomCount} discard, ` +
      `覆盖 ${validation.stats.coveragePercent.toFixed(1)}%`
    );
  }

  const bp = validation.data!;

  // 通道 5：渲染前补齐（字幕/媒体执行信息）
  deriveBlueprintAtomsFromTranscript(bp, runtimeSourceTranscript);

  const step2Diagnostics = buildStep2Diagnostics(bp);
  if (debugDir) {
    writeFileSync(
      join(debugDir, "step2_diagnostics.json"),
      JSON.stringify(step2Diagnostics, null, 2),
      "utf-8"
    );
  }

  return bp;
}

async function main() {
  const args = process.argv.slice(2);
  let transcriptPath = "";
  let sourceTranscriptPath = "";
  let outputPath = "";
  let model = DEFAULT_MODEL;
  let scriptPath = "";
  let audioPath = "";
  let transcribeQwen = false;
  let transcribePython = "";
  let transcribeModel = "";
  let transcribeAlignerModel = "";
  let transcribeLanguage = "Chinese";
  let transcribeDeviceMap = "cuda:0";
  let transcribeDType: QwenTranscribeDType | undefined;
  let transcribeMaxInferenceBatchSize: number | undefined;
  let transcribeMaxNewTokens: number | undefined;
  let transcribeContext = "";
  let globalProvider: LLMProvider | undefined;
  let step1Provider: LLMProvider | undefined;
  let step1Model = "";
  let takePassProvider: LLMProvider | undefined;
  let takePassModel = "";
  let skipStep2 = false;
  let skipReview = false;
  let openaiBaseUrl = "";
  let forceAlignQwen = false;
  let forceAlignPython = "";
  let forceAlignModel = "";
  let forceAlignLanguage = "Chinese";
  let forceAlignDeviceMap = "cuda:0";
  let forceAlignDType: QwenForcedAlignDType | undefined;
  let forceAlignMaxChunkSeconds: number | undefined;
  let forceAlignMinChunkSeconds: number | undefined;
  let forceAlignGapThresholdSeconds: number | undefined;
  let forceAlignPaddingSeconds: number | undefined;
  let forceAlignBatchSize: number | undefined;
  let assetIndexPath = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--transcript":
      case "-t":
        transcriptPath = args[++i];
        break;
      case "--output":
      case "-o":
        outputPath = args[++i];
        break;
      case "--source-transcript":
        sourceTranscriptPath = args[++i];
        break;
      case "--audio":
      case "--source-audio":
        audioPath = args[++i];
        break;
      case "--transcribe-qwen":
        transcribeQwen = true;
        break;
      case "--transcribe-python":
        transcribePython = args[++i];
        break;
      case "--transcribe-model":
        transcribeModel = args[++i];
        break;
      case "--transcribe-aligner-model":
        transcribeAlignerModel = args[++i];
        break;
      case "--transcribe-language":
        transcribeLanguage = args[++i];
        break;
      case "--transcribe-device-map":
        transcribeDeviceMap = args[++i];
        break;
      case "--transcribe-dtype":
        transcribeDType = args[++i] as QwenTranscribeDType;
        break;
      case "--transcribe-max-inference-batch-size":
        transcribeMaxInferenceBatchSize = Number(args[++i]);
        break;
      case "--transcribe-max-new-tokens":
        transcribeMaxNewTokens = Number(args[++i]);
        break;
      case "--transcribe-context":
        transcribeContext = args[++i];
        break;
      case "--model":
      case "-m":
        model = args[++i];
        break;
      case "--provider":
        globalProvider = args[++i] as LLMProvider;
        break;
      case "--step1-provider":
        step1Provider = args[++i] as LLMProvider;
        break;
      case "--step1-model":
        step1Model = args[++i];
        break;
      case "--take-pass-provider":
        takePassProvider = args[++i] as LLMProvider;
        break;
      case "--take-pass-model":
        takePassModel = args[++i];
        break;
      case "--skip-step2":
        skipStep2 = true;
        break;
      case "--skip-review":
        skipReview = true;
        break;
      case "--asset-index":
        assetIndexPath = args[++i];
        break;
      case "--openai-base-url":
        openaiBaseUrl = args[++i];
        break;
      case "--script":
      case "-s":
        scriptPath = args[++i];
        break;
      case "--force-align-qwen":
        forceAlignQwen = true;
        break;
      case "--force-align-python":
        forceAlignPython = args[++i];
        break;
      case "--force-align-model":
        forceAlignModel = args[++i];
        break;
      case "--force-align-language":
        forceAlignLanguage = args[++i];
        break;
      case "--force-align-device-map":
        forceAlignDeviceMap = args[++i];
        break;
      case "--force-align-dtype":
        forceAlignDType = args[++i] as QwenForcedAlignDType;
        break;
      case "--force-align-max-chunk-seconds":
        forceAlignMaxChunkSeconds = Number(args[++i]);
        break;
      case "--force-align-min-chunk-seconds":
        forceAlignMinChunkSeconds = Number(args[++i]);
        break;
      case "--force-align-gap-threshold-seconds":
        forceAlignGapThresholdSeconds = Number(args[++i]);
        break;
      case "--force-align-padding-seconds":
        forceAlignPaddingSeconds = Number(args[++i]);
        break;
      case "--force-align-batch-size":
        forceAlignBatchSize = Number(args[++i]);
        break;
      default:
        if (!transcriptPath) transcriptPath = args[i];
    }
  }

  if (!transcriptPath && !transcribeQwen) {
    console.error(
      "用法: npx tsx src/analyze/index.ts --transcript transcript.json [-o blueprint.json] [--script script.docx] [--source-transcript transcript_aligned_tokens.json] [--force-align-qwen --audio doctor.mp4]\n" +
        "   或: npx tsx src/analyze/index.ts --audio doctor.mp4 --transcribe-qwen [-o blueprint.json]"
    );
    process.exit(1);
  }

  const resolvedAudioPath = audioPath ? resolve(audioPath) : "";
  const defaultBasePath = transcriptPath ? resolve(transcriptPath) : resolvedAudioPath;
  if (!defaultBasePath) {
    throw new Error("必须至少提供 --transcript 或 --audio。");
  }

  if (transcriptPath) {
    transcriptPath = resolve(transcriptPath);
  }
  outputPath = outputPath ? resolve(outputPath) : join(dirname(defaultBasePath), "blueprint.json");
  const outputDir = dirname(outputPath);

  if (transcribeQwen) {
    if (!resolvedAudioPath) {
      throw new Error("启用 --transcribe-qwen 时必须同时提供 --audio。");
    }

    // Skip ASR if transcript_raw.json already exists (e.g. from Phase 1)
    const existingRawTranscript = resolve(outputDir, "transcript_raw.json");
    if (existsSync(existingRawTranscript)) {
      console.log("\n── Transcribe: skipped (transcript_raw.json exists) ──");
      transcriptPath = existingRawTranscript;
      transcribeQwen = false;
    }
  }

  if (transcribeQwen) {
    console.log("\n── Transcribe: Qwen3-ASR-1.7B ──");
    const transcribeResult = runQwenTranscribe({
      audioPath: resolvedAudioPath,
      outputDir,
      pythonExecutable: transcribePython || undefined,
      model: transcribeModel || undefined,
      alignerModel: transcribeAlignerModel || undefined,
      language: transcribeLanguage || undefined,
      deviceMap: transcribeDeviceMap || undefined,
      dtype: transcribeDType,
      maxInferenceBatchSize: transcribeMaxInferenceBatchSize,
      maxNewTokens: transcribeMaxNewTokens,
      context: transcribeContext || undefined,
    });
    transcriptPath = transcribeResult.rawTranscriptPath;
    sourceTranscriptPath = "";
    console.log(`  transcript: ${transcribeResult.rawTranscriptPath}`);
    console.log(
      `  duration=${transcribeResult.manifest.summary.duration}s, ` +
        `words=${transcribeResult.manifest.summary.wordCount}, ` +
        `detected=${transcribeResult.manifest.languageDetected || "unknown"}`
    );

  }

  if (forceAlignQwen && !resolvedAudioPath) {
    throw new Error("`--force-align-qwen` requires `--audio`.");
  }

  if (sourceTranscriptPath !== "") {
    sourceTranscriptPath = resolve(sourceTranscriptPath);
  }

  const transcript = loadTranscriptDocument(transcriptPath);
  const sourceTranscript = sourceTranscriptPath
    ? loadTranscriptDocument(sourceTranscriptPath)
    : undefined;
  console.log(`转录: ${transcript.words.length} 词, ${transcript.duration}s`);
  if (sourceTranscript) {
    console.log(`对齐源: ${sourceTranscript.words.length} 个底层对齐单元`);
  }
  if (scriptPath) {
    console.log(`参考文案: ${resolve(scriptPath)}`);
  }

  const blueprint = await analyzeTranscript(transcript, {
    model,
    provider: globalProvider,
    step1Provider: step1Provider ?? globalProvider,
    step1Model: step1Model || undefined,
    takePassProvider: takePassProvider ?? globalProvider,
    takePassModel: takePassModel || undefined,
    openaiBaseUrl: openaiBaseUrl || undefined,
    outputDir,
    scriptPath: scriptPath ? resolve(scriptPath) : undefined,
    skipStep2,
    skipReview,
    assetIndexPath: assetIndexPath ? resolve(assetIndexPath) : undefined,
    sourceTranscript,
    audioPath: resolvedAudioPath || undefined,
    forceAlign: {
      enabled: forceAlignQwen,
      pythonExecutable: forceAlignPython || undefined,
      model: forceAlignModel || undefined,
      language: forceAlignLanguage || undefined,
      deviceMap: forceAlignDeviceMap || undefined,
      dtype: forceAlignDType,
      maxChunkSeconds: forceAlignMaxChunkSeconds,
      minChunkSeconds: forceAlignMinChunkSeconds,
      gapThresholdSeconds: forceAlignGapThresholdSeconds,
      paddingSeconds: forceAlignPaddingSeconds,
      batchSize: forceAlignBatchSize,
    },
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(blueprint, null, 2), "utf-8");
  console.log(`\n已保存: ${outputPath}`);
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("analyze/index.ts") ||
    process.argv[1].endsWith("analyze\\index.ts"));
if (isMainModule) {
  main().catch((err) => {
    console.error("错误:", err.message);
    process.exit(1);
  });
}

