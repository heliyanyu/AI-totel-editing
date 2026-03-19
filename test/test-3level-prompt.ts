/**
 * 三级 Prompt 独立验证脚本（Phase 0）
 *
 * 用法:
 *   npx tsx test/test-3level-prompt.ts --transcript output/demo01/transcript.json
 *   npx tsx test/test-3level-prompt.ts --transcript output/demo01/transcript.json --model claude-sonnet-4-6
 *   npx tsx test/test-3level-prompt.ts --transcript output/demo01/transcript.json --dry-run
 *
 * --dry-run: 只打印 prompt，不调用 LLM
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname, join, basename } from "path";
import { SYSTEM_PROMPT_3LEVEL, buildUserPrompt3Level } from "../src/analyze/prompt-3level.js";
import { extractJson } from "../src/analyze/schema.js";
import {
  autoRepair3Level,
  validate3Level,
  type Blueprint3LevelStats,
  type ValidationResult,
} from "../src/analyze/schema-3level.js";

// ── 配置 ─────────────────────────────────────────────

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 16384;

// ── 颜色辅助 ─────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function ok(msg: string) { console.log(`  ${C.green}✓${C.reset} ${msg}`); }
function warn(msg: string) { console.log(`  ${C.yellow}⚠${C.reset} ${msg}`); }
function fail(msg: string) { console.log(`  ${C.red}✗${C.reset} ${msg}`); }
function info(msg: string) { console.log(`  ${C.cyan}ℹ${C.reset} ${msg}`); }
function header(msg: string) { console.log(`\n${C.bold}${C.blue}── ${msg} ──${C.reset}`); }

// ── 主函数 ─────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let transcriptPath = "";
  let model = DEFAULT_MODEL;
  let dryRun = false;
  let outputDir = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--transcript":
      case "-t":
        transcriptPath = args[++i];
        break;
      case "--model":
      case "-m":
        model = args[++i];
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--output":
      case "-o":
        outputDir = args[++i];
        break;
      default:
        if (!transcriptPath) transcriptPath = args[i];
    }
  }

  if (!transcriptPath) {
    console.error(
      "用法: npx tsx test/test-3level-prompt.ts --transcript <transcript.json> [--model MODEL] [--dry-run] [--output DIR]"
    );
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

  // 计算有声时间（words 实际覆盖时长，排除停顿/空白）
  const spokenDuration = words.reduce((sum, w) => sum + (w.end - w.start), 0);

  header("转录信息");
  info(`文件: ${transcriptPath}`);
  info(`词数: ${words.length}`);
  info(`总时长: ${(duration / 60).toFixed(1)}分钟 (${duration.toFixed(1)}s)`);
  info(`有声时长: ${spokenDuration.toFixed(1)}s (${(spokenDuration / duration * 100).toFixed(0)}%)`);
  info(`前50字: ${words.slice(0, 15).map((w) => w.text).join("")}...`);

  // 构建 prompt
  const systemPrompt = SYSTEM_PROMPT_3LEVEL;
  const userPrompt = buildUserPrompt3Level(words);

  if (dryRun) {
    header("Dry Run - System Prompt");
    console.log(systemPrompt.slice(0, 500) + "\n... (共 " + systemPrompt.length + " 字符)");
    header("Dry Run - User Prompt");
    console.log(userPrompt.slice(0, 300) + "\n... (共 " + userPrompt.length + " 字符)");
    console.log(`\n${C.dim}--dry-run 模式，不调用 LLM${C.reset}`);
    return;
  }

  // 设置输出目录
  if (!outputDir) {
    outputDir = join(dirname(transcriptPath), "3level-test");
  }
  outputDir = resolve(outputDir);
  mkdirSync(outputDir, { recursive: true });

  // 调用 LLM
  header("调用 LLM");
  info(`模型: ${model}`);
  info(`max_tokens: ${MAX_TOKENS}`);

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

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
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    fail("LLM 响应中没有文本内容");
    process.exit(1);
  }

  const rawText = textBlock.text;

  // 保存原始响应
  writeFileSync(join(outputDir, "llm-3level-raw.txt"), rawText, "utf-8");
  info(`原始响应已保存: ${join(outputDir, "llm-3level-raw.txt")}`);

  // 提取 JSON
  header("JSON 解析");
  let rawJson: unknown;
  try {
    rawJson = extractJson(rawText);
    ok("JSON 提取成功");
  } catch (err: any) {
    fail(`JSON 提取失败: ${err.message}`);
    // 尝试显示原始文本的前200字符帮助调试
    console.log(`\n原始文本前 200 字符:\n${rawText.slice(0, 200)}`);
    process.exit(1);
  }

  // 保存解析后的 JSON
  writeFileSync(
    join(outputDir, "llm-3level-parsed.json"),
    JSON.stringify(rawJson, null, 2),
    "utf-8"
  );

  // 自动修复
  const repaired = autoRepair3Level(rawJson);
  writeFileSync(
    join(outputDir, "llm-3level-repaired.json"),
    JSON.stringify(repaired, null, 2),
    "utf-8"
  );

  // 校验
  header("Schema 校验");
  const validation = validate3Level(repaired, duration, spokenDuration);

  if (validation.zodErrors) {
    fail("Zod Schema 校验失败:");
    for (const err of validation.zodErrors) {
      console.log(`    ${C.red}·${C.reset} ${err}`);
    }
    process.exit(1);
  }

  if (validation.logicErrors && validation.logicErrors.length > 0) {
    fail("逻辑校验失败:");
    for (const err of validation.logicErrors) {
      console.log(`    ${C.red}·${C.reset} ${err}`);
    }
  } else {
    ok("Schema + 逻辑校验通过");
  }

  if (validation.warnings && validation.warnings.length > 0) {
    console.log(`\n  ${C.yellow}警告 (${validation.warnings.length})：${C.reset}`);
    for (const w of validation.warnings) {
      warn(w);
    }
  }

  // 统计
  if (validation.stats) {
    printStats(validation.stats, duration);
  }

  // 输出结构预览
  if (validation.data) {
    printStructurePreview(validation.data);
  }

  // 保存最终结果
  if (validation.data) {
    writeFileSync(
      join(outputDir, "blueprint-3level.json"),
      JSON.stringify(validation.data, null, 2),
      "utf-8"
    );
    ok(`最终结果已保存: ${join(outputDir, "blueprint-3level.json")}`);
  }

  // 总结
  header("总结");
  const pass = validation.success;
  const warnCount = validation.warnings?.length ?? 0;

  if (pass && warnCount === 0) {
    console.log(`\n  ${C.green}${C.bold}✅ 通过！三级结构校验全部通过${C.reset}`);
  } else if (pass) {
    console.log(`\n  ${C.yellow}${C.bold}⚠️ 通过（有 ${warnCount} 个警告）${C.reset}`);
  } else {
    console.log(`\n  ${C.red}${C.bold}❌ 失败${C.reset}`);
  }

  console.log(
    `\n  LLM: ${model}, ${elapsed}s, ${inputTokens}+${outputTokens} tokens`
  );
  console.log(`  输出: ${outputDir}\n`);

  process.exit(pass ? 0 : 1);
}

// ── 统计打印 ──────────────────────────────────────────

function printStats(stats: Blueprint3LevelStats, duration: number) {
  header("统计");

  console.log(`  场景数: ${stats.sceneCount}`);
  console.log(`  逻辑段数: ${stats.segmentCount}`);
  console.log(`  保留原子块: ${stats.keepAtomCount}`);
  console.log(`  废料原子块: ${stats.discardAtomCount} (段内) + ${stats.topLevelDiscardCount} (顶层)`);
  console.log(`  平均 items/段: ${stats.avgItemsPerSegment.toFixed(1)}`);
  console.log(
    `  覆盖时长: ${stats.totalDurationCovered.toFixed(1)}s / ${duration.toFixed(1)}s (${stats.coveragePercent.toFixed(1)}%)`
  );

  // 模板分布
  console.log(`\n  ${C.bold}模板分布:${C.reset}`);
  const sortedTemplates = Object.entries(stats.templateDistribution)
    .sort((a, b) => b[1] - a[1]);
  for (const [tmpl, count] of sortedTemplates) {
    const pct = ((count / stats.segmentCount) * 100).toFixed(0);
    const bar = "█".repeat(Math.ceil(count * 3));
    console.log(`    ${tmpl.padEnd(20)} ${bar} ${count} (${pct}%)`);
  }

  // View 分布
  console.log(`\n  ${C.bold}View 分布:${C.reset}`);
  for (const [view, count] of Object.entries(stats.viewDistribution)) {
    console.log(`    ${view}: ${count} 场景`);
  }
}

// ── 结构预览 ──────────────────────────────────────────

function printStructurePreview(bp: any) {
  header("结构预览");

  console.log(`  ${C.bold}${bp.title}${C.reset}`);

  for (const scene of bp.scenes) {
    const viewIcon = scene.view === "overlay" ? "👤" : "📊";
    console.log(`\n  ${C.bold}${viewIcon} ${scene.id}: ${scene.title}${C.reset} [${scene.view}]`);

    for (const seg of scene.logic_segments) {
      const keepCount = seg.atoms.filter((a: any) => a.status === "keep").length;
      const discardCount = seg.atoms.filter((a: any) => a.status === "discard").length;
      const discardStr = discardCount > 0 ? ` ${C.red}+${discardCount}废${C.reset}` : "";

      console.log(
        `    ${C.cyan}${seg.id}${C.reset} [${seg.template}] ${seg.transition_type} — ${keepCount} keep${discardStr}`
      );

      // 显示 items
      for (const item of seg.items.slice(0, 3)) {
        const emoji = item.emoji || "  ";
        console.log(`      ${emoji} ${C.dim}${item.text}${C.reset}`);
      }
      if (seg.items.length > 3) {
        console.log(`      ${C.dim}... +${seg.items.length - 3} more${C.reset}`);
      }
    }
  }

  // 顶层废料
  if (bp.discarded && bp.discarded.length > 0) {
    console.log(`\n  ${C.red}${C.bold}🗑️ 顶层废料 (${bp.discarded.length}):${C.reset}`);
    for (const d of bp.discarded.slice(0, 5)) {
      console.log(
        `    ${C.dim}[${d.time.start.toFixed(1)}-${d.time.end.toFixed(1)}s]${C.reset} ${d.text.slice(0, 30)}... (${d.reason})`
      );
    }
  }
}

// ── 运行 ──────────────────────────────────────────────

main().catch((err) => {
  console.error(`\n${C.red}错误:${C.reset}`, err.message);
  if (err.stack) {
    console.error(C.dim + err.stack + C.reset);
  }
  process.exit(1);
});
