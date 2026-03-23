import type { Word } from "../../schemas/blueprint.js";
import type { TranscriptReviewChunk } from "./types.js";
import { round3 } from "./shared.js";

export function transcriptToPlainText(words: Word[]): string {
  return words.map((word) => word.text).join("");
}

export function buildTranscriptReviewChunks(words: Word[]): TranscriptReviewChunk[] {
  const chunks: TranscriptReviewChunk[] = [];
  if (words.length === 0) {
    return chunks;
  }

  const MAX_CHUNK_WORDS = 56;
  const MAX_CHUNK_DURATION = 10;
  const GAP_BREAK_SEC = 0.55;
  const MIN_CHUNK_WORDS = 18;

  let start = 0;
  while (start < words.length) {
    let end = start;
    const first = words[start];

    while (end + 1 < words.length) {
      const next = words[end + 1];
      const chunkWordCount = end - start + 1;
      const duration = words[end].end - first.start;
      const gap = next.start - words[end].end;

      const hitGapBreak = gap > GAP_BREAK_SEC && chunkWordCount >= MIN_CHUNK_WORDS;
      const hitWordLimit = chunkWordCount >= MAX_CHUNK_WORDS;
      const hitDurationLimit = duration >= MAX_CHUNK_DURATION && chunkWordCount >= MIN_CHUNK_WORDS;

      if (hitGapBreak || hitWordLimit || hitDurationLimit) {
        break;
      }
      end += 1;
    }

    const slice = words.slice(start, end + 1);
    chunks.push({
      id: chunks.length + 1,
      sourceWordStart: start,
      sourceWordEnd: end,
      sourceStart: round3(slice[0].source_start ?? slice[0].start),
      sourceEnd: round3(slice[slice.length - 1].source_end ?? slice[slice.length - 1].end),
      originalText: transcriptToPlainText(slice),
    });
    start = end + 1;
  }

  return chunks;
}
