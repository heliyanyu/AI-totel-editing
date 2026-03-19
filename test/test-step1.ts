/**
 * Step 1（语义拆解）独立测试脚本
 *
 * 用法:
 *   npx tsx test/test-step1.ts --transcript output/demo01/transcript.json
 *   npx tsx test/test-step1.ts --transcript output/demo01/transcript.json --dry-run
 *   npx tsx test/test-step1.ts --transcript output/demo01/transcript.json --model claude-sonnet-4-6
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { SYSTEM_PROMPT_STEP1, buildUserPromptStep1 } from "../src/analyze/prompt-3level.js";
import { extractJson } from "../src/analyze/schema.js";

// ── 配置 ─────────────────────────────────────────────

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 16384;

// ── 颜色 ─────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  strikethrough: "\x1b[9m",
};

function ok(msg: string) { console.log(`  ${C.green}✓${C.reset} ${msg}`); }
function warn(msg: string) { console.log(`  ${C.yellow}⚠${C.reset} ${msg}`); }
function fail(msg: string) { console.log(`  ${C.red}✗${C.reset} ${msg}`); }
function info(msg: string) { console.log(`  ${C.cyan}ℹ${C.reset} ${msg}`); }
function header(msg: string) { console.log(`\n${C.bold}${C.blue}── ${msg} ──${C.reset}`); }

// ── 类型 ─────────────────────────────────────────────

interface Step1Atom {
  id: number;
  text: string;
  time: { s: number; e: number };
  status: "keep" | "discard";
  boundary?: "scene" | "logic";
  reason?: string;
}

interface Step1Result {
  atoms: Step1Atom[];
}

// ── 校验 ─────────────────────────────────────────────

interface Step1Validation {
  success: boolean;
  errors: string[];
  warnings: string[];
  atoms: Step1Atom[];
  sceneCount: number;
  logicCount: number;
  keepCount: number;
  discardCount: number;
}

function validateStep1(data: any, duration: number): Step1Validation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 基本结构
  if (!data?.atoms || !Array.isArray(data.atoms)) {
    return { success: false, errors: ["缺少 atoms 数组"], warnings, atoms: [], sceneCount: 0, logicCount: 0, keepCount: 0, discardCount: 0 };
  }

  const atoms: Step1Atom[] = data.atoms;

  // 字段检查
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    if (typeof a.id !== "number") errors.push(`atoms[${i}]: id 不是数字`);
    if (typeof a.text !== "string" || a.text.length === 0) errors.push(`atoms[${i}]: text 为空`);
    if (!a.time || typeof a.time.s !== "number" || typeof a.time.e !== "number") {
      errors.push(`atoms[${i}]: time 格式错误（需要 {s, e}）`);
    } else if (a.time.s >= a.time.e) {
      errors.push(`atoms[${i}] "${a.text}": 时间无效 s=${a.time.s} >= e=${a.time.e}`);
    }
    if (a.status !== "keep" && a.status !== "discard") {
      errors.push(`atoms[${i}]: status 无效 "${a.status}"`);
    }
    if (a.boundary && a.boundary !== "scene" && a.boundary !== "logic") {
      warnings.push(`atoms[${i}]: boundary 值不规范 "${a.boundary}"`);
    }
    if (a.status === "discard" && !a.reason) {
      warnings.push(`atoms[${i}] "${a.text}": discard 但没有 reason`);
    }
  }

  // id 递增检查
  for (let i = 1; i < atoms.length; i++) {
    if (atoms[i].id <= atoms[i - 1].id) {
      warnings.push(`id 非递增: atoms[${i}].id=${atoms[i].id} <= atoms[${i - 1}].id=${atoms[i - 1].id}`);
    }
  }

  // 时间排序检查
  for (let i = 1; i < atoms.length; i++) {
    const prev = atoms[i - 1];
    const curr = atoms[i];
    if (prev.time && curr.time && curr.time.s < prev.time.e - 0.3) {
      errors.push(
        `时间重叠: [${prev.id}] "${prev.text}" (e=${prev.time.e.toFixed(2)}) 与 [${curr.id}] "${curr.text}" (s=${curr.time.s.toFixed(2)})`
      );
    }
  }

  // 时间跳空检查
  const keepAtoms = atoms.filter(a => a.status === "keep");
  for (let i = 1; i < keepAtoms.length; i++) {
    const gap = keepAtoms[i].time.s - keepAtoms[i - 1].time.e;
    if (gap > 10) {
      warnings.push(
        `时间跳空 ${gap.toFixed(1)}s: [${keepAtoms[i - 1].id}] (e=${keepAtoms[i - 1].time.e.toFixed(1)}) → [${keepAtoms[i].id}] (s=${keepAtoms[i].time.s.toFixed(1)})`
      );
    }
  }

  // 统计
  const sceneCount = atoms.filter(a => a.boundary === "scene").length;
  const logicCount = atoms.filter(a => a.boundary === "logic").length;
  const keepCount = atoms.filter(a => a.status === "keep").length;
  const discardCount = atoms.filter(a => a.status === "discard").length;

  // 第一个 atom 应有 scene boundary
  if (atoms.length > 0 && atoms[0].boundary !== "scene") {
    warnings.push("第一个原子块没有 scene boundary");
  }

  // 覆盖率
  const totalCovered = keepAtoms.reduce((sum, a) => sum + (a.time.e - a.time.s), 0);
  const coveragePercent = duration > 0 ? (totalCovered / duration) * 100 : 0;
  if (coveragePercent < 50) {
    errors.push(`覆盖率过低: ${coveragePercent.toFixed(1)}%`);
  } else if (coveragePercent < 70) {
    warnings.push(`覆盖率偏低: ${coveragePercent.toFixed(1)}%`);
  }

  // 原子块粒度检查
  const longAtoms = atoms.filter(a => a.text.length > 20);
  if (longAtoms.length > atoms.length * 0.3) {
    warnings.push(`${longAtoms.length}/${atoms.length} 原子块超过 20 字，粒度可能太粗`);
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    atoms,
    sceneCount,
    logicCount,
    keepCount,
    discardCount,
  };
}

// ── 三级分组 ──────────────────────────────────────────

interface LogicBlock {
  atoms: Step1Atom[];
}

interface SceneBlock {
  logicBlocks: LogicBlock[];
}

function groupAtoms(atoms: Step1Atom[]): SceneBlock[] {
  const scenes: SceneBlock[] = [];
  let currentScene: SceneBlock | null = null;
  let currentLogic: LogicBlock | null = null;

  for (const atom of atoms) {
    if (atom.boundary === "scene" || !currentScene) {
      // 新场景 = 也开始新逻辑块
      currentLogic = { atoms: [] };
      currentScene = { logicBlocks: [currentLogic] };
      scenes.push(currentScene);
    } else if (atom.boundary === "logic") {
      // 新逻辑块
      currentLogic = { atoms: [] };
      currentScene.logicBlocks.push(currentLogic);
    }
    currentLogic!.atoms.push(atom);
  }

  return scenes;
}

// ── 可读预览 ──────────────────────────────────────────

function printPreview(atoms: Step1Atom[]) {
  header("三级结构预览");

  const scenes = groupAtoms(atoms);

  for (let si = 0; si < scenes.length; si++) {
    const scene = scenes[si];
    const sceneKeep = scene.logicBlocks.flatMap(lb => lb.atoms).filter(a => a.status === "keep");
    const sceneStart = sceneKeep.length > 0 ? sceneKeep[0].time.s.toFixed(1) : "?";
    const sceneEnd = sceneKeep.length > 0 ? sceneKeep[sceneKeep.length - 1].time.e.toFixed(1) : "?";

    console.log(`\n  ${C.bold}${C.blue}┃ 场景 ${si + 1}${C.reset} ${C.dim}[${sceneStart}s - ${sceneEnd}s]${C.reset}`);

    for (let li = 0; li < scene.logicBlocks.length; li++) {
      const lb = scene.logicBlocks[li];
      const keepInBlock = lb.atoms.filter(a => a.status === "keep");
      const discardInBlock = lb.atoms.filter(a => a.status === "discard");
      const discardStr = discardInBlock.length > 0 ? ` ${C.red}+${discardInBlock.length}废${C.reset}` : "";

      console.log(`  ${C.cyan}  ├─ 逻辑块 ${li + 1}${C.reset} (${keepInBlock.length} keep${discardStr})`);

      // 显示原子块
      for (const atom of lb.atoms) {
        const timeStr = `${C.dim}[${atom.time.s.toFixed(1)}-${atom.time.e.toFixed(1)}]${C.reset}`;
        if (atom.status === "discard") {
          console.log(`  ${C.red}  │   🗑️ ${C.strikethrough}${atom.text}${C.reset} ${timeStr} ${C.dim}— ${atom.reason || ""}${C.reset}`);
        } else {
          console.log(`  ${C.green}  │   ✅ ${atom.text}${C.reset} ${timeStr}`);
        }
      }

      // 拼读检验
      const keepText = keepInBlock.map(a => a.text).join("");
      console.log(`  ${C.dim}  │   拼读: ${keepText}${C.reset}`);
    }
  }
}

// ── 主函数 ─────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let transcriptPath = "";
  let model = DEFAULT_MODEL;
  let dryRun = false;
  let outputDir = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--transcript": case "-t": transcriptPath = args[++i]; break;
      case "--model": case "-m": model = args[++i]; break;
      case "--dry-run": dryRun = true; break;
      case "--output": case "-o": outputDir = args[++i]; break;
      default: if (!transcriptPath) transcriptPath = args[i];
    }
  }

  if (!transcriptPath) {
    console.error("用法: npx tsx test/test-step1.ts --transcript <transcript.json> [--model MODEL] [--dry-run] [--output DIR]");
    process.exit(1);
  }

  transcriptPath = resolve(transcriptPath);
  if (!existsSync(transcriptPath)) {
    console.error(`文件不存在: ${transcriptPath}`);
    process.exit(1);
  }

  // 读取转录
  const transcript = JSON.parse(readFileSync(transcriptPath, "utf-8"));
  const words = transcript.words as Array<{ text: string; start: number; end: number }>;
  const duration = transcript.duration as number;
  const spokenDuration = words.reduce((sum, w) => sum + (w.end - w.start), 0);

  header("转录信息");
  info(`文件: ${transcriptPath}`);
  info(`词数: ${words.length}`);
  info(`总时长: ${(duration / 60).toFixed(1)}分钟 (${duration.toFixed(1)}s)`);
  info(`有声时长: ${spokenDuration.toFixed(1)}s (${(spokenDuration / duration * 100).toFixed(0)}%)`);
  info(`前50字: ${words.slice(0, 15).map(w => w.text).join("")}...`);

  // 构建 prompt
  const systemPrompt = SYSTEM_PROMPT_STEP1;
  const userPrompt = buildUserPromptStep1(words);

  if (dryRun) {
    header("Dry Run - System Prompt");
    console.log(systemPrompt);
    header("Dry Run - User Prompt");
    console.log(userPrompt.slice(0, 300) + "\n... (共 " + userPrompt.length + " 字符)");
    console.log(`\n${C.dim}--dry-run 模式，不调用 LLM${C.reset}`);
    return;
  }

  // 输出目录
  if (!outputDir) {
    outputDir = join(dirname(transcriptPath), "step1-test");
  }
  outputDir = resolve(outputDir);
  mkdirSync(outputDir, { recursive: true });

  // 调用 LLM
  header("调用 LLM (Step 1)");
  info(`模型: ${model}`);
  info(`max_tokens: ${MAX_TOKENS}`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const startTime = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  info(`耗时: ${elapsed}s`);
  info(`Token: input=${inputTokens}, output=${outputTokens}`);
  info(`Stop reason: ${response.stop_reason}`);

  // 提取文本
  const textBlock = response.content.find(b => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    fail("LLM 响应中没有文本内容");
    process.exit(1);
  }

  const rawText = textBlock.text;
  writeFileSync(join(outputDir, "step1-raw.txt"), rawText, "utf-8");
  info(`原始响应已保存: ${join(outputDir, "step1-raw.txt")}`);

  // 提取 JSON
  header("JSON 解析");
  let rawJson: any;
  try {
    rawJson = extractJson(rawText);
    ok("JSON 提取成功");
  } catch (err: any) {
    fail(`JSON 提取失败: ${err.message}`);
    console.log(`\n原始文本前 300 字符:\n${rawText.slice(0, 300)}`);
    process.exit(1);
  }

  writeFileSync(join(outputDir, "step1-parsed.json"), JSON.stringify(rawJson, null, 2), "utf-8");

  // 校验
  header("校验");
  const v = validateStep1(rawJson, spokenDuration);

  if (v.errors.length > 0) {
    fail(`校验错误 (${v.errors.length}):`);
    for (const e of v.errors) {
      console.log(`    ${C.red}·${C.reset} ${e}`);
    }
  } else {
    ok("校验通过");
  }

  if (v.warnings.length > 0) {
    console.log(`\n  ${C.yellow}警告 (${v.warnings.length}):${C.reset}`);
    for (const w of v.warnings) {
      warn(w);
    }
  }

  // 统计
  header("统计");
  console.log(`  原子块总数: ${v.atoms.length}`);
  console.log(`  保留: ${v.keepCount}  废料: ${v.discardCount}`);
  console.log(`  场景边界: ${v.sceneCount}  逻辑边界: ${v.logicCount}`);
  console.log(`  → ${v.sceneCount} 场景, ${v.sceneCount + v.logicCount} 逻辑块`);

  const keepAtoms = v.atoms.filter(a => a.status === "keep");
  const totalCovered = keepAtoms.reduce((sum, a) => sum + (a.time.e - a.time.s), 0);
  console.log(`  覆盖时长: ${totalCovered.toFixed(1)}s / ${spokenDuration.toFixed(1)}s (${(totalCovered / spokenDuration * 100).toFixed(1)}%)`);

  const avgLen = v.atoms.length > 0 ? v.atoms.reduce((s, a) => s + a.text.length, 0) / v.atoms.length : 0;
  console.log(`  平均原子块长度: ${avgLen.toFixed(1)} 字`);

  // 预览
  if (v.atoms.length > 0) {
    printPreview(v.atoms);
  }

  // 保存
  writeFileSync(join(outputDir, "step1-result.json"), JSON.stringify(rawJson, null, 2), "utf-8");
  ok(`结果已保存: ${join(outputDir, "step1-result.json")}`);

  // 总结
  header("总结");
  if (v.success && v.warnings.length === 0) {
    console.log(`\n  ${C.green}${C.bold}✅ Step 1 通过${C.reset}`);
  } else if (v.success) {
    console.log(`\n  ${C.yellow}${C.bold}⚠️ Step 1 通过（${v.warnings.length} 警告）${C.reset}`);
  } else {
    console.log(`\n  ${C.red}${C.bold}❌ Step 1 失败${C.reset}`);
  }

  console.log(`\n  LLM: ${model}, ${elapsed}s, ${inputTokens}+${outputTokens} tokens`);
  console.log(`  输出: ${outputDir}\n`);

  process.exit(v.success ? 0 : 1);
}

main().catch(err => {
  console.error(`\n${C.red}错误:${C.reset}`, err.message);
  if (err.stack) console.error(C.dim + err.stack + C.reset);
  process.exit(1);
});
