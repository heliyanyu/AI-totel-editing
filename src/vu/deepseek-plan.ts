import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import OpenAI from "openai";

import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_VU_PLANNER_MODEL,
} from "../config/models";
import { baseFamilyPlannerRules, jobInput, outputShape } from "./prompts/family-planner-base";
import { buildDslPlannerPrompt } from "./prompts/dsl-planner";
import { familyPrompt } from "./prompts/families";
import { VUPlanSchema, type VURenderJob } from "./schema";

interface CliArgs {
  input: string;
  output: string;
  vu?: string;
  limit?: number;
  dryRun: boolean;
  model: string;
  baseUrl: string;
  useDsl: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    input: "local_artifacts/vu_pipeline/mianyili_03.vu_render_jobs.json",
    output: "local_artifacts/vu_pipeline/mianyili_03.vu_plans.deepseek_v1.json",
    dryRun: false,
    model: process.env.DEEPSEEK_VU_PLANNER_MODEL ?? DEFAULT_DEEPSEEK_VU_PLANNER_MODEL,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? DEFAULT_DEEPSEEK_BASE_URL,
    useDsl: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--vu") args.vu = argv[++i];
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--base-url") args.baseUrl = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--legacy-prompt") args.useDsl = false;
    else if (arg === "--dsl") args.useDsl = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(repairRawNewlinesInJsonStrings(trimmed));
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(repairRawNewlinesInJsonStrings(fenced[1].trim()));
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(repairRawNewlinesInJsonStrings(trimmed.slice(first, last + 1)));
  }
  throw new Error("No JSON object found in response");
}

function repairRawNewlinesInJsonStrings(text: string): string {
  let repaired = "";
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      repaired += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      repaired += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      repaired += char;
      inString = !inString;
      continue;
    }
    if (inString && char === "\n") {
      repaired += "\\n";
      continue;
    }
    if (inString && char === "\r") {
      continue;
    }
    repaired += char;
  }
  return repaired;
}

function normalizePlanShape(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const plan = raw as Record<string, unknown>;
  const elements = Array.isArray(plan.elements) ? plan.elements : [];
  plan.elements = elements.map((item) => {
    if (!item || typeof item !== "object") return item;
    const next = { ...(item as Record<string, unknown>) };
    if (next.asset_slot === null || next.asset_slot === "") {
      delete next.asset_slot;
    }
    if (next.text === null || next.text === "") {
      delete next.text;
    }
    if (next.role === "data_point" || next.role === "number") {
      next.role = "data";
    }
    if (next.role === "text") {
      const id = String(next.id ?? "");
      const text = String(next.text ?? "");
      if (/[+％%]|\d/.test(text) || id.includes("number") || id.includes("data")) {
        next.role = "data";
      } else if (id.includes("problem") || id.includes("slot") || id.includes("board")) {
        next.role = "structure";
      } else {
        next.role = "claim";
      }
    }
    if (next.role === "subject_icon") {
      next.role = "subject";
    }
    if (next.role === "background") {
      next.role = "annotation";
    }
    if (
      next.role === "label" ||
      next.role === "note" ||
      next.role === "badge" ||
      next.role === "decorative" ||
      next.role === "decoration"
    ) {
      next.role = "annotation";
    }
    if (next.priority === "important") {
      next.priority = "high";
    }
    if (next.priority === "required" || next.priority === "essential") {
      next.priority = "critical";
    }
    if (next.priority === "must_have" || next.priority === "must-have" || next.priority === "must") {
      next.priority = "critical";
    }
    if (next.priority === "normal") {
      next.priority = "medium";
    }
    if (
      next.priority === "supporting" ||
      next.priority === "secondary" ||
      next.priority === "optional" ||
      next.priority === "minor"
    ) {
      next.priority = "low";
    }
    if (next.enter_anim === "scale" || next.enter_anim === "zoom") {
      next.enter_anim = "pop";
    }
    if (
      next.enter_anim === "scale_up" ||
      next.enter_anim === "zoom_in" ||
      next.enter_anim === "expand" ||
      next.enter_anim === "pop_sequential"
    ) {
      next.enter_anim = "pop";
    }
    if (
      next.enter_anim === "fade_in" ||
      next.enter_anim === "fade-in" ||
      next.enter_anim === "fadeIn"
    ) {
      next.enter_anim = "fade";
    }
    if (
      next.enter_anim === "slide_up" ||
      next.enter_anim === "slide_in" ||
      next.enter_anim === "slide_in_left" ||
      next.enter_anim === "slide_in_right" ||
      next.enter_anim === "slide_in_up" ||
      next.enter_anim === "slide_in_down" ||
      next.enter_anim === "slide_left" ||
      next.enter_anim === "slide_right" ||
      next.enter_anim === "slide_down" ||
      next.enter_anim === "slide-in" ||
      next.enter_anim === "slideIn"
    ) {
      next.enter_anim = "slide";
    }
    if (next.enter_anim === "stack") {
      next.enter_anim = "slide";
    }
    if (next.enter_anim === "none" || next.enter_anim === "") {
      delete next.enter_anim;
    }
    if (next.enter_anim === "path") {
      next.enter_anim = "draw";
    }
    if (typeof next.enter_anim === "string") {
      const compactAnim = next.enter_anim.replace(/[-_\s]/g, "").toLowerCase();
      if (compactAnim === "none") {
        delete next.enter_anim;
      } else if (compactAnim.includes("slide")) {
        next.enter_anim = "slide";
      } else if (compactAnim.includes("stack") || compactAnim.includes("reveal")) {
        next.enter_anim = "slide";
      } else if (compactAnim.includes("fade") || compactAnim.includes("typewriter")) {
        next.enter_anim = "fade";
      } else if (
        compactAnim.includes("pop") ||
        compactAnim.includes("zoom") ||
        compactAnim.includes("scale") ||
        compactAnim.includes("expand")
      ) {
        next.enter_anim = "pop";
      } else if (compactAnim.includes("count")) {
        next.enter_anim = "count_up";
      } else if (compactAnim.includes("magic")) {
        next.enter_anim = "magic_move";
      } else if (compactAnim.includes("draw") || compactAnim.includes("path")) {
        next.enter_anim = "draw";
      }
    }
    return next;
  });
  return plan;
}

function buildLegacyPrompt(job: VURenderJob): string {
  return [
    baseFamilyPlannerRules(),
    "",
    "当前 family 的 demo-derived pattern：",
    familyPrompt(job.presentation_family),
    "",
    "输出 JSON shape：",
    JSON.stringify(outputShape(job), null, 2),
    "",
    "输入 VU：",
    JSON.stringify(jobInput(job), null, 2),
  ].join("\n");
}

function buildPrompt(job: VURenderJob, useDsl: boolean): string {
  return useDsl ? buildDslPlannerPrompt(job) : buildLegacyPrompt(job);
}

async function callDeepSeek(client: OpenAI, model: string, job: VURenderJob, useDsl: boolean) {
  let lastContent = "";
  let lastDiagnostics: unknown[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const retryNote =
      attempt === 1
        ? ""
        : [
            "",
            "上一次输出没有通过 JSON/schema 校验。",
            `错误摘要：${JSON.stringify(lastDiagnostics).slice(0, 1200)}`,
            "请重新输出一个完整、可 JSON.parse 的 JSON object，只输出 JSON。",
          ].join("\n");
    const response = await client.chat.completions.create({
      model,
      temperature: attempt === 1 ? 0.2 : 0,
      max_tokens: Number(process.env.DEEPSEEK_VU_PLAN_MAX_TOKENS ?? 16000),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你输出严格 JSON。你是规划器，不是代码生成器。不要输出推理过程。",
        },
        { role: "user", content: `${buildPrompt(job, useDsl)}${retryNote}` },
      ],
    });
    const content = response.choices[0]?.message?.content ?? "";
    lastContent = content;
    try {
      const rawPlan = extractJson(content);
      const normalizedPlan = normalizePlanShape(rawPlan);
      const validation = VUPlanSchema.safeParse(normalizedPlan);
      if (validation.success) {
        return {
          vu_id: job.vu_id,
          ok: true,
          plan: validation.data,
          diagnostics: [],
        };
      }
      lastDiagnostics = validation.error.issues;
    } catch (error) {
      lastDiagnostics = [{ message: error instanceof Error ? error.message : String(error) }];
    }
  }
  return {
    vu_id: job.vu_id,
    ok: false,
    plan: null,
    diagnostics: lastDiagnostics,
    raw_response: lastContent,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey && !args.dryRun) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }

  const inputPath = resolve(args.input);
  const outputPath = resolve(args.output);
  const input = JSON.parse(readFileSync(inputPath, "utf-8")) as { jobs: VURenderJob[] };
  let jobs = input.jobs.filter((job) => job.llm_policy === "deepseek_plan");
  if (args.vu) jobs = jobs.filter((job) => job.vu_id === args.vu);
  if (args.limit !== undefined) jobs = jobs.slice(0, args.limit);

  if (args.dryRun) {
    const prompts = jobs.map((job) => ({ vu_id: job.vu_id, prompt: buildPrompt(job, args.useDsl) }));
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(
      outputPath,
      JSON.stringify({ model: args.model, useDsl: args.useDsl, prompts }, null, 2),
      "utf-8",
    );
    console.log(`Wrote ${prompts.length} dry-run prompts (useDsl=${args.useDsl}): ${outputPath}`);
    return;
  }

  const client = new OpenAI({
    apiKey,
    baseURL: args.baseUrl,
    timeout: Number(process.env.DEEPSEEK_VU_TIMEOUT_MS ?? 600_000),
    maxRetries: 0,
  });

  const results = [];
  for (const job of jobs) {
    console.log(`Planning ${job.vu_id} with ${args.model} (useDsl=${args.useDsl})`);
    try {
      results.push(await callDeepSeek(client, args.model, job, args.useDsl));
    } catch (error) {
      results.push({
        vu_id: job.vu_id,
        ok: false,
        plan: null,
        diagnostics: [{ message: error instanceof Error ? error.message : String(error) }],
      });
    }
  }

  const output = {
    generated_at: new Date().toISOString(),
    model: args.model,
    base_url: args.baseUrl,
    use_dsl: args.useDsl,
    summary: {
      requested: jobs.length,
      ok: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      with_dsl: results.filter((result) => result.ok && result.plan?.dsl).length,
    },
    results,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`Wrote DeepSeek VU plans: ${outputPath}`);
  console.log(JSON.stringify(output.summary, null, 2));
}

main();
