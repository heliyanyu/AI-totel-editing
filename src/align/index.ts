/**
 * Words 对齐模块
 *
 * 最终成片的切点和逐字字幕，优先回到原始 ASR 的字级时间边界。
 * 这里不再做“全局 LCS 拼字”，而是只在局部连续窗口里找匹配：
 * - 优先选择最后一次完整出现
 * - 优先选择时间上连续、紧凑的窗口
 * - 找不到可靠窗口时，宁可退化成静态字幕，也不跨远距离拼字
 */

import type { Word } from "../schemas/blueprint.js";

export type AlignmentMode = "reviewed_exact" | "reviewed_projected" | "static_fallback";

export interface WordAlignmentResult {
  words: Word[];
  confidence: number;
  mode: AlignmentMode;
  matchedChars: number;
  targetChars: number;
  occurrence: "last_complete" | "last_window" | "fallback_time";
  timingHint?: {
    start: number;
    end: number;
  };
}

interface LcsPair {
  targetIndex: number;
  referenceIndex: number;
}

interface CandidateWindow {
  matchedWords: Word[];
  matchedCount: number;
  matchedSpanLength: number;
  coverage: number;
  density: number;
  precision: number;
  score: number;
  startIndex: number;
}

const MIN_PROJECTED_CONFIDENCE = 0.72;
const MIN_TIMING_HINT_CONFIDENCE = 0.42;
const WINDOW_LENGTH_PADDING = 6;
const WINDOW_LENGTH_BACKOFF = 2;
const SHORT_TARGET_GAP = 0.38;
const MEDIUM_TARGET_GAP = 0.55;
const LONG_TARGET_GAP = 0.85;
const OCCURRENCE_SCORE_EPSILON = 0.02;
const OCCURRENCE_COVERAGE_EPSILON = 0.03;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeText(text: string): string {
  return text.replace(/[，。、？！：；“”‘’（）《》【】\s,.\-!?:;"'()\[\]]/g, "");
}

function toChars(text: string): string[] {
  return Array.from(text);
}

function cloneWord(word: Word): Word {
  return {
    ...word,
    source_word_indices: word.source_word_indices ? [...word.source_word_indices] : undefined,
  };
}

function mergeSourceWordIndices(words: Word[]): number[] {
  const indices = new Set<number>();
  for (const word of words) {
    const sourceIndices = word.source_word_indices ?? [];
    for (const index of sourceIndices) {
      indices.add(index);
    }
  }
  return [...indices].sort((a, b) => a - b);
}

function expandToCharWords(words: Word[]): Word[] {
  const expanded: Word[] = [];

  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const normalized = normalizeText(word.text);
    const chars = toChars(normalized);
    if (chars.length === 0) {
      continue;
    }

    const sourceIndices =
      word.source_word_indices && word.source_word_indices.length > 0
        ? [...word.source_word_indices]
        : [index];
    const sourceStart = word.source_start ?? word.start;
    const sourceEnd = word.source_end ?? word.end;

    if (chars.length === 1) {
      expanded.push({
        ...cloneWord(word),
        text: chars[0],
        start: round3(word.start),
        end: round3(word.end),
        source_word_indices: sourceIndices,
        source_start: round3(sourceStart),
        source_end: round3(sourceEnd),
      });
      continue;
    }

    const safeStart = round3(word.start);
    const safeEnd = round3(word.end);
    const duration = Math.max(0, safeEnd - safeStart);
    const step = duration / chars.length;

    chars.forEach((char, charIndex) => {
      const charStart = round3(safeStart + step * charIndex);
      const charEnd =
        charIndex === chars.length - 1 ? safeEnd : round3(safeStart + step * (charIndex + 1));

      expanded.push({
        ...cloneWord(word),
        text: char,
        start: charStart,
        end: charEnd,
        source_word_indices: sourceIndices,
        source_start: round3(sourceStart),
        source_end: round3(sourceEnd),
      });
    });
  }

  return expanded;
}

function buildLcsTable(target: string[], reference: string[]): Uint16Array[] {
  const rows: Uint16Array[] = Array.from(
    { length: target.length + 1 },
    () => new Uint16Array(reference.length + 1)
  );

  for (let i = 1; i <= target.length; i++) {
    for (let j = 1; j <= reference.length; j++) {
      if (target[i - 1] === reference[j - 1]) {
        rows[i][j] = rows[i - 1][j - 1] + 1;
      } else {
        rows[i][j] = Math.max(rows[i - 1][j], rows[i][j - 1]);
      }
    }
  }

  return rows;
}

function tracebackMatchedPairs(
  table: Uint16Array[],
  target: string[],
  reference: string[]
): LcsPair[] {
  const matched: LcsPair[] = [];
  let i = target.length;
  let j = reference.length;

  while (i > 0 && j > 0) {
    if (target[i - 1] === reference[j - 1]) {
      matched.push({ targetIndex: i - 1, referenceIndex: j - 1 });
      i -= 1;
      j -= 1;
      continue;
    }

    if (table[i - 1][j] >= table[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  return matched.reverse();
}

function computeGapMetrics(words: Word[]): { maxGap: number; totalGap: number } {
  let maxGap = 0;
  let totalGap = 0;

  for (let index = 1; index < words.length; index++) {
    const gap = Math.max(0, words[index].start - words[index - 1].end);
    maxGap = Math.max(maxGap, gap);
    totalGap += gap;
  }

  return { maxGap: round3(maxGap), totalGap: round3(totalGap) };
}

function allowedGapSeconds(targetLength: number, windowLength: number): number {
  let base = LONG_TARGET_GAP;
  if (targetLength <= 2) {
    base = SHORT_TARGET_GAP;
  } else if (targetLength <= 5) {
    base = MEDIUM_TARGET_GAP;
  }

  return round3(base + Math.max(0, windowLength - targetLength) * 0.06);
}

function isTemporallyCompact(words: Word[], targetLength: number, windowLength = words.length): boolean {
  if (words.length <= 1) {
    return true;
  }

  const { maxGap, totalGap } = computeGapMetrics(words);
  const gapLimit = allowedGapSeconds(targetLength, windowLength);
  if (maxGap > gapLimit) {
    return false;
  }

  const totalGapLimit = round3(gapLimit * Math.max(1, Math.min(windowLength, targetLength)));
  return totalGap <= totalGapLimit;
}

function buildTimingHint(words: Word[]): { start: number; end: number } | undefined {
  if (words.length === 0) {
    return undefined;
  }

  return {
    start: round3(words[0].start),
    end: round3(words[words.length - 1].end),
  };
}

function buildProjectedWords(targetChars: string[], basisWords: Word[]): Word[] {
  if (basisWords.length === 0 || targetChars.length === 0) {
    return [];
  }

  const start = round3(basisWords[0].start);
  const end = round3(Math.max(basisWords[basisWords.length - 1].end, start + 0.06));
  const duration = Math.max(0.06, end - start);
  const step = duration / targetChars.length;
  const sourceWordIndices = mergeSourceWordIndices(basisWords);
  const sourceStart = round3(basisWords[0].source_start ?? basisWords[0].start);
  const sourceEnd = round3(
    basisWords[basisWords.length - 1].source_end ?? basisWords[basisWords.length - 1].end
  );

  return targetChars.map((char, index) => ({
    text: char,
    start: round3(start + step * index),
    end: index === targetChars.length - 1 ? end : round3(start + step * (index + 1)),
    source_word_indices: sourceWordIndices,
    source_start: sourceStart,
    source_end: sourceEnd,
    synthetic: true,
  }));
}

function pickBetterCandidate(current: CandidateWindow | null, next: CandidateWindow): CandidateWindow {
  if (!current) {
    return next;
  }

  if (Math.abs(next.score - current.score) > OCCURRENCE_SCORE_EPSILON) {
    return next.score > current.score ? next : current;
  }

  if (Math.abs(next.coverage - current.coverage) > OCCURRENCE_COVERAGE_EPSILON) {
    return next.coverage > current.coverage ? next : current;
  }

  if (next.startIndex !== current.startIndex) {
    return next.startIndex > current.startIndex ? next : current;
  }

  return current;
}

function findExactWindow(targetChars: string[], charWords: Word[]): CandidateWindow | null {
  const targetText = targetChars.join("");
  const referenceText = charWords.map((word) => word.text).join("");

  let start = referenceText.lastIndexOf(targetText);
  while (start >= 0) {
    const windowWords = charWords.slice(start, start + targetChars.length).map(cloneWord);
    if (isTemporallyCompact(windowWords, targetChars.length)) {
      return {
        matchedWords: windowWords,
        matchedCount: targetChars.length,
        matchedSpanLength: targetChars.length,
        coverage: 1,
        density: 1,
        precision: 1,
        score: 1,
        startIndex: start,
      };
    }

    start = referenceText.lastIndexOf(targetText, start - 1);
  }

  return null;
}

function searchBestWindow(targetChars: string[], charWords: Word[]): CandidateWindow | null {
  const minWindowLength = Math.max(1, targetChars.length - WINDOW_LENGTH_BACKOFF);
  const maxWindowLength = Math.min(charWords.length, targetChars.length + WINDOW_LENGTH_PADDING);
  let best: CandidateWindow | null = null;

  for (let start = 0; start < charWords.length; start++) {
    for (let length = minWindowLength; length <= maxWindowLength; length++) {
      const end = start + length;
      if (end > charWords.length) {
        break;
      }

      const windowWords = charWords.slice(start, end);
      if (!isTemporallyCompact(windowWords, targetChars.length, length)) {
        continue;
      }

      const referenceChars = windowWords.map((word) => word.text);
      const table = buildLcsTable(targetChars, referenceChars);
      const pairs = tracebackMatchedPairs(table, targetChars, referenceChars);
      if (pairs.length === 0) {
        continue;
      }

      const matchedWords = pairs.map((pair) => cloneWord(windowWords[pair.referenceIndex]));
      const matchedSpanLength = pairs[pairs.length - 1].referenceIndex - pairs[0].referenceIndex + 1;
      if (!isTemporallyCompact(matchedWords, targetChars.length, matchedSpanLength)) {
        continue;
      }

      const matchedCount = pairs.length;
      const coverage = matchedCount / targetChars.length;
      if (coverage < MIN_TIMING_HINT_CONFIDENCE) {
        continue;
      }

      const density = matchedCount / matchedSpanLength;
      const precision = matchedCount / length;
      const { maxGap, totalGap } = computeGapMetrics(matchedWords);
      const score =
        coverage * 0.64 +
        density * 0.22 +
        precision * 0.14 -
        maxGap * 0.08 -
        totalGap * 0.03;

      best = pickBetterCandidate(best, {
        matchedWords,
        matchedCount,
        matchedSpanLength,
        coverage,
        density,
        precision,
        score: round3(score),
        startIndex: start,
      });
    }
  }

  return best;
}

export function alignWords(cleanText: string, referenceWords: Word[]): WordAlignmentResult {
  if (referenceWords.length === 0) {
    return {
      words: [],
      confidence: 0,
      mode: "static_fallback",
      matchedChars: 0,
      targetChars: 0,
      occurrence: "fallback_time",
    };
  }

  const targetChars = toChars(normalizeText(cleanText));
  if (targetChars.length === 0) {
    return {
      words: [],
      confidence: 1,
      mode: "static_fallback",
      matchedChars: 0,
      targetChars: 0,
      occurrence: "fallback_time",
    };
  }

  const charWords = expandToCharWords(referenceWords);
  if (charWords.length === 0) {
    return {
      words: [],
      confidence: 0,
      mode: "static_fallback",
      matchedChars: 0,
      targetChars: targetChars.length,
      occurrence: "fallback_time",
    };
  }

  const exact = findExactWindow(targetChars, charWords);
  if (exact) {
    return {
      words: exact.matchedWords,
      confidence: 1,
      mode: "reviewed_exact",
      matchedChars: exact.matchedCount,
      targetChars: targetChars.length,
      occurrence: "last_complete",
      timingHint: buildTimingHint(exact.matchedWords),
    };
  }

  const best = searchBestWindow(targetChars, charWords);
  if (!best) {
    return {
      words: [],
      confidence: 0,
      mode: "static_fallback",
      matchedChars: 0,
      targetChars: targetChars.length,
      occurrence: "fallback_time",
    };
  }

  const timingHint = buildTimingHint(best.matchedWords);
  const confidence = round3(best.coverage);

  if (best.coverage >= MIN_PROJECTED_CONFIDENCE) {
    return {
      words: buildProjectedWords(targetChars, best.matchedWords),
      confidence,
      mode: "reviewed_projected",
      matchedChars: best.matchedCount,
      targetChars: targetChars.length,
      occurrence: "last_window",
      timingHint,
    };
  }

  return {
    words: [],
    confidence,
    mode: "static_fallback",
    matchedChars: best.matchedCount,
    targetChars: targetChars.length,
    occurrence: "fallback_time",
    timingHint,
  };
}
