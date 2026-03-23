import type { Transcript, Word } from "../../schemas/blueprint.js";
import type {
  TranscriptReviewDecision,
  TranscriptReviewEdit,
  TranscriptReviewOp,
  TranscriptReviewSummary,
} from "./types.js";

export const MAX_FALLBACK_PATCH_EDITS = 200;

export const ALLOWED_REASONS = new Set([
  "asr_typo",
  "missing_chars",
  "asr_typo_or_missing_chars",
  "medical_term_correction",
  "partial_restart_or_duplicate_prefix",
  "local_duplicate_tokens",
  "unfinished_fragment",
  "restart_fragment",
]);

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

export function toChars(text: string): string[] {
  return Array.from(text);
}

export function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function normalizeOp(value: unknown): TranscriptReviewOp {
  if (value === "delete_span" || value === "dedupe_span") {
    return value;
  }
  return "replace_span";
}

export function normalizeReason(op: TranscriptReviewOp, value: unknown): string {
  if (typeof value === "string" && ALLOWED_REASONS.has(value.trim())) {
    return value.trim();
  }
  if (op === "delete_span") {
    return "partial_restart_or_duplicate_prefix";
  }
  if (op === "dedupe_span") {
    return "local_duplicate_tokens";
  }
  return "asr_typo_or_missing_chars";
}

export function lcsLength(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint16Array(cols));

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[a.length][b.length];
}

export function similarity(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }
  const lcs = lcsLength(a, b);
  return (2 * lcs) / (a.length + b.length);
}

export function findAllOccurrences(haystack: string, needle: string): number[] {
  if (!needle) {
    return [];
  }

  const positions: number[] = [];
  let offset = 0;

  while (offset <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, offset);
    if (index === -1) {
      break;
    }
    positions.push(index);
    offset = index + 1;
  }

  return positions;
}

export function mergeSourceWordIndices(words: Word[]): number[] {
  const indices = new Set<number>();
  for (const word of words) {
    const sourceIndices = word.source_word_indices ?? [];
    for (const index of sourceIndices) {
      indices.add(index);
    }
  }
  return [...indices].sort((a, b) => a - b);
}

export function buildReplacementWords(
  text: string,
  start: number,
  end: number,
  options?: {
    sourceWordIndices?: number[];
    sourceStart?: number;
    sourceEnd?: number;
    synthetic?: boolean;
  }
): Word[] {
  const chars = toChars(text);
  if (chars.length === 0) {
    return [];
  }

  const safeStart = round3(start);
  const safeEnd = round3(end);
  const duration = Math.max(0, safeEnd - safeStart);
  const sourceWordIndices = options?.sourceWordIndices?.length
    ? [...new Set(options.sourceWordIndices)].sort((a, b) => a - b)
    : undefined;
  const sourceStart = options?.sourceStart ?? safeStart;
  const sourceEnd = options?.sourceEnd ?? safeEnd;
  const synthetic = options?.synthetic === true;

  if (chars.length === 1) {
    return [{
      text: chars[0],
      start: safeStart,
      end: safeEnd,
      source_word_indices: sourceWordIndices,
      source_start: round3(sourceStart),
      source_end: round3(sourceEnd),
      synthetic: synthetic || undefined,
    }];
  }

  const step = duration / chars.length;
  return chars.map((char, index) => {
    const charStart = round3(safeStart + step * index);
    const charEnd = index === chars.length - 1 ? safeEnd : round3(safeStart + step * (index + 1));
    return {
      text: char,
      start: charStart,
      end: charEnd,
      source_word_indices: sourceWordIndices,
      source_start: round3(sourceStart),
      source_end: round3(sourceEnd),
      synthetic: synthetic || undefined,
    };
  });
}

export function expandWordsToCharWords(
  words: Word[],
  options?: { sourceIndexOffset?: number }
): Word[] {
  const charWords: Word[] = [];
  const sourceIndexOffset = options?.sourceIndexOffset ?? 0;

  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const chars = toChars(word.text);
    if (chars.length === 0) {
      continue;
    }

    charWords.push(
      ...buildReplacementWords(word.text, word.start, word.end, {
        sourceWordIndices:
          word.source_word_indices && word.source_word_indices.length > 0
            ? word.source_word_indices
            : [sourceIndexOffset + index],
        sourceStart: word.source_start ?? word.start,
        sourceEnd: word.source_end ?? word.end,
        synthetic: word.synthetic ?? false,
      })
    );
  }

  return charWords;
}

export function cloneWords(words: Word[]): Word[] {
  return words.map((word) => ({ ...word }));
}

export function selectPreferredSourceWindow(existing: Word[], replacementText: string): Word[] | null {
  const replacement = stripWhitespace(replacementText);
  if (!replacement || existing.length === 0) {
    return null;
  }

  const existingText = existing.map((word) => word.text).join("");
  const exactStart = existingText.lastIndexOf(replacement);
  if (exactStart >= 0) {
    return cloneWords(existing.slice(exactStart, exactStart + toChars(replacement).length));
  }

  const replacementLength = toChars(replacement).length;
  const minWindow = Math.max(1, replacementLength - 2);
  const maxWindow = Math.min(existing.length, replacementLength + 4);
  let bestWindow: { start: number; end: number; score: number } | null = null;

  for (let start = 0; start < existing.length; start++) {
    for (let length = minWindow; length <= maxWindow; length++) {
      const end = start + length;
      if (end > existing.length) {
        break;
      }

      const candidateText = existing.slice(start, end).map((word) => word.text).join("");
      const score = similarity(candidateText, replacement);
      if (score < 0.82) {
        continue;
      }

      if (
        !bestWindow ||
        score > bestWindow.score ||
        (score === bestWindow.score && start > bestWindow.start)
      ) {
        bestWindow = { start, end, score };
      }
    }
  }

  return bestWindow ? cloneWords(existing.slice(bestWindow.start, bestWindow.end)) : null;
}

export function buildReplacementFromSourceWindow(
  replacementText: string,
  sourceWindow: Word[]
): Word[] {
  if (sourceWindow.length === 0) {
    return [];
  }

  const sourceWindowText = sourceWindow.map((word) => word.text).join("");
  if (sourceWindowText === replacementText) {
    return cloneWords(sourceWindow);
  }

  return buildReplacementWords(
    replacementText,
    sourceWindow[0].start,
    sourceWindow[sourceWindow.length - 1].end,
    {
      sourceWordIndices: mergeSourceWordIndices(sourceWindow),
      sourceStart: sourceWindow[0].source_start ?? sourceWindow[0].start,
      sourceEnd:
        sourceWindow[sourceWindow.length - 1].source_end ??
        sourceWindow[sourceWindow.length - 1].end,
      synthetic: true,
    }
  );
}

export function opPriority(op: TranscriptReviewOp): number {
  switch (op) {
    case "delete_span":
      return 3;
    case "dedupe_span":
      return 2;
    case "replace_span":
    default:
      return 1;
  }
}

export function buildSummary(
  acceptedEdits: TranscriptReviewDecision[],
  rejectedEdits: TranscriptReviewDecision[]
): TranscriptReviewSummary {
  const accepted = acceptedEdits.filter((edit) => edit.status === "accepted");
  return {
    replaceCount: accepted.filter((edit) => edit.op === "replace_span").length,
    deleteCount: accepted.filter((edit) => edit.op === "delete_span").length,
    dedupeCount: accepted.filter((edit) => edit.op === "dedupe_span").length,
    acceptedCount: accepted.length,
    rejectedCount: rejectedEdits.length,
  };
}

export function alignCorrectedChars(
  originalChars: string[],
  correctedChars: string[]
): Array<number | null> {
  const rows = originalChars.length;
  const cols = correctedChars.length;
  const dirs = Array.from({ length: rows + 1 }, () => new Uint8Array(cols + 1));
  let prev = new Uint16Array(cols + 1);
  let curr = new Uint16Array(cols + 1);

  for (let j = 1; j <= cols; j++) {
    prev[j] = j;
    dirs[0][j] = 2;
  }

  for (let i = 1; i <= rows; i++) {
    curr[0] = i;
    dirs[i][0] = 1;

    for (let j = 1; j <= cols; j++) {
      const diag = prev[j - 1] + (originalChars[i - 1] === correctedChars[j - 1] ? 0 : 1);
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;

      if (diag <= del && diag <= ins) {
        curr[j] = diag;
        dirs[i][j] = 0;
      } else if (del <= ins) {
        curr[j] = del;
        dirs[i][j] = 1;
      } else {
        curr[j] = ins;
        dirs[i][j] = 2;
      }
    }

    [prev, curr] = [curr, prev];
  }

  const mapping: Array<number | null> = Array.from({ length: cols }, () => null);
  let i = rows;
  let j = cols;

  while (i > 0 || j > 0) {
    const dir = dirs[i][j];
    if (i > 0 && j > 0 && dir === 0) {
      mapping[j - 1] = i - 1;
      i -= 1;
      j -= 1;
      continue;
    }

    if (i > 0 && (j === 0 || dir === 1)) {
      i -= 1;
      continue;
    }

    if (j > 0) {
      j -= 1;
      continue;
    }
  }

  return mapping;
}

export function mergeIndicesFromSourceWords(words: Word[]): number[] | undefined {
  const merged = mergeSourceWordIndices(words);
  return merged.length > 0 ? merged : undefined;
}
