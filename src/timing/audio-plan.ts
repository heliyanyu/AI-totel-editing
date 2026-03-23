import { execFileSync } from "child_process";
import type {
  Blueprint,
  KeepAtom,
  TimingClip,
  TimeRange,
  Transcript,
  Word,
} from "../schemas/blueprint.js";
import { allAtoms, keepAtoms } from "../schemas/blueprint.js";

export const LEGACY_BUFFER_BEFORE = 0.05;
export const LEGACY_BUFFER_AFTER = 0.15;
export const DIRECT_BUFFER_BEFORE = 0;
export const DIRECT_BUFFER_AFTER = 0.12;
export const MERGE_GAP_SEC = 0.1;
export const DIRECT_SENTENCE_END_PAD_SEC = 0.18;
export const DIRECT_SENTENCE_BREAK_GAP_SEC = 0.2;

export type PlanningStrategy =
  | "legacy_time"
  | "media_range_v2"
  | "occurrence_reanchor_v1";

export interface KeepWindow {
  atomIds: number[];
  start: number;
  end: number;
  audioSpanId?: string;
}

interface OrderedAtomBoundary {
  id: number;
  start: number;
  end: number;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function hasPositiveRange(range: TimeRange | undefined): range is TimeRange {
  if (!range) {
    return false;
  }
  return typeof range.start === "number" && typeof range.end === "number" && range.end > range.start;
}

export function defaultPlanningStrategy(mode: "cut_video" | "source_direct"): PlanningStrategy {
  return mode === "source_direct" ? "media_range_v2" : "legacy_time";
}

function getPlannerBuffers(mode: "cut_video" | "source_direct"): {
  before: number;
  after: number;
} {
  if (mode === "source_direct") {
    return {
      before: DIRECT_BUFFER_BEFORE,
      after: DIRECT_BUFFER_AFTER,
    };
  }

  return {
    before: LEGACY_BUFFER_BEFORE,
    after: LEGACY_BUFFER_AFTER,
  };
}

export function getAtomPlaybackRange(atom: KeepAtom, strategy: PlanningStrategy): TimeRange {
  if (
    (strategy === "media_range_v2" || strategy === "occurrence_reanchor_v1") &&
    hasPositiveRange(atom.media_range)
  ) {
    return atom.media_range;
  }
  return atom.time;
}

function normalizeTranscriptWords(transcript?: Transcript | Word[]): Word[] {
  if (!transcript) {
    return [];
  }
  const words = Array.isArray(transcript) ? transcript : transcript.words;
  return words
    .filter((word) => typeof word.start === "number" && typeof word.end === "number" && word.end > word.start)
    .sort((a, b) => a.start - b.start);
}

function getWordRange(word: Word): TimeRange {
  return {
    start: word.source_start ?? word.start,
    end: word.source_end ?? word.end,
  };
}

function clampStartToSpeechBoundary(
  proposedStart: number,
  contentStart: number,
  transcriptWords: Word[]
): number {
  let clamped = proposedStart;
  for (const word of transcriptWords) {
    const range = getWordRange(word);
    if (range.end <= proposedStart) {
      continue;
    }
    if (range.start >= contentStart) {
      break;
    }
    clamped = Math.max(clamped, range.end);
  }
  return Math.min(contentStart, clamped);
}

function clampEndToSpeechBoundary(
  proposedEnd: number,
  contentEnd: number,
  transcriptWords: Word[]
): number {
  let clamped = proposedEnd;
  for (const word of transcriptWords) {
    const range = getWordRange(word);
    if (range.start < contentEnd) {
      continue;
    }
    if (range.start >= proposedEnd) {
      break;
    }
    clamped = Math.min(clamped, range.start);
    break;
  }
  return Math.max(contentEnd, clamped);
}

export function getVideoDuration(inputPath: string): number {
  const result = execFileSync(
    "ffprobe",
    [
      "-v",
      "quiet",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      inputPath,
    ],
    { encoding: "utf-8" }
  );
  return parseFloat(result.trim());
}

export function extractMergedKeepWindows(
  blueprint: Blueprint,
  strategy: PlanningStrategy = "legacy_time"
): KeepWindow[] {
  const keeps = keepAtoms(blueprint)
    .map((atom) => {
      const playback = getAtomPlaybackRange(atom, strategy);
      return {
        atomIds: [atom.id],
        start: playback.start,
        end: playback.end,
        audioSpanId: atom.audio_span_id,
      };
    })
    .sort((a, b) => a.start - b.start);

  const merged: KeepWindow[] = [];
  for (const seg of keeps) {
    const prev = merged[merged.length - 1];
    const sameAudioSpan =
      prev &&
      prev.audioSpanId &&
      seg.audioSpanId &&
      prev.audioSpanId === seg.audioSpanId;
    const canFallbackMerge =
      prev &&
      !prev.audioSpanId &&
      !seg.audioSpanId &&
      seg.start - prev.end < MERGE_GAP_SEC;

    if (sameAudioSpan || canFallbackMerge) {
      prev.end = Math.max(prev.end, seg.end);
      prev.atomIds.push(...seg.atomIds);
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
}

function buildOrderedAtomBoundaries(blueprint: Blueprint): {
  ordered: OrderedAtomBoundary[];
  indexById: Map<number, number>;
} {
  const ordered = allAtoms(blueprint)
    .map((atom) => ({
      id: atom.id,
      start: atom.time.start,
      end: atom.time.end,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id - b.id);

  const indexById = new Map<number, number>();
  for (let index = 0; index < ordered.length; index++) {
    indexById.set(ordered[index].id, index);
  }

  return { ordered, indexById };
}

function clampClipToNeighborAtomBoundaries(
  window: KeepWindow,
  sourceStart: number,
  sourceEnd: number,
  orderedAtoms: OrderedAtomBoundary[],
  atomIndexById: Map<number, number>
): { start: number; end: number } {
  if (window.atomIds.length === 0) {
    return { start: sourceStart, end: sourceEnd };
  }

  let clampedStart = sourceStart;
  let clampedEnd = sourceEnd;

  const firstIndex = atomIndexById.get(window.atomIds[0]);
  if (typeof firstIndex === "number" && firstIndex > 0) {
    const previousAtom = orderedAtoms[firstIndex - 1];
    clampedStart = Math.max(clampedStart, previousAtom.end);
    clampedStart = Math.min(window.start, clampedStart);
  }

  const lastIndex = atomIndexById.get(window.atomIds[window.atomIds.length - 1]);
  if (typeof lastIndex === "number" && lastIndex < orderedAtoms.length - 1) {
    const nextAtom = orderedAtoms[lastIndex + 1];
    clampedEnd = Math.min(clampedEnd, nextAtom.start);
    clampedEnd = Math.max(window.end, clampedEnd);
  }

  return { start: clampedStart, end: clampedEnd };
}

export function buildTimingClips(
  blueprint: Blueprint,
  totalDuration: number,
  mode: "cut_video" | "source_direct",
  strategy: PlanningStrategy = defaultPlanningStrategy(mode),
  transcript?: Transcript | Word[]
): TimingClip[] {
  const windows = extractMergedKeepWindows(blueprint, strategy);
  const orderedAtomBoundaries = buildOrderedAtomBoundaries(blueprint);
  const transcriptWords = normalizeTranscriptWords(transcript);
  const clips: TimingClip[] = [];
  const buffers = getPlannerBuffers(mode);
  let outputOffset = 0;

  for (let index = 0; index < windows.length; index++) {
    const window = windows[index];

    let sourceStart =
      mode === "source_direct"
        ? window.start
        : Math.max(0, window.start - buffers.before);
    if (
      mode !== "source_direct" &&
      index > 0 &&
      (buffers.before > 0 || buffers.after > 0)
    ) {
      const prev = windows[index - 1];
      const gap = window.start - prev.end;
      if (gap < buffers.before + buffers.after) {
        sourceStart = prev.end + gap / 2;
      }
    }

    let sourceEnd = Math.min(totalDuration, window.end + buffers.after);
    if (
      mode !== "source_direct" &&
      index < windows.length - 1 &&
      (buffers.before > 0 || buffers.after > 0)
    ) {
      const next = windows[index + 1];
      const gap = next.start - window.end;
      if (gap < buffers.before + buffers.after) {
        sourceEnd = window.end + gap / 2;
      }
    }

    if (
      mode === "source_direct" &&
      (strategy === "media_range_v2" || strategy === "occurrence_reanchor_v1") &&
      transcriptWords.length > 0
    ) {
      sourceStart = clampStartToSpeechBoundary(sourceStart, window.start, transcriptWords);
      sourceEnd = clampEndToSpeechBoundary(sourceEnd, window.end, transcriptWords);
    }

    if (mode === "source_direct") {
      const next = windows[index + 1];
      const nextKeepGap = next ? next.start - window.end : Number.POSITIVE_INFINITY;
      const endsSentenceLikeUnit =
        !next || nextKeepGap > DIRECT_SENTENCE_BREAK_GAP_SEC;

      if (endsSentenceLikeUnit) {
        // In source_direct mode we let the sentence end own the boundary:
        // no sentence-start pre-roll, only a small sentence-end tail pad.
        sourceEnd = Math.min(
          totalDuration,
          Math.max(sourceEnd, window.end + DIRECT_SENTENCE_END_PAD_SEC)
        );
      }
    }

    const clampedToNeighbors = clampClipToNeighborAtomBoundaries(
      window,
      sourceStart,
      sourceEnd,
      orderedAtomBoundaries.ordered,
      orderedAtomBoundaries.indexById
    );
    sourceStart = clampedToNeighbors.start;
    sourceEnd = clampedToNeighbors.end;

    const clipDuration = sourceEnd - sourceStart;
    clips.push({
      id: `C${index + 1}`,
      source: {
        start: round3(sourceStart),
        end: round3(sourceEnd),
      },
      content: {
        start: round3(window.start),
        end: round3(window.end),
      },
      output: {
        start: round3(outputOffset),
        end: round3(outputOffset + clipDuration),
      },
      atom_ids: [...window.atomIds],
    });
    outputOffset += clipDuration;
  }

  return clips;
}
