import { writeFileSync } from "fs";
import { join } from "path";
import { alignWords } from "../align/index.js";
import type { Blueprint, KeepAtom, TimeRange, Transcript, Word } from "../schemas/blueprint.js";

interface ReanchorDebugEntry {
  sceneId: string;
  segmentId: string;
  segmentText: string;
  segmentMode: "reviewed_exact" | "reviewed_projected" | "static_fallback";
  segmentConfidence: number;
  segmentRange?: TimeRange;
  atomId: number;
  atomText: string;
  atomMode: "reviewed_exact" | "reviewed_projected" | "static_fallback";
  atomConfidence: number;
  atomRangeBefore?: TimeRange;
  atomRangeAfter?: TimeRange;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function cloneRange(range: TimeRange | undefined): TimeRange | undefined {
  if (!range) return undefined;
  return { start: round3(range.start), end: round3(range.end) };
}

function overlappingWords(words: Word[], range: TimeRange, padding = 0.35): Word[] {
  const start = range.start - padding;
  const end = range.end + padding;
  return words.filter((word) => word.end > start && word.start < end);
}

function mediaModeFromAlignment(
  mode: "reviewed_exact" | "reviewed_projected" | "static_fallback"
): "words_exact" | "words_projected" | "fallback_time" {
  if (mode === "reviewed_exact") return "words_exact";
  if (mode === "reviewed_projected") return "words_projected";
  return "fallback_time";
}

export function reanchorBlueprintOccurrences(
  blueprint: Blueprint,
  transcript: Transcript,
  options?: { debugDir?: string }
): Blueprint {
  const debug: ReanchorDebugEntry[] = [];

  for (const scene of blueprint.scenes) {
    for (const segment of scene.logic_segments) {
      const keepAtoms = segment.atoms.filter((atom): atom is KeepAtom => atom.status === "keep");
      if (keepAtoms.length === 0) {
        continue;
      }

      const segmentText = keepAtoms.map((atom) => atom.subtitle_text ?? atom.text).join("");
      const segmentMatch = alignWords(segmentText, transcript.words);
      const segmentRange = segmentMatch.timingHint;
      const localWords =
        segmentRange && segmentMatch.mode !== "static_fallback"
          ? overlappingWords(transcript.words, segmentRange)
          : transcript.words;

      for (const atom of keepAtoms) {
        const before = cloneRange(atom.media_range ?? atom.time);
        const atomText = atom.subtitle_text ?? atom.text;
        const atomMatch = alignWords(atomText, localWords);

        if (atomMatch.mode !== "static_fallback" && atomMatch.timingHint) {
          atom.media_range = {
            start: round3(atomMatch.timingHint.start),
            end: round3(atomMatch.timingHint.end),
          };
          atom.media_mode = mediaModeFromAlignment(atomMatch.mode);
          atom.media_confidence = round3(atomMatch.confidence);
          atom.media_occurrence = atomMatch.occurrence;
        }

        debug.push({
          sceneId: scene.id,
          segmentId: segment.id,
          segmentText,
          segmentMode: segmentMatch.mode,
          segmentConfidence: round3(segmentMatch.confidence),
          segmentRange: segmentRange
            ? {
                start: round3(segmentRange.start),
                end: round3(segmentRange.end),
              }
            : undefined,
          atomId: atom.id,
          atomText,
          atomMode: atomMatch.mode,
          atomConfidence: round3(atomMatch.confidence),
          atomRangeBefore: before,
          atomRangeAfter: cloneRange(atom.media_range ?? atom.time),
        });
      }
    }
  }

  if (options?.debugDir) {
    writeFileSync(
      join(options.debugDir, "occurrence_reanchor_debug.json"),
      JSON.stringify(debug, null, 2),
      "utf-8"
    );
  }

  return blueprint;
}
