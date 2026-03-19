import { writeFileSync } from "fs";
import { alignWords, type WordAlignmentResult } from "./index.js";
import { buildMediaPayload } from "./media-range.js";
import type { Blueprint, KeepAtom, Transcript } from "../schemas/blueprint.js";

export interface AtomAlignmentDebugEntry {
  atomId: number;
  text: string;
  windowWordCount: number;
  matchedWordCount: number;
  confidence: number;
  mode: "reviewed_exact" | "reviewed_projected" | "static_fallback";
  semanticStart: number;
  semanticEnd: number;
  mediaStart: number;
  mediaEnd: number;
  mediaMode: "words_exact" | "words_projected" | "fallback_time";
  mediaConfidence: number;
  mediaOccurrence: "last_complete" | "last_window" | "fallback_time";
  repairDiscardNeighborId?: number;
  repairOverlapChars?: number;
  repairStartTrimSec?: number;
  discardConstrainedWindow?: {
    originalStart: number;
    originalEnd: number;
    constrainedStart: number;
    constrainedEnd: number;
    prevDiscardId?: number;
    nextDiscardId?: number;
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const REPAIR_ADJACENT_GAP_EPSILON_SEC = 0.03;
const REPAIR_START_TRIM_MIN_SEC = 0.04;
const REPAIR_START_TRIM_MAX_SEC = 0.08;

type BlueprintAtomLike = Blueprint["scenes"][number]["logic_segments"][number]["atoms"][number];

function compactText(text: string): string {
  return text.replace(/\s+/g, "");
}

function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;

  while (index < limit && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function getRepairOverlapChars(
  previousAtom: BlueprintAtomLike | undefined,
  currentAtom: KeepAtom
): number {
  if (!previousAtom || previousAtom.status !== "discard") {
    return 0;
  }

  const gapSec = Math.max(0, currentAtom.time.start - previousAtom.time.end);
  if (gapSec > REPAIR_ADJACENT_GAP_EPSILON_SEC) {
    return 0;
  }

  const previousText = compactText(previousAtom.text ?? "");
  const currentText = compactText(currentAtom.text ?? "");
  if (!previousText || !currentText) {
    return 0;
  }

  return sharedPrefixLength(previousText, currentText);
}

function computeRepairStartTrimSec(
  atom: KeepAtom,
  overlapChars: number
): number {
  const mediaRange = atom.media_range ?? atom.time;
  const atomDuration = Math.max(0, mediaRange.end - mediaRange.start);
  if (atomDuration <= 0) {
    return 0;
  }

  const overlapDrivenTrim = Math.max(
    REPAIR_START_TRIM_MIN_SEC,
    overlapChars * 0.02
  );

  return round3(
    Math.min(
      REPAIR_START_TRIM_MAX_SEC,
      overlapDrivenTrim,
      Math.max(0, atomDuration * 0.25)
    )
  );
}

export function applyRepairAwareMediaRangeTrims(
  blueprint: Blueprint,
  debugEntries?: AtomAlignmentDebugEntry[]
): void {
  const orderedAtoms = blueprint.scenes.flatMap((scene) =>
    scene.logic_segments.flatMap((segment) => segment.atoms)
  );
  const debugEntryById = new Map<number, AtomAlignmentDebugEntry>(
    (debugEntries ?? []).map((entry) => [entry.atomId, entry])
  );

  for (let index = 1; index < orderedAtoms.length; index++) {
    const currentAtom = orderedAtoms[index];
    if (currentAtom.status !== "keep" || !currentAtom.media_range) {
      continue;
    }

    const previousAtom = orderedAtoms[index - 1];
    const overlapChars = getRepairOverlapChars(previousAtom, currentAtom);
    if (overlapChars <= 0) {
      continue;
    }

    const trimSec = computeRepairStartTrimSec(currentAtom, overlapChars);
    if (trimSec <= 0) {
      continue;
    }

    currentAtom.media_range.start = round3(
      Math.min(currentAtom.media_range.end, currentAtom.media_range.start + trimSec)
    );

    const debugEntry = debugEntryById.get(currentAtom.id);
    if (debugEntry) {
      debugEntry.mediaStart = currentAtom.media_range.start;
      debugEntry.repairDiscardNeighborId = previousAtom.id;
      debugEntry.repairOverlapChars = overlapChars;
      debugEntry.repairStartTrimSec = trimSec;
    }
  }
}

/**
 * 判断 discard 原子与 keep 原子是否存在文本重叠，
 * 即 lastIndexOf(keepText) 可能在 discardText 的字符区间内命中。
 *
 * 触发条件（满足任一）：
 *   1. discardText 包含整个 keepText（如 "之后呢" ⊇ "之后"）
 *   2. keepText 包含整个 discardText（如 "支架只是" ⊇ "支架"）
 *   3. 共享前缀 ≥ 2 字符（如 "但如果你" 与 "但如果"）
 */
function hasRepairTextOverlap(discardText: string, keepText: string): boolean {
  if (!discardText || !keepText) return false;
  if (discardText.includes(keepText)) return true;
  if (keepText.includes(discardText)) return true;
  if (sharedPrefixLength(discardText, keepText) >= 2) return true;
  return false;
}

/**
 * 为 keep 原子计算 discard-aware 搜索窗口。
 *
 * 基本窗口 = [atom.time.start - padding, atom.time.end + padding]
 * 如果相邻的 discard 原子与当前 keep 原子有文本重叠：
 *   - 前方 discard → windowStart 不早于 discard.time.end
 *   - 后方 discard → windowEnd 不晚于 discard.time.start
 *
 * 保底：窗口至少覆盖 keep 原子自身的 [time.start, time.end]。
 */
function computeDiscardAwareSearchWindow(
  atom: BlueprintAtomLike,
  orderedAtoms: BlueprintAtomLike[],
  atomIndex: number,
  padding: number
): {
  windowStart: number;
  windowEnd: number;
  prevDiscardId?: number;
  nextDiscardId?: number;
} {
  let windowStart = atom.time.start - padding;
  let windowEnd = atom.time.end + padding;
  let prevDiscardId: number | undefined;
  let nextDiscardId: number | undefined;

  const currentText = compactText(atom.text ?? "");

  // 向前扫描连续 discard 原子
  for (let i = atomIndex - 1; i >= 0; i--) {
    const prev = orderedAtoms[i];
    if (prev.status !== "discard") break;

    // 如果 discard 原子完全在窗口外（更早），停止扫描
    if (prev.time.end <= windowStart) break;

    const prevText = compactText(prev.text ?? "");
    if (hasRepairTextOverlap(prevText, currentText)) {
      windowStart = Math.max(windowStart, prev.time.end);
      prevDiscardId = prev.id;
    }
  }

  // 向后扫描连续 discard 原子
  for (let i = atomIndex + 1; i < orderedAtoms.length; i++) {
    const next = orderedAtoms[i];
    if (next.status !== "discard") break;

    if (next.time.start >= windowEnd) break;

    const nextText = compactText(next.text ?? "");
    if (hasRepairTextOverlap(nextText, currentText)) {
      windowEnd = Math.min(windowEnd, next.time.start);
      nextDiscardId = next.id;
    }
  }

  // 保底：窗口至少覆盖 keep 原子自身的语义边界
  windowStart = Math.min(windowStart, atom.time.start);
  windowEnd = Math.max(windowEnd, atom.time.end);

  return { windowStart, windowEnd, prevDiscardId, nextDiscardId };
}

/**
 * Blueprint 后处理层
 *
 * 在 LLM 返回 blueprint 之后、传给渲染之前执行。
 * 为每个 keep atom 补上更可信的 words 字段，并生成独立的媒体真值：
 * - atom.time: 语义边界 / 搜索窗口（来自 LLM，不直接驱动媒体输出）
 * - atom.words: 字幕真值（逐字字幕的事实层）
 * - atom.media_range: 媒体真值（最终播放的原视频子区间）
 */
export function postProcessBlueprint(
  blueprint: Blueprint,
  sourceTranscript: Transcript,
  _referenceTranscript: Transcript = sourceTranscript,
  options?: { debugPath?: string }
): Blueprint {
  let aligned = 0;
  let staticFallback = 0;
  let reviewedProjected = 0;
  let discardConstrained = 0;
  const debugEntries: AtomAlignmentDebugEntry[] = [];
  const WINDOW_PADDING = 0.4;

  // 构建全局有序原子列表，用于 discard-aware 窗口约束
  const orderedAtoms: BlueprintAtomLike[] = blueprint.scenes.flatMap(
    (scene) => scene.logic_segments.flatMap((segment) => segment.atoms)
  );
  const atomIndexById = new Map<number, number>();
  for (let i = 0; i < orderedAtoms.length; i++) {
    atomIndexById.set(orderedAtoms[i].id, i);
  }

  for (const scene of blueprint.scenes) {
    for (const seg of scene.logic_segments) {
      for (const atom of seg.atoms) {
        if (atom.status !== "keep") continue;

        atom.subtitle_text = atom.text;

        // 计算 discard-aware 搜索窗口：如果相邻 discard 原子与当前
        // keep 原子有文本重叠，则收窄搜索窗口以排除 discard 版本
        const flatIndex = atomIndexById.get(atom.id);
        const baseWindowStart = atom.time.start - WINDOW_PADDING;
        const baseWindowEnd = atom.time.end + WINDOW_PADDING;
        let windowStart = baseWindowStart;
        let windowEnd = baseWindowEnd;
        let discardConstraint: AtomAlignmentDebugEntry["discardConstrainedWindow"];

        if (typeof flatIndex === "number") {
          const constraint = computeDiscardAwareSearchWindow(
            atom, orderedAtoms, flatIndex, WINDOW_PADDING
          );
          windowStart = constraint.windowStart;
          windowEnd = constraint.windowEnd;

          if (windowStart !== baseWindowStart || windowEnd !== baseWindowEnd) {
            discardConstrained += 1;
            discardConstraint = {
              originalStart: round3(baseWindowStart),
              originalEnd: round3(baseWindowEnd),
              constrainedStart: round3(windowStart),
              constrainedEnd: round3(windowEnd),
              prevDiscardId: constraint.prevDiscardId,
              nextDiscardId: constraint.nextDiscardId,
            };
          }
        }

        const sourceWords = sourceTranscript.words.filter(
          (w) => w.end > windowStart && w.start < windowEnd
        );

        const result: WordAlignmentResult = alignWords(atom.text, sourceWords);
        atom.alignment_mode = result.mode;
        atom.alignment_confidence = result.confidence;

        if (result.mode === "static_fallback" || result.words.length === 0) {
          atom.words = [];
          staticFallback += 1;
        } else {
          atom.words = result.words;
          aligned += 1;
          if (result.mode === "reviewed_projected") {
            reviewedProjected += 1;
          }
        }

        const media = buildMediaPayload(atom as KeepAtom, result);
        atom.media_range = media.mediaRange;
        atom.media_mode = media.mediaMode;
        atom.media_confidence = media.mediaConfidence;
        atom.media_occurrence = media.mediaOccurrence;

        debugEntries.push({
          atomId: atom.id,
          text: atom.text,
          windowWordCount: sourceWords.length,
          matchedWordCount: result.mode === "static_fallback" ? result.matchedChars : result.words.length,
          confidence: result.confidence,
          mode: result.mode,
          semanticStart: round3(atom.time.start),
          semanticEnd: round3(atom.time.end),
          mediaStart: round3(media.mediaRange.start),
          mediaEnd: round3(media.mediaRange.end),
          mediaMode: media.mediaMode,
          mediaConfidence: media.mediaConfidence,
          mediaOccurrence: media.mediaOccurrence,
          discardConstrainedWindow: discardConstraint,
        });
      }
    }
  }

  applyRepairAwareMediaRangeTrims(blueprint, debugEntries);

  console.log(
    `  Words 对齐: ${aligned} 个 atom 已对齐` +
      (discardConstrained > 0 ? `, ${discardConstrained} 个窗口被 discard 约束` : "") +
      (reviewedProjected > 0 ? `, ${reviewedProjected} 个使用 projected timing` : "") +
      (staticFallback > 0 ? `, ${staticFallback} 个退化为静态字幕` : "")
  );

  if (options?.debugPath) {
    writeFileSync(options.debugPath, JSON.stringify(debugEntries, null, 2), "utf-8");
  }

  return blueprint;
}
