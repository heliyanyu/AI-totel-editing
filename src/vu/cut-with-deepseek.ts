import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import OpenAI from "openai";

import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_VU_CUTTER_MODEL,
} from "../config/models";
import type { Blueprint, BlueprintAtom, LogicSegment, TimingMap } from "../schemas/blueprint";
import { buildVisualUnitCutterMessages } from "./prompts/visual-unit-cutter";
import { VisualUnitFileSchema, type VisualUnit } from "./schema";

interface CliArgs {
  blueprintPath: string;
  timingMapPath: string;
  outputPath: string;
  labelsOutputPath: string;
  reportPath: string;
  model: string;
  labelModel: string;
  baseUrl: string;
  source?: string;
  dryRun: boolean;
}

type KeepAtom = Extract<BlueprintAtom, { status: "keep" }>;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    blueprintPath: "",
    timingMapPath: "",
    outputPath: "",
    labelsOutputPath: "",
    reportPath: "",
    model: process.env.DEEPSEEK_VU_CUTTER_MODEL ?? DEFAULT_DEEPSEEK_VU_CUTTER_MODEL,
    labelModel:
      process.env.DEEPSEEK_LABEL_MODEL ??
      process.env.DEEPSEEK_MODEL ??
      "deepseek-v4-flash",
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? DEFAULT_DEEPSEEK_BASE_URL,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--blueprint" || arg === "-b") args.blueprintPath = argv[++i];
    else if (arg === "--timing-map" || arg === "-t") args.timingMapPath = argv[++i];
    else if (arg === "--output" || arg === "-o") args.outputPath = argv[++i];
    else if (arg === "--labels-output") args.labelsOutputPath = argv[++i];
    else if (arg === "--report") args.reportPath = argv[++i];
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--label-model") args.labelModel = argv[++i];
    else if (arg === "--base-url") args.baseUrl = argv[++i];
    else if (arg === "--source") args.source = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.blueprintPath || !args.timingMapPath || !args.outputPath) {
    throw new Error(
      "Usage: npx tsx src/vu/cut-with-deepseek.ts -b blueprint.json -t timing_map.json -o visual_units.json"
    );
  }
  if (!args.labelsOutputPath) {
    args.labelsOutputPath = resolve(dirname(args.outputPath), "progress_nav_labels.json");
  }
  if (!args.reportPath) {
    args.reportPath = resolve(dirname(args.outputPath), "vu_cut_report.json");
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
    if (inString && char === "\r") continue;
    repaired += char;
  }
  return repaired;
}

function keepAtoms(segment: LogicSegment): KeepAtom[] {
  return segment.atoms.filter((atom): atom is KeepAtom => atom.status === "keep");
}

function outputRangeForSegment(segment: LogicSegment, timingMap: TimingMap): { start: number; end: number } | null {
  const keepIds = new Set(keepAtoms(segment).map((atom) => atom.id));
  const mapped = timingMap.segments.filter((seg) => keepIds.has(seg.atom_id));
  if (mapped.length > 0) {
    return {
      start: Math.min(...mapped.map((seg) => seg.output.start)),
      end: Math.max(...mapped.map((seg) => seg.output.end)),
    };
  }
  const atoms = keepAtoms(segment);
  if (atoms.length === 0) return null;
  return {
    start: Math.min(...atoms.map((atom) => atom.time.start)),
    end: Math.max(...atoms.map((atom) => atom.time.end)),
  };
}

function segmentText(segment: LogicSegment): string {
  const itemText = segment.items.map((item) => item.text).filter(Boolean).join("");
  if (itemText) return itemText;
  return keepAtoms(segment).map((atom) => atom.subtitle_text || atom.text).join("");
}

function buildBlueprintSummary(blueprint: Blueprint, timingMap: TimingMap) {
  let logicBlockCount = 0;
  return {
    title: blueprint.title,
    scenes: blueprint.scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      logic_blocks: scene.logic_segments
        .map((segment) => {
          const range = outputRangeForSegment(segment, timingMap);
          if (!range || range.end <= range.start) return null;
          logicBlockCount++;
          const atoms = keepAtoms(segment);
          return {
            id: segment.id,
            start: Number(range.start.toFixed(3)),
            end: Number(range.end.toFixed(3)),
            duration: Number((range.end - range.start).toFixed(3)),
            transition_type: segment.transition_type,
            template: segment.template,
            text: segmentText(segment),
            items: segment.items.map((item) => item.text),
            atoms: atoms.map((atom) => ({
              id: atom.id,
              start: Number(atom.time.start.toFixed(3)),
              end: Number(atom.time.end.toFixed(3)),
              text: atom.subtitle_text || atom.text,
            })),
          };
        })
        .filter(Boolean),
    })),
    summary: {
      source_logic_blocks: logicBlockCount,
    },
  };
}

function normalizeVisualUnit(raw: unknown, index: number): VisualUnit {
  const item = raw as Record<string, unknown>;
  const time = item.time as { start?: unknown; end?: unknown } | undefined;
  const internalBeats = Array.isArray(item.internal_beats)
    ? item.internal_beats.map((beat) => {
        const b = beat as Record<string, unknown>;
        return {
          covers: Array.isArray(b.covers) ? b.covers.map(String) : undefined,
          large_text: b.large_text === undefined ? undefined : String(b.large_text),
          visual: b.visual === undefined ? undefined : String(b.visual),
        };
      })
    : undefined;
  const start = Number(time?.start ?? 0);
  const end = Number(time?.end ?? start);
  return {
    id: String(item.id ?? `VU${String(index + 1).padStart(2, "0")}`),
    time: { start, end },
    duration: Number(item.duration ?? Math.max(0, end - start)),
    covers: Array.isArray(item.covers) ? item.covers.map(String) : [],
    audience_state_from: String(item.audience_state_from ?? ""),
    audience_state_to: String(item.audience_state_to ?? ""),
    communicative_goal: String(item.communicative_goal ?? ""),
    attention_owner: String(item.attention_owner ?? "mixed"),
    presentation_strategy: String(item.presentation_strategy ?? ""),
    one_screen_message: String(item.one_screen_message ?? ""),
    merge_basis: item.merge_basis === undefined ? undefined : String(item.merge_basis),
    split_after: item.split_after === undefined ? undefined : String(item.split_after),
    internal_beats: internalBeats,
  };
}

function validateCoverage(units: VisualUnit[], expectedLogicIds: string[]) {
  const seen = new Map<string, string[]>();
  for (const unit of units) {
    for (const id of unit.covers) {
      const list = seen.get(id) ?? [];
      list.push(unit.id);
      seen.set(id, list);
    }
  }
  const missing = expectedLogicIds.filter((id) => !seen.has(id));
  const duplicated = [...seen.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([id, owners]) => ({ id, owners }));
  return { missing, duplicated };
}

function expectedLogicIdsFromSummary(summary: ReturnType<typeof buildBlueprintSummary>): string[] {
  return summary.scenes.flatMap((scene) =>
    scene.logic_blocks.map((block) => String((block as { id: string }).id))
  );
}

function shortLabel(text: string, max = 4): string {
  const cleaned = String(text || "")
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：,.!?:;【】\[\]（）()\/／]/g, "");
  if (cleaned.length <= max) return cleaned || "节点";
  return cleaned.slice(0, max);
}

function buildFallbackLabels(units: VisualUnit[]) {
  return {
    source: "fallback_from_visual_units",
    tier1: units.map((unit) => ({
      id: unit.id,
      label: shortLabel(unit.one_screen_message || unit.presentation_strategy, 4),
      start: unit.time.start,
      end: unit.time.end,
      covers_vu: [unit.id],
    })),
    tier2: units.flatMap((unit) => {
      const beats = unit.internal_beats?.length
        ? unit.internal_beats
        : [{ large_text: unit.one_screen_message, visual: unit.presentation_strategy }];
      return beats.map((beat, index) => {
        const start = unit.time.start + (unit.duration * index) / beats.length;
        const end = unit.time.start + (unit.duration * (index + 1)) / beats.length;
        return {
          id: `${unit.id}-B${index + 1}`,
          parent_id: unit.id,
          label: shortLabel(beat.large_text || beat.visual || unit.one_screen_message, 5),
          start: Number(start.toFixed(3)),
          end: Number(end.toFixed(3)),
          covers: beat.covers ?? unit.covers,
        };
      });
    }),
    navigation: units.map((unit) => ({
      id: unit.id,
      label: shortLabel(unit.one_screen_message || unit.presentation_strategy, 4),
      start: unit.time.start,
      end: unit.time.end,
    })),
  };
}

async function callJson(client: OpenAI, model: string, messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: Number(process.env.DEEPSEEK_VU_MAX_TOKENS ?? 24000),
    response_format: { type: "json_object" },
    messages,
  });
  return extractJson(response.choices[0]?.message?.content ?? "");
}

async function buildLabelsWithLlm(client: OpenAI, model: string, units: VisualUnit[]) {
  const labelPrompt = [
    "你是短视频进度条和导航标签编辑。只输出 JSON object。",
    "输入是已经切好的 Visual Units。请为两级进度条和导航生成极短中文标签。",
    "规则：",
    "- tier1 是相邻 VU 合并后的 scene/topic 斑块，不是每个 VU 都单独一块；通常 4-8 块。",
    "- tier1 label 2-4 个汉字，像目录，例如：开场、乱吃药、控盐、饮水、睡眠、偏方、总结。",
    "- tier1 的 start/end 必须覆盖其 covers_vu 的完整时间，不能留空隙。",
    "- tier2 是对应 tier1 内部的 beat/logic 短标签，2-5 个汉字，例如：止痛药、盐吃多、水肿、熬夜、成分不明。",
    "- tier2.parent_id 必须指向某个 tier1.id。",
    "- navigation 使用 tier1 的语义，可以略完整但不超过 5 个汉字。",
    "- 不要输出完整句子，不要输出「第一呢」「第二呢」这种纯序号。",
    "- 保持 start/end 与输入时间一致，不要改变时间。",
    "",
    "输出 shape:",
    JSON.stringify(
      {
        tier1: [{ id: "T1", label: "乱吃药", start: 0, end: 12.4, covers_vu: ["VU01", "VU02"] }],
        tier2: [{ id: "T1-B1", parent_id: "T1", label: "止痛药", start: 0, end: 5.8, covers: ["S1-L1"] }],
        navigation: [{ id: "T1", label: "乱吃药", start: 0, end: 12.4 }],
      },
      null,
      2
    ),
    "",
    "输入 VU:",
    JSON.stringify(
      units.map((unit) => ({
        id: unit.id,
        start: unit.time.start,
        end: unit.time.end,
        covers: unit.covers,
        one_screen_message: unit.one_screen_message,
        presentation_strategy: unit.presentation_strategy,
        internal_beats: unit.internal_beats,
      })),
      null,
      2
    ),
  ].join("\n");
  return callJson(client, model, [
    { role: "system", content: "你只输出严格 JSON，不解释。" },
    { role: "user", content: labelPrompt },
  ]);
}

async function main() {
  const args = parseArgs(process.argv);
  const blueprintPath = resolve(args.blueprintPath);
  const timingMapPath = resolve(args.timingMapPath);
  const outputPath = resolve(args.outputPath);
  const labelsOutputPath = resolve(args.labelsOutputPath);
  const reportPath = resolve(args.reportPath);

  const blueprint = JSON.parse(readFileSync(blueprintPath, "utf-8")) as Blueprint;
  const timingMap = JSON.parse(readFileSync(timingMapPath, "utf-8")) as TimingMap;
  const summary = buildBlueprintSummary(blueprint, timingMap);
  const messages = buildVisualUnitCutterMessages(summary);

  if (args.dryRun) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(
      outputPath,
      JSON.stringify({ model: args.model, label_model: args.labelModel, messages, blueprint_summary: summary }, null, 2),
      "utf-8"
    );
    console.log(`Wrote VU cutter dry-run prompt: ${outputPath}`);
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
  const client = new OpenAI({
    apiKey,
    baseURL: args.baseUrl,
    timeout: Number(process.env.DEEPSEEK_VU_TIMEOUT_MS ?? 600_000),
    maxRetries: 0,
  });

  let raw: unknown | null = null;
  let diagnostics: unknown[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`Calling VU cutter ${args.model} (attempt ${attempt}/2)...`);
      raw = await callJson(client, args.model, [
        ...messages,
        ...(attempt === 1
          ? []
          : [
              {
                role: "user" as const,
                content: `上一次输出没有通过校验：${JSON.stringify(diagnostics).slice(0, 2000)}。请只重新输出完整 JSON object。`,
              },
            ]),
      ]);
      const unitsRaw = Array.isArray((raw as { visual_units?: unknown[] }).visual_units)
        ? (raw as { visual_units: unknown[] }).visual_units
        : [];
      const visualUnits = unitsRaw.map(normalizeVisualUnit);
      const expectedLogicIds = expectedLogicIdsFromSummary(summary);
      const coverage = validateCoverage(visualUnits, expectedLogicIds);
      if (visualUnits.length === 0 || coverage.missing.length > 0 || coverage.duplicated.length > 0) {
        diagnostics = [{ message: "coverage validation failed", coverage }];
        continue;
      }

      const output = VisualUnitFileSchema.parse({
        source: {
          blueprint: blueprintPath,
          timing_map: timingMapPath,
          title: blueprint.title,
          case: args.source ?? "",
          generator: "src/vu/cut-with-deepseek.ts",
          model: args.model,
          prompt: "docs/visual-unit-cutter-prompt-v1.md",
        },
        visual_units: visualUnits,
      });

      let labels: unknown;
      try {
        console.log(`Calling progress/nav label model ${args.labelModel}...`);
        labels = await buildLabelsWithLlm(client, args.labelModel, visualUnits);
      } catch (error) {
        labels = buildFallbackLabels(visualUnits);
        diagnostics.push({ message: "label LLM failed; fallback labels used", error: error instanceof Error ? error.message : String(error) });
      }

      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
      writeFileSync(labelsOutputPath, JSON.stringify(labels, null, 2), "utf-8");
      writeFileSync(
        reportPath,
        JSON.stringify(
          {
            generated_at: new Date().toISOString(),
            model: args.model,
            label_model: args.labelModel,
            base_url: args.baseUrl,
            prompt: "docs/visual-unit-cutter-prompt-v1.md",
            summary: {
              source_logic_blocks: expectedLogicIds.length,
              visual_units: visualUnits.length,
              coverage,
            },
            diagnostics,
          },
          null,
          2
        ),
        "utf-8"
      );
      console.log(`Wrote ${visualUnits.length} visual units: ${outputPath}`);
      console.log(`Wrote progress/nav labels: ${labelsOutputPath}`);
      return;
    } catch (error) {
      diagnostics = [{ message: error instanceof Error ? error.message : String(error) }];
    }
  }

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify({ ok: false, diagnostics, raw_response: raw }, null, 2),
    "utf-8"
  );
  throw new Error(`VU cutter failed: ${JSON.stringify(diagnostics).slice(0, 1000)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
