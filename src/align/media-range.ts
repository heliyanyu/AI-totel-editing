import type { KeepAtom, TimeRange } from "../schemas/blueprint.js";
import type { WordAlignmentResult } from "./index.js";

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function buildMediaRangeFromWords(words: KeepAtom["words"]): TimeRange | undefined {
  if (!words || words.length === 0) return undefined;
  return {
    start: round3(words[0].start),
    end: round3(words[words.length - 1].end),
  };
}

export function buildMediaPayload(
  atom: KeepAtom,
  result: WordAlignmentResult
): {
  mediaRange: TimeRange;
  mediaMode: "words_exact" | "words_projected" | "fallback_time";
  mediaConfidence: number;
  mediaOccurrence: "last_complete" | "last_window" | "fallback_time";
} {
  if (result.mode === "reviewed_exact") {
    const mediaRange = result.timingHint ?? buildMediaRangeFromWords(result.words) ?? atom.time;
    return {
      mediaRange: {
        start: round3(mediaRange.start),
        end: round3(mediaRange.end),
      },
      mediaMode: "words_exact",
      mediaConfidence: 1,
      mediaOccurrence: result.occurrence,
    };
  }

  if (result.mode === "reviewed_projected" && result.timingHint) {
    return {
      mediaRange: {
        start: round3(result.timingHint.start),
        end: round3(result.timingHint.end),
      },
      mediaMode: "words_projected",
      mediaConfidence: round3(result.confidence),
      mediaOccurrence: result.occurrence,
    };
  }

  return {
    mediaRange: {
      start: round3(atom.time.start),
      end: round3(atom.time.end),
    },
    mediaMode: "fallback_time",
    mediaConfidence: round3(result.confidence),
    mediaOccurrence: "fallback_time",
  };
}
