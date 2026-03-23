import type { Word } from "../../schemas/blueprint.js";
import { buildTranscriptReviewChunks } from "./chunking.js";
import {
  MAX_FALLBACK_PATCH_EDITS,
  clampConfidence,
  normalizeOp,
  normalizeReason,
  stripWhitespace,
} from "./shared.js";
import type {
  TranscriptReview,
  TranscriptReviewChunk,
  TranscriptReviewSpan,
} from "./types.js";

export function normalizeTranscriptReview(raw: unknown, transcriptWords?: Word[]): TranscriptReview {
  const correctedText = stripWhitespace(
    typeof (raw as any)?.corrected_text === "string" ? (raw as any).corrected_text : ""
  );
  const edits = Array.isArray((raw as any)?.edits) ? (raw as any).edits : [];
  const chunks = transcriptWords ? buildTranscriptReviewChunks(transcriptWords) : [];
  const chunkMap = new Map<number, TranscriptReviewChunk>();
  for (const chunk of chunks) {
    chunkMap.set(chunk.id, chunk);
  }
  const rawSpans = Array.isArray((raw as any)?.spans) ? (raw as any).spans : [];
  const normalizedSpanMap = new Map<number, TranscriptReviewSpan>();

  for (const span of rawSpans) {
    const id = Number(span?.id);
    if (!Number.isInteger(id)) {
      continue;
    }
    const chunk = chunkMap.get(id);
    if (!chunk) {
      continue;
    }
    const cleanedText = stripWhitespace(
      typeof span?.cleaned_text === "string" ? span.cleaned_text : chunk.originalText
    );
    normalizedSpanMap.set(id, {
      id,
      sourceWordStart: chunk.sourceWordStart,
      sourceWordEnd: chunk.sourceWordEnd,
      sourceStart: chunk.sourceStart,
      sourceEnd: chunk.sourceEnd,
      originalText: chunk.originalText,
      cleanedText: cleanedText || chunk.originalText,
      confidence: clampConfidence(span?.confidence),
    });
  }

  return {
    correctedText: correctedText || undefined,
    spans:
      rawSpans.length > 0
        ? chunks.map((chunk) => {
            const existing = normalizedSpanMap.get(chunk.id);
            if (existing) {
              return existing;
            }
            return {
              id: chunk.id,
              sourceWordStart: chunk.sourceWordStart,
              sourceWordEnd: chunk.sourceWordEnd,
              sourceStart: chunk.sourceStart,
              sourceEnd: chunk.sourceEnd,
              originalText: chunk.originalText,
              cleanedText: chunk.originalText,
              confidence: 0,
            };
          })
        : [],
    edits: edits.slice(0, MAX_FALLBACK_PATCH_EDITS).map((edit: any) => {
      const op = normalizeOp(edit?.op);
      const replace = typeof edit?.replace === "string" ? stripWhitespace(edit.replace) : "";
      return {
        op,
        find: stripWhitespace(typeof edit?.find === "string" ? edit.find : ""),
        replace: replace || undefined,
        reason: normalizeReason(op, edit?.reason),
        confidence: clampConfidence(edit?.confidence),
      };
    }),
  };
}
