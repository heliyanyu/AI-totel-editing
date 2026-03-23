import type {
  Blueprint,
  KeepAtom,
  TimeRange,
  Transcript,
  Word,
} from "../../schemas/blueprint.js";

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function cloneWord(word: Word): Word {
  return {
    text: word.text,
    start: round3(word.start),
    end: round3(word.end),
    source_word_indices: word.source_word_indices
      ? [...word.source_word_indices]
      : undefined,
    source_start:
      typeof word.source_start === "number" ? round3(word.source_start) : undefined,
    source_end:
      typeof word.source_end === "number" ? round3(word.source_end) : undefined,
    synthetic: word.synthetic,
  };
}

function cloneRange(range: TimeRange): TimeRange {
  return {
    start: round3(range.start),
    end: round3(range.end),
  };
}

function hasValidIds(
  atom: { start_id?: number; end_id?: number },
  transcript: Transcript
): atom is { start_id: number; end_id: number } {
  return (
    typeof atom.start_id === "number" &&
    Number.isInteger(atom.start_id) &&
    typeof atom.end_id === "number" &&
    Number.isInteger(atom.end_id) &&
    atom.start_id >= 0 &&
    atom.end_id >= atom.start_id &&
    atom.end_id < transcript.words.length
  );
}

function applyKeepFallback(atom: KeepAtom): void {
  atom.subtitle_text = atom.subtitle_text ?? atom.text;
  atom.words = atom.words ?? [];
  atom.media_range = atom.media_range ?? cloneRange(atom.time);
}

export function deriveBlueprintAtomsFromTranscript(
  blueprint: Blueprint,
  transcript: Transcript
): Blueprint {
  for (const scene of blueprint.scenes) {
    for (const segment of scene.logic_segments) {
      for (const atom of segment.atoms) {
        if (!hasValidIds(atom, transcript)) {
          if (atom.status === "keep") {
            applyKeepFallback(atom);
          }
          continue;
        }

        const tokenSlice = transcript.words
          .slice(atom.start_id, atom.end_id + 1)
          .map(cloneWord);
        if (tokenSlice.length === 0) {
          if (atom.status === "keep") {
            applyKeepFallback(atom);
          }
          continue;
        }

        const derivedRange = {
          start: round3(tokenSlice[0].start),
          end: round3(tokenSlice[tokenSlice.length - 1].end),
        };
        atom.text = tokenSlice.map((word) => word.text).join("");
        atom.time = cloneRange(derivedRange);

        if (atom.status === "keep") {
          atom.words = tokenSlice;
          atom.subtitle_text = atom.text;
          atom.media_range = cloneRange(derivedRange);
        }
      }
    }
  }

  return blueprint;
}
