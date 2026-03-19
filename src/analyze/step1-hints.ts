import type { Word } from "../schemas/blueprint.js";
import { extractScriptText } from "./step1-cleaning.js";

const BLOCK_BREAK_GAP_SEC = 0.45;
const MAX_TRANSCRIPT_BLOCK_CHARS = 28;
const SCRIPT_LOOKAHEAD = 10;
const ALIGN_THRESHOLD = 0.58;
const CORRECTION_MIN_SIMILARITY = 0.72;
const DUPLICATE_THRESHOLD = 0.72;
const MAX_LOCAL_CORRECTION_DURATION_SEC = 4;
const MAX_LOCAL_CORRECTION_CHARS = 18;

const STRONG_REPAIR_TERMS = [
  "不对",
  "准确说",
  "准确地说",
  "更准确地说",
  "应该说",
  "等一下",
  "重说",
];

const FILLER_TERMS = [
  "嗯",
  "啊",
  "额",
  "呃",
  "就是",
  "就是说",
  "那个",
  "这个",
  "然后",
];

interface ScriptBlock {
  id: number;
  text: string;
  normalized: string;
}

interface TranscriptBlock {
  index: number;
  text: string;
  normalized: string;
  start: number;
  end: number;
}

interface BlockAlignment {
  transcriptIndex: number;
  scriptIndex: number;
  score: number;
}

export interface CorrectionCandidate {
  start: number;
  end: number;
  rawText: string;
  suggestedText: string;
  confidence: number;
  reason: string;
}

export interface RepairCue {
  start: number;
  end: number;
  text: string;
  cueType: "self_repair";
  confidence: number;
}

export interface AmbiguousSpan {
  start: number;
  end: number;
  text: string;
  reason: string;
  confidence: number;
}

export interface Step1Hints {
  sourceScript: string | null;
  summary: {
    hasScript: boolean;
    candidateCorrections: number;
    repairCues: number;
    ambiguousSpans: number;
  };
  correctionCandidates: CorrectionCandidate[];
  repairCues: RepairCue[];
  ambiguousSpans: AmbiguousSpan[];
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[，。、“”"'‘’！？!?,.:：；;（）()\[\]【】《》<>—\-_\s]/g, "");
}

function splitLongLine(line: string): string[] {
  const parts = line
    .split(/[，,、；;]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    return [line];
  }

  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    const next = current ? `${current}，${part}` : part;
    if (normalizeText(next).length > 28 && current) {
      chunks.push(current);
      current = part;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function scriptToBlocks(scriptText: string): ScriptBlock[] {
  const rawLines = scriptText
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks: ScriptBlock[] = [];
  let nextId = 1;

  for (const rawLine of rawLines) {
    const sentences = rawLine
      .split(/[。！？!?]/)
      .map((part) => part.trim())
      .filter(Boolean);

    const units = sentences.length > 0 ? sentences : [rawLine];
    for (const unit of units) {
      for (const chunk of splitLongLine(unit)) {
        const normalized = normalizeText(chunk);
        if (!normalized) {
          continue;
        }
        blocks.push({
          id: nextId++,
          text: chunk,
          normalized,
        });
      }
    }
  }

  return blocks;
}

function transcriptToBlocks(words: Word[]): TranscriptBlock[] {
  if (words.length === 0) {
    return [];
  }

  const blocks: TranscriptBlock[] = [];
  let currentWords: Word[] = [];

  const flush = () => {
    if (currentWords.length === 0) {
      return;
    }

    const text = currentWords.map((word) => word.text).join("");
    const normalized = normalizeText(text);
    if (!normalized) {
      currentWords = [];
      return;
    }

    blocks.push({
      index: blocks.length,
      text,
      normalized,
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
    });
    currentWords = [];
  };

  for (const word of words) {
    if (currentWords.length === 0) {
      currentWords.push(word);
      continue;
    }

    const prev = currentWords[currentWords.length - 1];
    const gap = word.start - prev.end;
    const nextText = currentWords.map((item) => item.text).join("") + word.text;
    if (
      gap > BLOCK_BREAK_GAP_SEC ||
      normalizeText(nextText).length > MAX_TRANSCRIPT_BLOCK_CHARS
    ) {
      flush();
    }

    currentWords.push(word);
  }

  flush();
  return blocks;
}

function lcsLength(a: string, b: string): number {
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

function similarity(a: string, b: string): number {
  if (!a || !b) {
    return 0;
  }
  const lcs = lcsLength(a, b);
  return (2 * lcs) / (a.length + b.length);
}

function isMostlyFiller(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > 10) {
    return false;
  }

  let stripped = text;
  for (const term of FILLER_TERMS) {
    stripped = stripped.split(term).join("");
  }

  return normalizeText(stripped).length <= Math.ceil(normalized.length * 0.35);
}

function isShortFragment(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length > 6) {
    return false;
  }

  return /^(再说|先说|就说|就是说|那就是|然后说|代谢|血栓|所以|那么|那怎么办)/.test(
    text
  );
}

function buildRepairCues(words: Word[]): RepairCue[] {
  const normalizedTerms = STRONG_REPAIR_TERMS.map((term) => ({
    raw: term,
    normalized: normalizeText(term),
  }));
  const cues: RepairCue[] = [];
  let lastConsumed = -1;

  for (let index = 0; index < words.length; index++) {
    if (index <= lastConsumed) {
      continue;
    }

    let joined = "";
    const charToWordIndex: number[] = [];
    let matchedFrom = -1;
    let matchedUntil = -1;

    for (let end = index; end < Math.min(words.length, index + 6); end++) {
      const normalizedWord = normalizeText(words[end].text);
      joined += normalizedWord;
      for (let charIndex = 0; charIndex < normalizedWord.length; charIndex++) {
        charToWordIndex.push(end);
      }

      for (const term of normalizedTerms) {
        const matchPos = joined.indexOf(term.normalized);
        if (matchPos === -1) {
          continue;
        }
        const startWord = charToWordIndex[matchPos] ?? index;
        const endWord =
          charToWordIndex[matchPos + term.normalized.length - 1] ?? end;
        if (startWord !== index) {
          continue;
        }
        matchedFrom = startWord;
        matchedUntil = endWord;
      }
    }

    if (matchedFrom === -1 && normalizeText(words[index].text) === "不是") {
      for (let inner = index + 1; inner < Math.min(words.length, index + 6); inner++) {
        let trailing = "";
        for (let end = inner; end < Math.min(words.length, inner + 4); end++) {
          trailing += normalizeText(words[end].text);
          const strongTerm = normalizedTerms.find((term) =>
            trailing.includes(term.normalized)
          );
          if (strongTerm) {
            matchedFrom = index;
            matchedUntil = end;
            break;
          }
        }
        if (matchedFrom !== -1) {
          break;
        }
      }
    }

    if (matchedFrom === -1 || matchedUntil === -1) {
      continue;
    }

    while (
      matchedUntil + 1 < words.length &&
      normalizeText(words[matchedUntil + 1].text).length <= 1 &&
      ["是", "啊", "呀", "了"].includes(normalizeText(words[matchedUntil + 1].text))
    ) {
      matchedUntil++;
    }

    cues.push({
      start: round3(words[matchedFrom].start),
      end: round3(words[matchedUntil].end),
      text: words
        .slice(matchedFrom, matchedUntil + 1)
        .map((word) => word.text)
        .join(""),
      cueType: "self_repair",
      confidence: 0.99,
    });

    lastConsumed = matchedUntil;
  }

  return cues;
}

function alignTranscriptToScript(
  transcriptBlocks: TranscriptBlock[],
  scriptBlocks: ScriptBlock[]
): BlockAlignment[] {
  if (scriptBlocks.length === 0 || transcriptBlocks.length === 0) {
    return [];
  }

  const alignments: BlockAlignment[] = [];
  let scriptCursor = 0;

  for (const transcriptBlock of transcriptBlocks) {
    let bestIndex = -1;
    let bestScore = 0;
    const maxIndex = Math.min(scriptBlocks.length, scriptCursor + SCRIPT_LOOKAHEAD);

    for (let index = scriptCursor; index < maxIndex; index++) {
      const score = similarity(
        transcriptBlock.normalized,
        scriptBlocks[index].normalized
      );
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex !== -1 && bestScore >= ALIGN_THRESHOLD) {
      alignments.push({
        transcriptIndex: transcriptBlock.index,
        scriptIndex: bestIndex,
        score: round3(bestScore),
      });
      scriptCursor = bestIndex + 1;
    }
  }

  return alignments;
}

function buildCorrectionCandidates(
  transcriptBlocks: TranscriptBlock[],
  scriptBlocks: ScriptBlock[],
  alignments: BlockAlignment[]
): CorrectionCandidate[] {
  const candidates: CorrectionCandidate[] = [];

  for (const alignment of alignments) {
    const transcriptBlock = transcriptBlocks[alignment.transcriptIndex];
    const scriptBlock = scriptBlocks[alignment.scriptIndex];
    if (!transcriptBlock || !scriptBlock) {
      continue;
    }

    if (
      transcriptBlock.normalized === scriptBlock.normalized ||
      transcriptBlock.normalized.length < 2 ||
      scriptBlock.normalized.length < 2
    ) {
      continue;
    }

    const score = similarity(transcriptBlock.normalized, scriptBlock.normalized);
    const lengthGap = Math.abs(
      scriptBlock.normalized.length - transcriptBlock.normalized.length
    );
    const spanDuration = transcriptBlock.end - transcriptBlock.start;
    const maxNormalizedLength = Math.max(
      transcriptBlock.normalized.length,
      scriptBlock.normalized.length
    );
    const containsRelation =
      scriptBlock.normalized.includes(transcriptBlock.normalized) ||
      transcriptBlock.normalized.includes(scriptBlock.normalized);
    const looksLocalCorrection =
      (score >= CORRECTION_MIN_SIMILARITY && lengthGap <= 4) ||
      (containsRelation && score >= 0.62 && lengthGap <= 6);
    const isLocalSizedSpan =
      spanDuration <= MAX_LOCAL_CORRECTION_DURATION_SEC &&
      maxNormalizedLength <= MAX_LOCAL_CORRECTION_CHARS;

    if (
      !looksLocalCorrection ||
      !isLocalSizedSpan ||
      isMostlyFiller(transcriptBlock.text)
    ) {
      continue;
    }

    candidates.push({
      start: round3(transcriptBlock.start),
      end: round3(transcriptBlock.end),
      rawText: transcriptBlock.text,
      suggestedText: scriptBlock.text,
      confidence: round3(Math.max(score, containsRelation ? 0.88 : 0.8)),
      reason: containsRelation
        ? "script_aligned_term_expansion"
        : "script_aligned_local_correction",
    });
  }

  return dedupeBySpan(candidates, (item) => item.confidence);
}

function overlapsRepairCue(
  block: TranscriptBlock,
  repairCues: RepairCue[]
): boolean {
  return repairCues.some(
    (cue) => Math.min(block.end, cue.end) - Math.max(block.start, cue.start) > 0
  );
}

function buildAmbiguousSpans(
  transcriptBlocks: TranscriptBlock[],
  scriptBlocks: ScriptBlock[],
  alignments: BlockAlignment[],
  repairCues: RepairCue[]
): AmbiguousSpan[] {
  const alignmentByTranscript = new Map(
    alignments.map((alignment) => [alignment.transcriptIndex, alignment])
  );
  const spans: AmbiguousSpan[] = [];

  for (let index = 0; index < transcriptBlocks.length; index++) {
    const block = transcriptBlocks[index];
    if (isMostlyFiller(block.text)) {
      continue;
    }

    const alignment = alignmentByTranscript.get(block.index);
    const prev = transcriptBlocks[index - 1] ?? null;
    const next = transcriptBlocks[index + 1] ?? null;
    const prevAlignment = prev
      ? alignmentByTranscript.get(prev.index) ?? null
      : null;
    const nextAlignment = next
      ? alignmentByTranscript.get(next.index) ?? null
      : null;

    if (overlapsRepairCue(block, repairCues)) {
      spans.push({
        start: round3(block.start),
        end: round3(block.end),
        text: block.text,
        reason: "near_self_repair_cue",
        confidence: 0.82,
      });
      continue;
    }

    if (!alignment && prev && next) {
      const duplicateScore = Math.max(
        similarity(block.normalized, prev.normalized),
        similarity(block.normalized, next.normalized)
      );
      if (duplicateScore >= DUPLICATE_THRESHOLD) {
        spans.push({
          start: round3(block.start),
          end: round3(block.end),
          text: block.text,
          reason: "near_duplicate_or_restart",
          confidence: round3(Math.max(0.72, duplicateScore)),
        });
        continue;
      }
    }

    if (!alignment && prevAlignment && nextAlignment) {
      const prevScript = scriptBlocks[prevAlignment.scriptIndex];
      const nextScript = scriptBlocks[nextAlignment.scriptIndex];
      if (
        prevScript &&
        nextScript &&
        nextAlignment.scriptIndex - prevAlignment.scriptIndex <= 1
      ) {
        spans.push({
          start: round3(block.start),
          end: round3(block.end),
          text: block.text,
          reason: "between_aligned_script_blocks",
          confidence: 0.74,
        });
        continue;
      }
    }

    if (!alignment && isShortFragment(block.text)) {
      spans.push({
        start: round3(block.start),
        end: round3(block.end),
        text: block.text,
        reason: "short_fragment_needs_conservative_judgment",
        confidence: 0.68,
      });
      continue;
    }

    if (
      alignment &&
      scriptBlocks.length > 0 &&
      block.normalized !== scriptBlocks[alignment.scriptIndex]?.normalized
    ) {
      const spanDuration = block.end - block.start;
      const maxNormalizedLength = Math.max(
        block.normalized.length,
        scriptBlocks[alignment.scriptIndex]?.normalized.length ?? 0
      );

      if (
        spanDuration > MAX_LOCAL_CORRECTION_DURATION_SEC ||
        maxNormalizedLength > MAX_LOCAL_CORRECTION_CHARS
      ) {
        spans.push({
          start: round3(block.start),
          end: round3(block.end),
          text: block.text,
          reason: "long_script_aligned_span_needs_manual_judgment",
          confidence: 0.7,
        });
        continue;
      }
    }

    if (alignment && alignment.score < CORRECTION_MIN_SIMILARITY && scriptBlocks.length > 0) {
      spans.push({
        start: round3(block.start),
        end: round3(block.end),
        text: block.text,
        reason: "low_confidence_script_alignment",
        confidence: round3(Math.max(0.6, alignment.score)),
      });
    }
  }

  return dedupeBySpan(spans, (item) => item.confidence);
}

function dedupeBySpan<T extends { start: number; end: number }>(
  items: T[],
  getScore: (item: T) => number
): T[] {
  const bestByKey = new Map<string, T>();

  for (const item of items) {
    const key = `${item.start}-${item.end}`;
    const current = bestByKey.get(key);
    if (!current || getScore(item) > getScore(current)) {
      bestByKey.set(key, item);
    }
  }

  return Array.from(bestByKey.values()).sort((a, b) => a.start - b.start);
}

export async function buildStep1Hints(
  words: Word[],
  scriptPath?: string
): Promise<Step1Hints | null> {
  const transcriptBlocks = transcriptToBlocks(words);
  const repairCues = buildRepairCues(words);

  if (!scriptPath) {
    const ambiguousSpans = buildAmbiguousSpans(
      transcriptBlocks,
      [],
      [],
      repairCues
    );

    return {
      sourceScript: null,
      summary: {
        hasScript: false,
        candidateCorrections: 0,
        repairCues: repairCues.length,
        ambiguousSpans: ambiguousSpans.length,
      },
      correctionCandidates: [],
      repairCues,
      ambiguousSpans,
    };
  }

  const scriptText = await extractScriptText(scriptPath);
  const scriptBlocks = scriptToBlocks(scriptText);
  const alignments = alignTranscriptToScript(transcriptBlocks, scriptBlocks);
  // correctionCandidates 不再生成 — 纠错已由上游 transcript review 完成
  const ambiguousSpans = buildAmbiguousSpans(
    transcriptBlocks,
    scriptBlocks,
    alignments,
    repairCues
  );

  return {
    sourceScript: scriptPath,
    summary: {
      hasScript: true,
      candidateCorrections: 0,
      repairCues: repairCues.length,
      ambiguousSpans: ambiguousSpans.length,
    },
    correctionCandidates: [],
    repairCues,
    ambiguousSpans,
  };
}



