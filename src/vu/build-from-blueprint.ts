import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { Blueprint, BlueprintAtom, LogicSegment, TimingMap } from "../schemas/blueprint";
import { VisualUnitFileSchema, type InternalBeat, type VisualUnit } from "./schema";

interface CliArgs {
  blueprintPath: string;
  timingMapPath: string;
  outputPath: string;
  source?: string;
  minDurationSec: number;
}

interface DraftUnit {
  sceneId: string;
  sceneTitle: string;
  segment: LogicSegment;
  start: number;
  end: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    blueprintPath: "",
    timingMapPath: "",
    outputPath: "",
    minDurationSec: 1.8,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--blueprint" || arg === "-b") args.blueprintPath = argv[++i];
    else if (arg === "--timing-map" || arg === "-t") args.timingMapPath = argv[++i];
    else if (arg === "--output" || arg === "-o") args.outputPath = argv[++i];
    else if (arg === "--source") args.source = argv[++i];
    else if (arg === "--min-duration-sec") args.minDurationSec = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.blueprintPath || !args.timingMapPath || !args.outputPath) {
    throw new Error(
      "Usage: npx tsx src/vu/build-from-blueprint.ts -b blueprint.json -t timing_map.json -o visual_units.json"
    );
  }
  return args;
}

function keepAtoms(segment: LogicSegment): Extract<BlueprintAtom, { status: "keep" }>[] {
  return segment.atoms.filter((atom): atom is Extract<BlueprintAtom, { status: "keep" }> => atom.status === "keep");
}

function compactText(text: string, max = 28): string {
  const cleaned = String(text || "")
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：,.!?:;【】\[\]（）()]/g, "");
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function segmentText(segment: LogicSegment): string {
  const itemText = segment.items.map((item) => item.text).filter(Boolean).join(" / ");
  if (itemText) return itemText;
  return keepAtoms(segment).map((atom) => atom.subtitle_text || atom.text).join(" / ");
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

function inferAttentionOwner(segment: LogicSegment, text: string): VisualUnit["attention_owner"] {
  const template = segment.template;
  if (template === "subtitle_only") {
    if (/肾|尿|蛋白|肌酐|血压|水肿|透析|药|盐|感染|熬夜|运动|复查|风险|不能|不要|别/.test(text)) {
      return "board";
    }
    return "doctor";
  }
  if (template === "asset_clip") return "visual";
  if (["step_arrow", "branch_path", "brick_stack", "body_annotate"].includes(template)) return "diagram";
  if (["list_fade", "category_table", "number_center", "warning_alert"].includes(template)) return "board";
  if (["hero_text", "myth_buster"].includes(template)) return "text";
  return "mixed";
}

function inferPresentationStrategy(segment: LogicSegment, text: string, index: number): string {
  const template = segment.template;
  const combined = `${segment.transition_type} ${text}`;

  if (index === 0 || /今天|六件事|不能干|别干|提醒|题目|主题/.test(combined)) return "标题揭示屏";
  if (/\d+|%|％|分钟|小时|克|毫升|mmol|mg|肌酐|蛋白/.test(combined)) return "数字披露";
  if (/第一|第二|第三|第四|第五|第六|六件|清单|步骤|路径|建议/.test(combined)) return "路径屏";
  if (/不要|不能|别|风险|伤肾|加重|危险|警惕|出事/.test(combined)) return "机制 + 警示";
  if (/为什么|原因|机制|导致|因为|所以|原理/.test(combined)) return "机制因果链";
  if (/对比|不是|而是|替代|换成|少吃|多吃/.test(combined)) return "替代对比";

  switch (template) {
    case "split_column":
      return "对比屏";
    case "number_center":
      return "数字披露";
    case "warning_alert":
      return "机制 + 警示";
    case "step_arrow":
    case "vertical_timeline":
      return "路径屏";
    case "branch_path":
      return "决策树";
    case "myth_buster":
      return "误区翻转";
    case "asset_clip":
    case "body_annotate":
    case "brick_stack":
      return "机制因果链";
    case "hero_text":
      return "标题揭示屏";
    default:
      return "知识板";
  }
}

function internalBeats(segment: LogicSegment): InternalBeat[] {
  const items = segment.items.length > 0
    ? segment.items.map((item) => item.text)
    : keepAtoms(segment).map((atom) => atom.subtitle_text || atom.text);
  const cleaned = items.map((item) => compactText(item, 18)).filter(Boolean);
  if (cleaned.length === 0) return [{ large_text: compactText(segmentText(segment), 18), visual: "核心口播提炼" }];
  return cleaned.slice(0, 4).map((item) => ({
    large_text: item,
    visual: "作为本 VU 的逻辑 beat 逐步揭示",
  }));
}

function mergeShortUnits(units: DraftUnit[], minDurationSec: number): DraftUnit[] {
  const result: DraftUnit[] = [];
  for (const unit of units) {
    const duration = unit.end - unit.start;
    const prev = result[result.length - 1];
    if (prev && unit.sceneId === prev.sceneId && duration < minDurationSec) {
      prev.end = Math.max(prev.end, unit.end);
      prev.segment = {
        ...prev.segment,
        id: `${prev.segment.id}+${unit.segment.id}`,
        items: [...prev.segment.items, ...unit.segment.items],
        atoms: [...prev.segment.atoms, ...unit.segment.atoms],
      };
    } else {
      result.push({ ...unit });
    }
  }
  return result;
}

function buildVisualUnits(blueprint: Blueprint, timingMap: TimingMap, minDurationSec: number): VisualUnit[] {
  const draftUnits: DraftUnit[] = [];
  for (const scene of blueprint.scenes) {
    for (const segment of scene.logic_segments) {
      const range = outputRangeForSegment(segment, timingMap);
      if (!range || range.end <= range.start) continue;
      draftUnits.push({
        sceneId: scene.id,
        sceneTitle: scene.title,
        segment,
        start: range.start,
        end: range.end,
      });
    }
  }

  const merged = mergeShortUnits(
    draftUnits.sort((a, b) => a.start - b.start),
    minDurationSec
  );

  return merged.map((unit, index) => {
    const text = segmentText(unit.segment);
    const oneScreenMessage = compactText(text || unit.sceneTitle, 24);
    const strategy = inferPresentationStrategy(unit.segment, text, index);
    const attentionOwner = inferAttentionOwner(unit.segment, text);
    const id = `SVU${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      time: {
        start: Number(unit.start.toFixed(3)),
        end: Number(unit.end.toFixed(3)),
      },
      duration: Number((unit.end - unit.start).toFixed(3)),
      covers: unit.segment.id.split("+"),
      audience_state_from: "正在跟随医生口播理解当前风险点。",
      audience_state_to: `记住关键判断：${oneScreenMessage}`,
      communicative_goal: unit.segment.transition_type || "提炼当前逻辑块，让画面服务理解。",
      attention_owner: attentionOwner,
      presentation_strategy: strategy,
      one_screen_message: oneScreenMessage,
      merge_basis: `由 ${unit.sceneTitle} / ${unit.segment.id} 自动生成。`,
      split_after: "下一个逻辑块进入新的 VU。",
      internal_beats: internalBeats(unit.segment),
    };
  });
}

function main() {
  const args = parseArgs(process.argv);
  const blueprintPath = resolve(args.blueprintPath);
  const timingMapPath = resolve(args.timingMapPath);
  const outputPath = resolve(args.outputPath);

  const blueprint = JSON.parse(readFileSync(blueprintPath, "utf-8")) as Blueprint;
  const timingMap = JSON.parse(readFileSync(timingMapPath, "utf-8")) as TimingMap;
  const visualUnits = buildVisualUnits(blueprint, timingMap, args.minDurationSec);

  const output = VisualUnitFileSchema.parse({
    source: {
      blueprint: blueprintPath,
      timing_map: timingMapPath,
      title: blueprint.title,
      case: args.source ?? "",
      generator: "src/vu/build-from-blueprint.ts",
    },
    visual_units: visualUnits,
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`Wrote ${visualUnits.length} visual units: ${outputPath}`);
}

main();
