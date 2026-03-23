import type {
  ReviewedTokenDocument,
  Transcript,
  Word,
} from "../../schemas/blueprint.js";
import { transcriptToPlainText } from "./chunking.js";
import {
  alignCorrectedChars,
  buildReplacementFromSourceWindow,
  buildReplacementWords,
  buildSummary,
  cloneWords,
  expandWordsToCharWords,
  findAllOccurrences,
  mergeIndicesFromSourceWords,
  opPriority,
  selectPreferredSourceWindow,
  stripWhitespace,
  toChars,
} from "./shared.js";
import type {
  TranscriptReview,
  TranscriptReviewDecision,
  TranscriptReviewEdit,
  TranscriptReviewReport,
  TranscriptReviewSpan,
} from "./types.js";

function buildCorrectedTranscriptFromText(
  transcript: Transcript,
  correctedText: string
): Transcript {
  const originalCharWords = expandWordsToCharWords(transcript.words);
  const originalChars = originalCharWords.map((word) => word.text);
  const correctedChars = toChars(correctedText);
  const mapping = alignCorrectedChars(originalChars, correctedChars);
  const reviewedWords: Word[] = [];

  let previousMappedIndex: number | null = null;
  let correctedIndex = 0;

  while (correctedIndex < correctedChars.length) {
    const mappedIndex = mapping[correctedIndex];
    if (mappedIndex !== null) {
      const sourceWord = originalCharWords[mappedIndex];
      reviewedWords.push({
        ...sourceWord,
        text: correctedChars[correctedIndex],
        synthetic:
          sourceWord.synthetic || sourceWord.text !== correctedChars[correctedIndex]
            ? true
            : undefined,
      });
      previousMappedIndex = mappedIndex;
      correctedIndex += 1;
      continue;
    }

    let runEnd = correctedIndex + 1;
    while (runEnd < correctedChars.length && mapping[runEnd] === null) {
      runEnd += 1;
    }

    const nextMappedIndex = runEnd < correctedChars.length ? mapping[runEnd] : null;
    const runText = correctedChars.slice(correctedIndex, runEnd).join("");
    let start = 0;
    let end = 0;
    let sourceWordIndices: number[] | undefined;
    let sourceStart: number | undefined;
    let sourceEnd: number | undefined;

    if (previousMappedIndex !== null && nextMappedIndex !== null) {
      const prevWord = originalCharWords[previousMappedIndex];
      const nextWord = originalCharWords[nextMappedIndex];
      start = prevWord.end;
      end = nextWord.start;
      if (end <= start) {
        start = prevWord.start;
        end = nextWord.end;
      }
      sourceWordIndices = mergeIndicesFromSourceWords(
        originalCharWords.slice(previousMappedIndex, nextMappedIndex + 1)
      );
      sourceStart = prevWord.source_start ?? prevWord.start;
      sourceEnd = nextWord.source_end ?? nextWord.end;
    } else if (previousMappedIndex !== null) {
      const prevWord = originalCharWords[previousMappedIndex];
      const duration = Math.max(0.05, prevWord.end - prevWord.start) * (runEnd - correctedIndex);
      start = prevWord.end;
      end = Math.min(transcript.duration, start + duration);
      sourceWordIndices = mergeIndicesFromSourceWords([prevWord]);
      sourceStart = prevWord.source_end ?? prevWord.end;
      sourceEnd = prevWord.source_end ?? prevWord.end;
    } else if (nextMappedIndex !== null) {
      const nextWord = originalCharWords[nextMappedIndex];
      const duration = Math.max(0.05, nextWord.end - nextWord.start) * (runEnd - correctedIndex);
      end = nextWord.start;
      start = Math.max(0, end - duration);
      sourceWordIndices = mergeIndicesFromSourceWords([nextWord]);
      sourceStart = nextWord.source_start ?? nextWord.start;
      sourceEnd = nextWord.source_start ?? nextWord.start;
    } else {
      start = 0;
      end = Math.max(0.05 * (runEnd - correctedIndex), 0.05);
    }

    reviewedWords.push(
      ...buildReplacementWords(runText, start, end, {
        sourceWordIndices,
        sourceStart,
        sourceEnd,
        synthetic: true,
      })
    );
    correctedIndex = runEnd;
  }

  return {
    duration: transcript.duration,
    words: reviewedWords,
  };
}

function buildReviewedWordsFromSourceWindow(
  sourceWindow: Word[],
  cleanedText: string,
  sourceWordStart = 0
): Word[] {
  if (sourceWindow.length === 0) {
    return [];
  }

  const originalCharWords = expandWordsToCharWords(sourceWindow, {
    sourceIndexOffset: sourceWordStart,
  });
  const originalChars = originalCharWords.map((word) => word.text);
  const correctedChars = toChars(cleanedText);

  if (correctedChars.length === 0) {
    return cloneWords(originalCharWords);
  }

  const originalText = originalChars.join("");
  if (originalText === cleanedText) {
    return cloneWords(originalCharWords);
  }

  const mapping = alignCorrectedChars(originalChars, correctedChars);
  const reviewedWords: Word[] = [];

  let previousMappedIndex: number | null = null;
  let correctedIndex = 0;

  while (correctedIndex < correctedChars.length) {
    const mappedIndex = mapping[correctedIndex];
    if (mappedIndex !== null) {
      const sourceWord = originalCharWords[mappedIndex];
      reviewedWords.push({
        ...sourceWord,
        text: correctedChars[correctedIndex],
        synthetic:
          sourceWord.synthetic || sourceWord.text !== correctedChars[correctedIndex]
            ? true
            : undefined,
      });
      previousMappedIndex = mappedIndex;
      correctedIndex += 1;
      continue;
    }

    let runEnd = correctedIndex + 1;
    while (runEnd < correctedChars.length && mapping[runEnd] === null) {
      runEnd += 1;
    }

    const nextMappedIndex = runEnd < correctedChars.length ? mapping[runEnd] : null;
    const runText = correctedChars.slice(correctedIndex, runEnd).join("");
    const windowStart = sourceWindow[0].start;
    const windowEnd = sourceWindow[sourceWindow.length - 1].end;
    let start = windowStart;
    let end = windowEnd;
    let sourceWordIndices = mergeIndicesFromSourceWords(sourceWindow);
    let sourceStart = sourceWindow[0].source_start ?? sourceWindow[0].start;
    let sourceEnd = sourceWindow[sourceWindow.length - 1].source_end ?? sourceWindow[sourceWindow.length - 1].end;

    if (previousMappedIndex !== null && nextMappedIndex !== null) {
      const prevWord = originalCharWords[previousMappedIndex];
      const nextWord = originalCharWords[nextMappedIndex];
      start = prevWord.end;
      end = nextWord.start;
      if (end <= start) {
        start = prevWord.start;
        end = nextWord.end;
      }
      sourceWordIndices = mergeIndicesFromSourceWords(
        originalCharWords.slice(previousMappedIndex, nextMappedIndex + 1)
      );
      sourceStart = prevWord.source_start ?? prevWord.start;
      sourceEnd = nextWord.source_end ?? nextWord.end;
    } else if (previousMappedIndex !== null) {
      const prevWord = originalCharWords[previousMappedIndex];
      const duration = Math.max(0.05, prevWord.end - prevWord.start) * (runEnd - correctedIndex);
      start = prevWord.end;
      end = Math.min(windowEnd, start + duration);
      sourceWordIndices = mergeIndicesFromSourceWords([prevWord]);
      sourceStart = prevWord.source_end ?? prevWord.end;
      sourceEnd = prevWord.source_end ?? prevWord.end;
    } else if (nextMappedIndex !== null) {
      const nextWord = originalCharWords[nextMappedIndex];
      const duration = Math.max(0.05, nextWord.end - nextWord.start) * (runEnd - correctedIndex);
      end = nextWord.start;
      start = Math.max(windowStart, end - duration);
      sourceWordIndices = mergeIndicesFromSourceWords([nextWord]);
      sourceStart = nextWord.source_start ?? nextWord.start;
      sourceEnd = nextWord.source_start ?? nextWord.start;
    }

    reviewedWords.push(
      ...buildReplacementWords(runText, start, end, {
        sourceWordIndices,
        sourceStart,
        sourceEnd,
        synthetic: true,
      })
    );
    correctedIndex = runEnd;
  }

  return reviewedWords;
}

function buildCorrectedTranscriptFromSpans(
  transcript: Transcript,
  spans: TranscriptReviewSpan[]
): Transcript {
  const reviewedWords: Word[] = [];
  const sortedSpans = [...spans].sort((a, b) => a.sourceWordStart - b.sourceWordStart);
  let cursor = 0;

  for (const span of sortedSpans) {
    if (span.sourceWordStart > cursor) {
      const untouchedWindow = transcript.words.slice(cursor, span.sourceWordStart);
      reviewedWords.push(
        ...buildReviewedWordsFromSourceWindow(
          untouchedWindow,
          transcriptToPlainText(untouchedWindow),
          cursor
        )
      );
    }

    const sourceWindow = transcript.words.slice(span.sourceWordStart, span.sourceWordEnd + 1);
    if (sourceWindow.length === 0) {
      continue;
    }
    const cleanedText = stripWhitespace(span.cleanedText) || span.originalText;
    reviewedWords.push(
      ...buildReviewedWordsFromSourceWindow(
        sourceWindow,
        cleanedText,
        span.sourceWordStart
      )
    );
    cursor = span.sourceWordEnd + 1;
  }

  if (cursor < transcript.words.length) {
    const untouchedWindow = transcript.words.slice(cursor);
    reviewedWords.push(
      ...buildReviewedWordsFromSourceWindow(
        untouchedWindow,
        transcriptToPlainText(untouchedWindow),
        cursor
      )
    );
  }

  return {
    duration: transcript.duration,
    words: reviewedWords,
  };
}

interface ValidatedCandidate extends TranscriptReviewDecision {
  start: number;
  end: number;
  priority: number;
}

function validateEdit(
  originalText: string,
  edit: TranscriptReviewEdit
): { candidate?: ValidatedCandidate; rejected?: TranscriptReviewDecision } {
  const findChars = toChars(edit.find);
  const replaceText = edit.replace ?? "";
  const occurrences = findAllOccurrences(originalText, edit.find);
  const op = edit.op;

  let message = "";
  if (!edit.find) {
    message = "find is empty";
  } else if (occurrences.length !== 1) {
    message = occurrences.length === 0 ? "find not found in transcript" : "find is not unique";
  } else if (op === "replace_span") {
    if (!replaceText) {
      message = "replace is empty";
    } else if (edit.find === replaceText) {
      message = "find and replace are identical";
    }
  } else if (op === "dedupe_span") {
    if (!replaceText) {
      message = "replace is empty";
    } else if (edit.find === replaceText) {
      message = "find and replace are identical";
    }
  }

  if (message) {
    return {
      rejected: {
        ...edit,
        op,
        status: "rejected",
        message,
      },
    };
  }

  const start = occurrences[0];
  const end = start + findChars.length;
  return {
    candidate: {
      ...edit,
      op,
      status: "accepted",
      message: "accepted",
      matchStart: start,
      matchEnd: end,
      start,
      end,
      priority: opPriority(op),
    },
  };
}

function buildReviewedTokenDocument(transcript: Transcript): ReviewedTokenDocument {
  return {
    duration: transcript.duration,
    text: transcriptToPlainText(transcript.words),
    tokens: transcript.words.map((word, index) => ({
      id: index,
      text: word.text,
      raw_word_indices: word.source_word_indices,
      source_start: word.source_start ?? word.start,
      source_end: word.source_end ?? word.end,
      synthetic: word.synthetic,
    })),
  };
}

export function applyTranscriptReview(
  transcript: Transcript,
  review: TranscriptReview
): {
  reviewedTranscript: Transcript;
  reviewedTokens: ReviewedTokenDocument;
  report: TranscriptReviewReport;
} {
  const originalText = transcriptToPlainText(transcript.words);
  const reviewSpans = (review.spans ?? []).filter((span) => span.cleanedText);
  const correctedText = stripWhitespace(review.correctedText ?? "");

  if (reviewSpans.length > 0) {
    const reviewedTranscript = buildCorrectedTranscriptFromSpans(transcript, reviewSpans);
    const reviewedText = transcriptToPlainText(reviewedTranscript.words);
    const usedReview = reviewedText !== originalText;
    const effectiveTranscript = usedReview ? reviewedTranscript : transcript;

    return {
      reviewedTranscript: effectiveTranscript,
      reviewedTokens: buildReviewedTokenDocument(effectiveTranscript),
      report: {
        reviewMode: usedReview ? "anchored_spans" : "none",
        originalText,
        reviewedText: usedReview ? reviewedText : originalText,
        modelCorrectedText: reviewSpans.map((span) => span.cleanedText).join(""),
        reviewSpans,
        rawModelEdits: review.edits,
        acceptedEdits: [],
        rejectedEdits: [],
        usedReview,
        summary: buildSummary([], []),
      },
    };
  }

  if (correctedText) {
    const reviewedTranscript = buildCorrectedTranscriptFromText(transcript, correctedText);
    const reviewedText = transcriptToPlainText(reviewedTranscript.words);
    const usedReview = reviewedText !== originalText;
    const effectiveTranscript = usedReview ? reviewedTranscript : transcript;

    return {
      reviewedTranscript: effectiveTranscript,
      reviewedTokens: buildReviewedTokenDocument(effectiveTranscript),
      report: {
        reviewMode: usedReview ? "corrected_text" : "none",
        originalText,
        reviewedText: usedReview ? reviewedText : originalText,
        modelCorrectedText: correctedText,
        reviewSpans: [],
        rawModelEdits: review.edits,
        acceptedEdits: [],
        rejectedEdits: [],
        usedReview,
        summary: buildSummary([], []),
      },
    };
  }

  const rawModelEdits = review.edits;
  const rejected: TranscriptReviewDecision[] = [];
  const validated: ValidatedCandidate[] = [];

  for (const edit of rawModelEdits) {
    const result = validateEdit(originalText, edit);
    if (result.rejected) {
      rejected.push(result.rejected);
      continue;
    }
    if (result.candidate) {
      validated.push(result.candidate);
    }
  }

  validated.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (a.find.length !== b.find.length) return a.find.length - b.find.length;
    return a.start - b.start;
  });

  const acceptedWorking: ValidatedCandidate[] = [];
  for (const candidate of validated) {
    const overlap = acceptedWorking.some(
      (item) => Math.min(item.end, candidate.end) > Math.max(item.start, candidate.start)
    );

    if (overlap) {
      rejected.push({
        ...candidate,
        status: "rejected",
        message: "overlaps with a higher-priority patch",
      });
      continue;
    }

    acceptedWorking.push(candidate);
  }

  const acceptedSorted = [...acceptedWorking].sort((a, b) => a.start - b.start);

  if (acceptedSorted.length === 0) {
    return {
      reviewedTranscript: transcript,
      reviewedTokens: buildReviewedTokenDocument(transcript),
      report: {
        reviewMode: "none",
        originalText,
        reviewedText: originalText,
        reviewSpans: [],
        rawModelEdits,
        acceptedEdits: [],
        rejectedEdits: rejected,
        usedReview: false,
        summary: buildSummary([], rejected),
      },
    };
  }

  const charWords = expandWordsToCharWords(transcript.words);
  const reviewedWords = [...charWords];

  for (const edit of [...acceptedSorted].sort((a, b) => b.start - a.start)) {
    const existing = reviewedWords.slice(edit.start, edit.end);
    if (existing.length === 0) {
      continue;
    }

    const replacementText = edit.replace ?? "";
    const preferredSourceWindow =
      edit.op === "delete_span"
        ? null
        : selectPreferredSourceWindow(existing, replacementText);
    const replacementWords =
      edit.op === "delete_span"
        ? []
        : buildReplacementFromSourceWindow(
            replacementText,
            preferredSourceWindow && preferredSourceWindow.length > 0
              ? preferredSourceWindow
              : existing
          );

    reviewedWords.splice(edit.start, edit.end - edit.start, ...replacementWords);
  }

  const reviewedText = transcriptToPlainText(reviewedWords);
  const acceptedEdits = acceptedSorted.map(({ start, end, priority, ...rest }) => rest);

  return {
    reviewedTranscript: {
      duration: transcript.duration,
      words: reviewedWords,
    },
    reviewedTokens: buildReviewedTokenDocument({
      duration: transcript.duration,
      words: reviewedWords,
    }),
    report: {
      reviewMode: "patch_edits",
      originalText,
      reviewedText,
      reviewSpans: [],
      rawModelEdits,
      acceptedEdits,
      rejectedEdits: rejected,
      usedReview: true,
      summary: buildSummary(acceptedEdits, rejected),
    },
  };
}
