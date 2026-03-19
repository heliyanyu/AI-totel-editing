import { readFileSync } from "fs";
import { extname, resolve } from "path";
import mammoth from "mammoth";
import type { Word } from "../schemas/blueprint.js";

const BLOCK_BREAK_GAP_SEC = 0.45;
const MAX_TRANSCRIPT_BLOCK_CHARS = 28;
const SCRIPT_LOOKAHEAD = 10;
const ALIGN_THRESHOLD = 0.58;
const DUPLICATE_THRESHOLD = 0.72;

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

const STRONG_REPAIR_TERMS = [
  "不对",
  "准确说",
  "准确地说",
  "更准确地说",
  "应该说",
  "等一下",
  "重说",
];

export interface ScriptBlock {
  id: number;
  text: string;
  normalized: string;
}

export interface TranscriptBlock {
  index: number;
  text: string;
  normalized: string;
  start: number;
  end: number;
}

export interface BlockAlignment {
  transcriptIndex: number;
  scriptIndex: number;
  score: number;
}

export interface HardDiscardHint {
  start: number;
  end: number;
  text: string;
  reason: string;
  confidence: number;
  force: boolean;
  scriptText?: string;
}

export interface Step1CleaningContext {
  scriptPath: string | null;
  scriptText: string;
  scriptBlocks: Array<{ id: number; text: string }>;
  transcriptBlocks: Array<{
    index: number;
    text: string;
    start: number;
    end: number;
    alignedScriptId?: number;
    alignmentScore?: number;
  }>;
  alignments: BlockAlignment[];
  hardDiscardHints: HardDiscardHint[];
  summary: {
    scriptBlockCount: number;
    transcriptBlockCount: number;
    alignedBlockCount: number;
    forcedHintCount: number;
    suggestedHintCount: number;
  };
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

function buildRepairCueHints(words: Word[]): HardDiscardHint[] {
  const normalizedTerms = STRONG_REPAIR_TERMS.map((term) => ({
    raw: term,
    normalized: normalizeText(term),
  }));
  const hints: HardDiscardHint[] = [];
  let lastConsumed = -1;

  for (let index = 0; index < words.length; index++) {
    if (index <= lastConsumed) {
      continue;
    }

    let joined = "";
    const charToWordIndex: number[] = [];
    let matchedFrom = -1;
    let matchedUntil = -1;
    let matchedReason = "";

    for (let end = index; end < Math.min(words.length, index + 6); end++) {
      const normalizedWord = normalizeText(words[end].text);
      joined += normalizedWord;
      for (let charIndex = 0; charIndex < normalizedWord.length; charIndex++) {
        charToWordIndex.push(end);
      }

      for (const term of normalizedTerms) {
        const matchPos = joined.indexOf(term.normalized);
        if (matchPos !== -1) {
          const startWord = charToWordIndex[matchPos] ?? index;
          const endWord =
            charToWordIndex[matchPos + term.normalized.length - 1] ?? end;
          if (startWord !== index) {
            continue;
          }
          matchedFrom = startWord;
          matchedUntil = endWord;
          matchedReason = term.raw;
        }
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
            matchedReason = `不是 + ${strongTerm.raw}`;
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

    hints.push({
      start: round3(words[matchedFrom].start),
      end: round3(words[matchedUntil].end),
      text: words
        .slice(matchedFrom, matchedUntil + 1)
        .map((word) => word.text)
        .join(""),
      reason: `硬清洗提示：口误自我修正（${matchedReason}）`,
      confidence: 0.99,
      force: true,
    });

    lastConsumed = matchedUntil;
  }

  return hints;
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

function buildHardDiscardHints(
  words: Word[],
  transcriptBlocks: TranscriptBlock[],
  scriptBlocks: ScriptBlock[],
  alignments: BlockAlignment[]
): HardDiscardHint[] {
  const alignmentByTranscript = new Map(
    alignments.map((alignment) => [alignment.transcriptIndex, alignment])
  );
  const hints = buildRepairCueHints(words);

  for (let index = 0; index < transcriptBlocks.length; index++) {
    const block = transcriptBlocks[index];
    const alignment = alignmentByTranscript.get(block.index);
    if (alignment) {
      continue;
    }

    const next = transcriptBlocks[index + 1] ?? null;
    const prev = transcriptBlocks[index - 1] ?? null;
    const nextAlignment = next
      ? alignmentByTranscript.get(next.index) ?? null
      : null;
    const prevAlignment = prev
      ? alignmentByTranscript.get(prev.index) ?? null
      : null;

    let reason = "";
    let confidence = 0;
    let force = false;
    let scriptText = "";

    if (isMostlyFiller(block.text)) {
      reason = "硬清洗提示：填充词/气口";
      confidence = 0.96;
      force = true;
    } else if (next) {
      const duplicateScore = similarity(block.normalized, next.normalized);
      if (
        duplicateScore >= DUPLICATE_THRESHOLD &&
        (!!nextAlignment || next.normalized.length >= block.normalized.length)
      ) {
        reason = "硬清洗提示：紧邻后文的重说/重复";
        confidence = 0.94;
        force = true;
      }
    }

    if (!force && prevAlignment && nextAlignment) {
      const prevScript = scriptBlocks[prevAlignment.scriptIndex];
      const nextScript = scriptBlocks[nextAlignment.scriptIndex];
      if (
        prevScript &&
        nextScript &&
        nextAlignment.scriptIndex - prevAlignment.scriptIndex <= 1
      ) {
        reason = "参考文案之外的插入口语，保留则需确认是否有新增信息";
        confidence = 0.66;
        force = false;
        scriptText = nextScript.text;
      }
    }

    if (!reason) {
      continue;
    }

    hints.push({
      start: round3(block.start),
      end: round3(block.end),
      text: block.text,
      reason,
      confidence,
      force,
      scriptText: scriptText || undefined,
    });
  }

  return hints;
}

function applyAlignmentMetadata(
  transcriptBlocks: TranscriptBlock[],
  scriptBlocks: ScriptBlock[],
  alignments: BlockAlignment[]
): Step1CleaningContext["transcriptBlocks"] {
  const alignmentByTranscript = new Map(
    alignments.map((alignment) => [alignment.transcriptIndex, alignment])
  );

  return transcriptBlocks.map((block) => {
    const alignment = alignmentByTranscript.get(block.index);
    if (!alignment) {
      return {
        index: block.index,
        text: block.text,
        start: round3(block.start),
        end: round3(block.end),
      };
    }

    return {
      index: block.index,
      text: block.text,
      start: round3(block.start),
      end: round3(block.end),
      alignedScriptId: scriptBlocks[alignment.scriptIndex]?.id,
      alignmentScore: alignment.score,
    };
  });
}

export async function extractScriptText(scriptPath: string): Promise<string> {
  const resolvedPath = resolve(scriptPath);
  const extension = extname(resolvedPath).toLowerCase();

  if (extension === ".docx") {
    const result = await mammoth.extractRawText({ path: resolvedPath });
    return result.value
      .replace(/\r/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  if (extension === ".txt" || extension === ".md") {
    return readFileSync(resolvedPath, "utf-8").trim();
  }

  throw new Error(`暂不支持的文案格式: ${extension || "(无扩展名)"}`);
}

export async function buildStep1CleaningContext(
  words: Word[],
  scriptPath?: string
): Promise<Step1CleaningContext | null> {
  const transcriptBlocks = transcriptToBlocks(words);

  if (!scriptPath) {
    const hardDiscardHints = buildHardDiscardHints(words, transcriptBlocks, [], []);
    return {
      scriptPath: null,
      scriptText: "",
      scriptBlocks: [],
      transcriptBlocks: transcriptBlocks.map((block) => ({
        index: block.index,
        text: block.text,
        start: round3(block.start),
        end: round3(block.end),
      })),
      alignments: [],
      hardDiscardHints,
      summary: {
        scriptBlockCount: 0,
        transcriptBlockCount: transcriptBlocks.length,
        alignedBlockCount: 0,
        forcedHintCount: hardDiscardHints.filter((hint) => hint.force).length,
        suggestedHintCount: hardDiscardHints.filter((hint) => !hint.force).length,
      },
    };
  }

  const scriptText = await extractScriptText(scriptPath);
  const scriptBlocks = scriptToBlocks(scriptText);
  const alignments = alignTranscriptToScript(transcriptBlocks, scriptBlocks);
  const hardDiscardHints = buildHardDiscardHints(
    words,
    transcriptBlocks,
    scriptBlocks,
    alignments
  );

  const forcedHintCount = hardDiscardHints.filter((hint) => hint.force).length;

  return {
    scriptPath: resolve(scriptPath),
    scriptText,
    scriptBlocks: scriptBlocks.map((block) => ({
      id: block.id,
      text: block.text,
    })),
    transcriptBlocks: applyAlignmentMetadata(
      transcriptBlocks,
      scriptBlocks,
      alignments
    ),
    alignments,
    hardDiscardHints,
    summary: {
      scriptBlockCount: scriptBlocks.length,
      transcriptBlockCount: transcriptBlocks.length,
      alignedBlockCount: alignments.length,
      forcedHintCount,
      suggestedHintCount: hardDiscardHints.length - forcedHintCount,
    },
  };
}

export function applyHardCleaningHints(
  step1Result: { atoms?: Array<Record<string, unknown>> },
  hints: HardDiscardHint[]
): void {
  if (!Array.isArray(step1Result.atoms) || hints.length === 0) {
    return;
  }

  const forceHints = hints.filter((hint) => hint.force);
  if (forceHints.length === 0) {
    return;
  }

  for (const atom of step1Result.atoms) {
    if (
      atom.status !== "keep" ||
      typeof atom.time !== "object" ||
      atom.time === null
    ) {
      continue;
    }

    const time = atom.time as { s?: number; e?: number };
    if (typeof time.s !== "number" || typeof time.e !== "number") {
      continue;
    }

    const atomDuration = Math.max(0.001, time.e - time.s);
    for (const hint of forceHints) {
      const overlap =
        Math.min(time.e, hint.end) - Math.max(time.s, hint.start);
      if (overlap <= 0) {
        continue;
      }

      const overlapRatio = overlap / atomDuration;
      if (overlapRatio >= 0.5) {
        atom.status = "discard";
        atom.reason = hint.reason;
        break;
      }
    }
  }
}

type Step1Atom = Record<string, unknown>;

const TRAILING_MODAL_PARTICLES = /(呢|啊|呀|吧|嘛|哦|哈)+$/u;
const REPAIR_REASON_MARKERS = ["改口", "重说", "纠正", "准确说", "口误"];
const FALSE_DISCARD_REASON_MARKERS = ["重说", "重复", "保留最后一遍", "保留后一句"];
const DISCARD_RECOVERY_BLOCKERS = [
  "口误",
  "改口",
  "准确说",
  "填充词",
  "气口",
  "说了一半",
  "自我否定",
  "推翻",
];
const LEAD_IN_PREFIXES = ["再说", "先说", "就说", "就是说", "那就是", "然后说", "那怎么办", "怎么办"];
const LEAD_IN_SUFFIXES = ["的时候", "的影响", "这一点", "这方面", "最重要的是"];
const CONTINUATION_PREFIXES = ["只是", "但是", "但", "所以", "而且", "并且", "也", "还", "就", "会", "能", "都", "如果", "那么", "才", "的话"];
const ASR_RECOVERY_REASON_MARKERS = ["应为", "识别", "转录", "听写", "口误"];
const ASR_AMBIGUOUS_REASON_MARKERS = [
  "long_script_aligned_span_needs_manual_judgment",
  "low_confidence_script_alignment",
  "between_aligned_script_blocks",
];
const ASR_FRAGMENT_ENDINGS = ["的", "来", "了", "把", "给", "对", "向", "让", "会", "能", "都"];

type Step1AmbiguousSpan = {
  start: number;
  end: number;
  text?: string;
  reason?: string;
  confidence?: number;
};

function getAtomTime(atom: Step1Atom): { s: number; e: number } | null {
  if (typeof atom.time !== "object" || atom.time === null) {
    return null;
  }

  const time = atom.time as { s?: number; e?: number };
  if (typeof time.s !== "number" || typeof time.e !== "number") {
    return null;
  }

  return { s: time.s, e: time.e };
}

function getAtomText(atom: Step1Atom): string {
  return typeof atom.text === "string" ? atom.text : "";
}

function normalizeRepeatLeadIn(text: string): string {
  return normalizeText(text).replace(TRAILING_MODAL_PARTICLES, "");
}

function shouldConsiderFalseDiscardRecovery(reason: string): boolean {
  return (
    FALSE_DISCARD_REASON_MARKERS.some((marker) => reason.includes(marker)) &&
    !DISCARD_RECOVERY_BLOCKERS.some((marker) => reason.includes(marker))
  );
}

function looksLikeLeadIn(text: string): boolean {
  return (
    LEAD_IN_PREFIXES.some((prefix) => text.startsWith(prefix)) ||
    LEAD_IN_SUFFIXES.some((suffix) => text.endsWith(suffix))
  );
}

function collectNearbyKeepText(
  atoms: Step1Atom[],
  startIndex: number,
  direction: 1 | -1,
  maxKeeps = 2
): string[] {
  const texts: string[] = [];
  for (
    let index = startIndex + direction;
    index >= 0 && index < atoms.length && texts.length < maxKeeps;
    index += direction
  ) {
    if (atoms[index].status === "keep") {
      const text = getAtomText(atoms[index]);
      if (text) {
        texts.push(text);
      }
    }
  }
  return texts;
}
function hasDiscardLeadInBefore(atoms: Step1Atom[], index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const atom = atoms[cursor];
    if (atom.status !== "discard") {
      break;
    }

    const text = getAtomText(atom);
    if (text && looksLikeLeadIn(text)) {
      return true;
    }
  }

  return false;
}

function hasRestartLeadInAfter(atoms: Step1Atom[], index: number): boolean {
  for (let cursor = index + 1; cursor < atoms.length; cursor++) {
    const atom = atoms[cursor];
    if (atom.status === "discard") {
      continue;
    }
    if (atom.status !== "keep") {
      continue;
    }

    const text = getAtomText(atom);
    return text ? looksLikeLeadIn(text) : false;
  }

  return false;
}

function hasRecentRepairDiscard(atoms: Step1Atom[], index: number): boolean {
  for (let cursor = Math.max(0, index - 2); cursor < index; cursor++) {
    const atom = atoms[cursor];
    if (atom.status !== "discard") {
      continue;
    }

    const reason = typeof atom.reason === "string" ? atom.reason : "";
    if (REPAIR_REASON_MARKERS.some((marker) => reason.includes(marker))) {
      return true;
    }
  }

  return false;
}

function findNearbyKeepIndex(
  atoms: Step1Atom[],
  startIndex: number,
  direction: 1 | -1
): number {
  for (
    let index = startIndex + direction;
    index >= 0 && index < atoms.length;
    index += direction
  ) {
    if (atoms[index].status === "keep") {
      return index;
    }
  }
  return -1;
}

function overlapsAmbiguousSpan(
  time: { s: number; e: number },
  ambiguousSpans: Step1AmbiguousSpan[]
): boolean {
  return ambiguousSpans.some((span) => {
    if (
      typeof span.start !== "number" ||
      typeof span.end !== "number" ||
      (span.reason && !ASR_AMBIGUOUS_REASON_MARKERS.includes(span.reason))
    ) {
      return false;
    }

    return Math.min(time.e, span.end) - Math.max(time.s, span.start) > 0;
  });
}

function looksLikeContinuationStart(text: string): boolean {
  return CONTINUATION_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function endsLikeAsrFragment(text: string): boolean {
  return ASR_FRAGMENT_ENDINGS.some((suffix) => text.endsWith(suffix));
}

function markAtomDiscard(
  atoms: Step1Atom[],
  index: number,
  reason: string,
  moveBoundaryToIndex?: number
): void {
  const atom = atoms[index];
  if (atom.status !== "keep") {
    return;
  }

  if (
    typeof atom.boundary === "string" &&
    moveBoundaryToIndex !== undefined &&
    atoms[moveBoundaryToIndex]?.status === "keep" &&
    typeof atoms[moveBoundaryToIndex].boundary !== "string"
  ) {
    atoms[moveBoundaryToIndex].boundary = atom.boundary;
  }

  delete atom.boundary;
  atom.status = "discard";
  atom.reason = reason;
}

export function applyStep1SemanticCleanup(
  step1Result: { atoms?: Array<Record<string, unknown>> }
): number {
  if (!Array.isArray(step1Result.atoms) || step1Result.atoms.length === 0) {
    return 0;
  }

  const atoms = step1Result.atoms as Step1Atom[];
  let changes = 0;

  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    if (atom.status !== "keep") {
      continue;
    }

    const currentTime = getAtomTime(atom);
    const currentText = getAtomText(atom);
    if (!currentTime || !currentText) {
      continue;
    }

    let nextKeepIndex = -1;
    for (let cursor = index + 1; cursor < atoms.length; cursor++) {
      if (atoms[cursor].status === "keep") {
        nextKeepIndex = cursor;
        break;
      }
    }

    if (nextKeepIndex === -1) {
      continue;
    }

    const nextKeep = atoms[nextKeepIndex];
    const nextTime = getAtomTime(nextKeep);
    const nextText = getAtomText(nextKeep);
    if (!nextTime || !nextText) {
      continue;
    }

    const gap = nextTime.s - currentTime.e;
    const betweenAtoms = atoms.slice(index + 1, nextKeepIndex);
    const betweenAllDiscard = betweenAtoms.every((candidate) => candidate.status === "discard");

    const currentLeadIn = normalizeRepeatLeadIn(currentText);
    const nextLeadIn = normalizeRepeatLeadIn(nextText);
    if (
      betweenAllDiscard &&
      gap >= 0 &&
      gap <= 8 &&
      currentLeadIn.length >= 3 &&
      currentLeadIn.length <= 10 &&
      currentLeadIn === nextLeadIn
    ) {
      markAtomDiscard(atoms, index, "重说，保留后一句", nextKeepIndex);
      changes++;
      continue;
    }

    const currentNormalized = normalizeText(currentText);
    const nextNormalized = normalizeText(nextText);
    if (
      gap >= 0 &&
      gap <= 1.5 &&
      currentNormalized.length >= 2 &&
      currentNormalized.length <= 4 &&
      nextNormalized.length >= currentNormalized.length + 2 &&
      (nextNormalized.startsWith(currentNormalized) ||
        nextNormalized.endsWith(currentNormalized)) &&
      hasRecentRepairDiscard(atoms, index)
    ) {
      markAtomDiscard(atoms, index, "后文给出更准确表述，保留后一句");
      changes++;
    }
  }

  return changes;
}

export function recoverFalseDiscardedAtoms(
  step1Result: { atoms?: Array<Record<string, unknown>> }
): number {
  if (!Array.isArray(step1Result.atoms) || step1Result.atoms.length === 0) {
    return 0;
  }

  const atoms = step1Result.atoms as Step1Atom[];
  let recovered = 0;

  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    if (atom.status !== "discard") {
      continue;
    }

    const text = getAtomText(atom);
    const reason = typeof atom.reason === "string" ? atom.reason : "";
    const normalized = normalizeText(text);
    if (
      normalized.length < 6 ||
      !shouldConsiderFalseDiscardRecovery(reason) ||
      looksLikeLeadIn(text) ||
      hasDiscardLeadInBefore(atoms, index) ||
      hasRestartLeadInAfter(atoms, index)
    ) {
      continue;
    }

    const neighborTexts = [
      ...collectNearbyKeepText(atoms, index, -1),
      ...collectNearbyKeepText(atoms, index, 1),
    ];
    if (neighborTexts.length === 0) {
      continue;
    }

    const maxNeighborSimilarity = Math.max(
      ...neighborTexts.map((candidate) => similarity(normalized, normalizeText(candidate)))
    );
    if (maxNeighborSimilarity >= 0.38) {
      continue;
    }

    atom.status = "keep";
    delete atom.reason;
    recovered++;
  }

  return recovered;
}

export function recoverAsrSuspectContinuations(
  step1Result: { atoms?: Array<Record<string, unknown>> },
  ambiguousSpans: Step1AmbiguousSpan[] = []
): number {
  if (!Array.isArray(step1Result.atoms) || step1Result.atoms.length === 0) {
    return 0;
  }

  const atoms = step1Result.atoms as Step1Atom[];
  let recovered = 0;

  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    if (atom.status !== "discard") {
      continue;
    }

    const text = getAtomText(atom);
    const reason = typeof atom.reason === "string" ? atom.reason : "";
    const time = getAtomTime(atom);
    const normalized = normalizeText(text);
    if (
      !time ||
      normalized.length < 4 ||
      normalized.length > 18 ||
      !ASR_RECOVERY_REASON_MARKERS.some((marker) => reason.includes(marker)) ||
      isMostlyFiller(text) ||
      looksLikeLeadIn(text)
    ) {
      continue;
    }

    const previousKeepIndex = findNearbyKeepIndex(atoms, index, -1);
    const nextKeepIndex = findNearbyKeepIndex(atoms, index, 1);
    if (previousKeepIndex === -1 || nextKeepIndex === -1) {
      continue;
    }

    const previousKeep = atoms[previousKeepIndex];
    const nextKeep = atoms[nextKeepIndex];
    const previousTime = getAtomTime(previousKeep);
    const nextTime = getAtomTime(nextKeep);
    const nextText = getAtomText(nextKeep);
    if (!previousTime || !nextTime || !nextText) {
      continue;
    }

    const prevGap = time.s - previousTime.e;
    const nextGap = nextTime.s - time.e;
    if (prevGap < -0.05 || prevGap > 0.45 || nextGap < -0.05 || nextGap > 0.35) {
      continue;
    }

    const ambiguousOverlap = overlapsAmbiguousSpan(time, ambiguousSpans);
    const strongCorrection = reason.includes("应为");
    const continuationStart = looksLikeContinuationStart(nextText);
    const fragmentEnding = endsLikeAsrFragment(text);
    const nextHasBoundary = typeof nextKeep.boundary === "string";

    if (!strongCorrection && !ambiguousOverlap) {
      continue;
    }

    if (!continuationStart && !fragmentEnding && !nextHasBoundary) {
      continue;
    }

    atom.status = "keep";
    delete atom.reason;

    if (nextHasBoundary && (continuationStart || fragmentEnding)) {
      delete nextKeep.boundary;
    }

    recovered++;
  }

  return recovered;
}





