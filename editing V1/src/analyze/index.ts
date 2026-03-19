/**
 * 分析主链路（当前架构版本）
 *
 * 这里负责把几条独立通道串起来，而不是让它们重新混线。
 *
 * 通道 1：review / 文本清洗
 * - 输入：原始 transcript + 可选 docx
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
 * - 输入：blueprint + transcript
 * - 输出：字幕对齐、media_range 等执行信息
 *
 * 最终流程：
 * transcript.json -> review -> Step1 -> take-pass -> Step2 -> merge ->
 * post-process -> blueprint.json
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve, join } from "path";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  DEFAULT_SEED_MODEL,
} from "../config/models.js";
import {
  SYSTEM_PROMPT_STEP1,
  buildUserPromptStep1,
  SYSTEM_PROMPT_STEP2,
  buildUserPromptStep2,
  mergeStep2WithAtoms,
} from "./semantic/index.js";
import {
  extractJson,
  autoRepairBlueprint,
  validateBlueprint,
} from "./schema.js";
import { extractScriptText } from "./step1-cleaning.js";
import {
  buildStep1Hints,
  type Step1Hints,
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
  applyTakePass,
  type TakePassResult,
} from "./audio/index.js";
import type {
  Transcript,
  Blueprint,
  Word,
} from "../schemas/blueprint.js";
import { postProcessBlueprint } from "../align/post-process.js";
import { buildStep2Diagnostics } from "./step2-diagnostics.js";

const DEFAULT_MODEL = DEFAULT_ANTHROPIC_MODEL;
const MAX_RETRIES = 2;
const MAX_TOKENS_REVIEW = 8192;
const MAX_TOKENS_STEP1 = 16384;
const MAX_TOKENS_TAKE_PASS = 8192;
const MAX_TOKENS_STEP2 = 8192;

export type LLMProvider = "anthropic" | "openai";

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
    process.env.ARK_API_KEY ??
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "缺少 OpenAI-compatible API Key。请设置 ARK_API_KEY 或 OPENAI_API_KEY。"
    );
  }

  const baseURL =
    options.baseUrl ??
    process.env.ARK_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    DEFAULT_OPENAI_COMPATIBLE_BASE_URL;

  options.clients.openai = new OpenAI({
    apiKey,
    baseURL,
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

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 ANTHROPIC_API_KEY。");
  }

  options.clients.anthropic = new Anthropic({ apiKey });
  return options.clients.anthropic;
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

async function callLLM(opts: CallLLMOptions): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`  重试 ${attempt}/${opts.maxRetries} ...`);
    }

    try {
      console.log(
        `  调用 ${opts.provider}:${opts.model} [${opts.debugPrefix}] ...`
      );

      let rawText = "";

      if (opts.provider === "anthropic") {
        const client = getAnthropicClient({
          clients: opts.clients,
          apiKey: opts.anthropicApiKey,
        });
        const stream = client.messages
          .stream({
            model: opts.model,
            max_tokens: opts.maxTokens,
            system: opts.systemPrompt,
            messages: [{ role: "user", content: opts.userPrompt }],
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
        const client = getOpenAIClient({
          clients: opts.clients,
          apiKey: opts.openaiApiKey,
          baseUrl: opts.openaiBaseUrl,
        });
        const response = await client.chat.completions.create({
          model: opts.model,
          temperature: 0,
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

      const rawJson = extractJson(rawText);

      if (opts.debugDir) {
        writeFileSync(
          join(opts.debugDir, `llm-${opts.debugPrefix}-parsed-${attempt}.json`),
          JSON.stringify(rawJson, null, 2),
          "utf-8"
        );
      }

      return rawJson;
    } catch (err) {
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
  const defaultProvider = options?.provider ?? "anthropic";
  const defaultModel = options?.model ?? DEFAULT_MODEL;
  const pickModel = (
    provider: LLMProvider,
    explicitModel: string | undefined
  ): string => {
    if (explicitModel) {
      return explicitModel;
    }
    return provider === "openai" ? DEFAULT_SEED_MODEL : defaultModel;
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
        return {
          provider,
          model: pickModel(provider, options?.takePassModel),
        };
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
  credentials?: {
    anthropicApiKey?: string;
    openaiApiKey?: string;
    openaiBaseUrl?: string;
  }
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
  });

  return normalizeTranscriptReview(rawJson, transcriptWords);
}

async function callStep1(
  words: Word[],
  step1Hints: Step1Hints | null,
  stage: StageModelConfig,
  clients: ClientPool,
  maxRetries: number,
  debugDir: string,
  credentials?: {
    anthropicApiKey?: string;
    openaiApiKey?: string;
    openaiBaseUrl?: string;
  }
): Promise<any> {
  console.log("\n  ── Step 1: 语义拆解（只切 atom / scene / logic） ──");
  console.log(`  输入: ${words.length} 个词`);
  if (step1Hints) {
    console.log(
      `  Step1 提示: ${step1Hints.summary.candidateCorrections} 个纠错候选, ` +
      `${step1Hints.summary.repairCues} 个改口线索, ` +
      `${step1Hints.summary.ambiguousSpans} 个歧义片段`
    );
  }

  const rawJson = await callLLM({
    provider: stage.provider,
    model: stage.model,
    systemPrompt: SYSTEM_PROMPT_STEP1,
    userPrompt: buildUserPromptStep1(words, step1Hints),
    maxTokens: MAX_TOKENS_STEP1,
    maxRetries,
    debugDir,
    debugPrefix: "step1",
    clients,
    anthropicApiKey: credentials?.anthropicApiKey,
    openaiApiKey: credentials?.openaiApiKey,
    openaiBaseUrl: credentials?.openaiBaseUrl,
  });

  const result = rawJson as any;
  if (!result?.atoms || !Array.isArray(result.atoms)) {
    throw new Error("Step 1 输出格式错误: 缺少 atoms 数组");
  }

  // Step 1 不再负责 discard；进入主链前统一回正为 keep，避免后续链路继续把 Step1 当成最终取舍层。
  for (const atom of result.atoms) {
    atom.status = "keep";
    delete atom.reason;
  }

  const keepCount = result.atoms.filter((a: any) => a.status === "keep").length;
  const discardCount = result.atoms.filter((a: any) => a.status === "discard").length;
  const sceneCount = result.atoms.filter((a: any) => a.boundary === "scene").length;
  const logicCount = result.atoms.filter((a: any) => a.boundary === "logic").length;

  console.log(
    `  Step 1 完成: ${result.atoms.length} 原子块 (${keepCount} keep, ${discardCount} discard), ` +
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
  credentials?: {
    anthropicApiKey?: string;
    openaiApiKey?: string;
    openaiBaseUrl?: string;
  }
): Promise<any> {
  console.log("\n  ── Step 2: 结构编排（view / template / items） ──");

  const rawJson = await callLLM({
    provider: stage.provider,
    model: stage.model,
    systemPrompt: SYSTEM_PROMPT_STEP2,
    userPrompt: buildUserPromptStep2(step1Result, words),
    maxTokens: MAX_TOKENS_STEP2,
    maxRetries,
    debugDir,
    debugPrefix: "step2",
    clients,
    anthropicApiKey: credentials?.anthropicApiKey,
    openaiApiKey: credentials?.openaiApiKey,
    openaiBaseUrl: credentials?.openaiBaseUrl,
  });

  const result = rawJson as any;
  if (!result?.scenes || !Array.isArray(result.scenes)) {
    throw new Error("Step 2 输出格式错误: 缺少 scenes 数组");
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
  credentials?: {
    anthropicApiKey?: string;
    openaiApiKey?: string;
    openaiBaseUrl?: string;
  }
): Promise<TakePassResult> {
  console.log("\n  ── Take Pass: 音频选块（最终 keep/discard 取舍） ──");
  console.log(`  输入: ${atoms.length} 个 atoms`);

  const rawJson = await callLLM({
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
  });

  return normalizeTakePassResult(rawJson);
}

export async function analyzeTranscript(
  transcript: Transcript,
  options?: AnalyzeModelOptions & {
    apiKey?: string;
    anthropicApiKey?: string;
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    maxRetries?: number;
    outputDir?: string;
    scriptPath?: string;
  }
): Promise<Blueprint> {
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;
  const debugDir = options?.outputDir ?? "";
  if (debugDir) {
    mkdirSync(debugDir, { recursive: true });
  }
  const credentials = {
    anthropicApiKey: options?.anthropicApiKey ?? options?.apiKey,
    openaiApiKey: options?.openaiApiKey,
    openaiBaseUrl: options?.openaiBaseUrl,
  };
  const clients: ClientPool = {};
  const reviewStage = resolveStageConfig("review", options);
  const step1Stage = resolveStageConfig("step1", options);
  const takePassStage = resolveStageConfig("takePass", options);
  const step2Stage = resolveStageConfig("step2", options);

  console.log(
    `  模型配置: review=${reviewStage.provider}:${reviewStage.model}, ` +
      `step1=${step1Stage.provider}:${step1Stage.model}, ` +
      `take-pass=${takePassStage.provider}:${takePassStage.model}, ` +
      `step2=${step2Stage.provider}:${step2Stage.model}`
  );

  let step1Transcript = transcript;

  // 通道 1：文本清洗
  if (options?.scriptPath) {
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
      const { reviewedTranscript, report } = applyTranscriptReview(transcript, review);
      step1Transcript = reviewedTranscript;

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
          join(debugDir, "reviewed_transcript.json"),
          JSON.stringify(reviewedTranscript, null, 2),
          "utf-8"
        );
        writeFileSync(
          join(debugDir, "reviewed_transcript_map.json"),
          JSON.stringify(reviewedTranscript, null, 2),
          "utf-8"
        );
        writeFileSync(
          join(debugDir, "reviewed_transcript.txt"),
          transcriptToPlainText(reviewedTranscript.words),
          "utf-8"
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  Review 失败，回退原始 transcript: ${message}`);
      if (debugDir) {
        writeFileSync(join(debugDir, "transcript_review_error.txt"), message, "utf-8");
      }
    }
  }

  // 通道 2：语义结构
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
    step1Hints,
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
  const takeStats = applyTakePass(step1Taken, takePass);
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

  // 通道 4：结构编排
  const step2Result = await callStep2(
    step1Taken,
    step1Transcript.words,
    step2Stage,
    clients,
    maxRetries,
    debugDir,
    credentials
  );

  if (debugDir) {
    writeFileSync(
      join(debugDir, "step2_result.json"),
      JSON.stringify(step2Result, null, 2),
      "utf-8"
    );
  }

  console.log("\n  ── 合并 Step 1 + Step 2 ──");
  const merged = mergeStep2WithAtoms(step1Taken, step2Result);

  if (debugDir) {
    writeFileSync(
      join(debugDir, "blueprint_merged.json"),
      JSON.stringify(merged, null, 2),
      "utf-8"
    );
  }

  const repaired = autoRepairBlueprint(merged);

  const spokenDuration = transcript.words.reduce(
    (sum, w) => sum + (w.end - w.start),
    0
  );

  const validation = validateBlueprint(repaired, transcript.duration, spokenDuration);

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
  postProcessBlueprint(
    bp,
    transcript,
    step1Transcript,
    debugDir ? { debugPath: join(debugDir, "atom_alignment_debug.json") } : undefined
  );

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
  let outputPath = "";
  let model = DEFAULT_MODEL;
  let scriptPath = "";
  let step1Provider: LLMProvider | undefined;
  let step1Model = "";
  let takePassProvider: LLMProvider | undefined;
  let takePassModel = "";
  let openaiBaseUrl = "";

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
      case "--model":
      case "-m":
        model = args[++i];
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
      case "--openai-base-url":
        openaiBaseUrl = args[++i];
        break;
      case "--script":
      case "-s":
        scriptPath = args[++i];
        break;
      default:
        if (!transcriptPath) transcriptPath = args[i];
    }
  }

  if (!transcriptPath) {
    console.error("用法: npx tsx src/analyze/index.ts --transcript transcript.json [-o blueprint.json] [--script script.docx]");
    process.exit(1);
  }

  transcriptPath = resolve(transcriptPath);
  outputPath = outputPath ? resolve(outputPath) : join(dirname(transcriptPath), "blueprint.json");

  const transcript: Transcript = JSON.parse(readFileSync(transcriptPath, "utf-8"));
  console.log(`转录: ${transcript.words.length} 词, ${transcript.duration}s`);
  if (scriptPath) {
    console.log(`参考文案: ${resolve(scriptPath)}`);
  }

  const blueprint = await analyzeTranscript(transcript, {
    model,
    step1Provider,
    step1Model: step1Model || undefined,
    takePassProvider,
    takePassModel: takePassModel || undefined,
    openaiBaseUrl: openaiBaseUrl || undefined,
    outputDir: dirname(outputPath),
    scriptPath: scriptPath ? resolve(scriptPath) : undefined,
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






