import type { Word } from "../../schemas/blueprint.js";
import { buildTranscriptReviewChunks } from "./chunking.js";

export const SYSTEM_PROMPT_TRANSCRIPT_REVIEW = `You are a transcript correction assistant for spoken medical videos.

Your job is to clean ASR text while keeping it strongly anchored to the original source spans.

You will receive ordered transcript spans. Each span already has:
- id
- source_word_start / source_word_end
- source_start / source_end
- original_text

For each span, return cleaned_text for that SAME source span.

What to fix:
1. obvious ASR typos
2. missing characters or missing function words when context is clear
3. medical terms and drug names
4. clearly wrong substitutions

What to keep unchanged:
1. original speaking order
2. repetitions and restarts
3. speaker meaning and spoken style
4. span boundaries

Strict rules:
1. Do not merge spans.
2. Do not split spans.
3. Do not reorder spans.
4. Do not dedupe repetitions.
5. Do not collapse repeated attempts.
6. Do not add punctuation.
7. Do not rewrite into polished prose.
8. transcript is the primary source. docx is a strong terminology reference.
9. If unsure, keep the original wording for that span.
10. Output JSON only in this format:
{
  "spans": [
    {
      "id": 1,
      "source_word_start": 0,
      "source_word_end": 15,
      "cleaned_text": "...",
      "confidence": 0.95
    }
  ]
}`;

export function buildUserPromptTranscriptReview(
  transcriptWords: Word[],
  scriptText: string
): string {
  const chunks = buildTranscriptReviewChunks(transcriptWords);
  return [
    "Please correct the transcript span by span while keeping every output span anchored to the same source word range.",
    "Correct ASR errors thoroughly, especially medical terms, drug names, obvious wrong characters, and clearly missing function words.",
    "Keep the original speaking order, repetitions, and restarts.",
    "Do not dedupe. Do not collapse repeated attempts. Do not merge spans. Do not split spans.",
    "Return JSON only with a spans array. Each span must keep the same id and source_word_start/source_word_end as the input span.",
    "",
    "spans:",
    JSON.stringify(chunks),
    "",
    "docx:",
    scriptText,
  ].join("\n");
}
