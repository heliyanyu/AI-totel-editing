export type TranscriptReviewOp = "replace_span" | "delete_span" | "dedupe_span";

export interface TranscriptReviewEdit {
  op: TranscriptReviewOp;
  find: string;
  replace?: string;
  reason: string;
  confidence: number;
}

export interface TranscriptReviewSpan {
  id: number;
  sourceWordStart: number;
  sourceWordEnd: number;
  sourceStart: number;
  sourceEnd: number;
  originalText: string;
  cleanedText: string;
  confidence: number;
}

export interface TranscriptReview {
  correctedText?: string;
  spans?: TranscriptReviewSpan[];
  edits: TranscriptReviewEdit[];
}

export interface TranscriptReviewDecision extends TranscriptReviewEdit {
  status: "accepted" | "rejected";
  message: string;
  matchStart?: number;
  matchEnd?: number;
}

export interface TranscriptReviewSummary {
  replaceCount: number;
  deleteCount: number;
  dedupeCount: number;
  acceptedCount: number;
  rejectedCount: number;
}

export interface TranscriptReviewReport {
  reviewMode: "anchored_spans" | "corrected_text" | "patch_edits" | "none";
  originalText: string;
  reviewedText: string;
  modelCorrectedText?: string;
  reviewSpans?: TranscriptReviewSpan[];
  rawModelEdits: TranscriptReviewEdit[];
  acceptedEdits: TranscriptReviewDecision[];
  rejectedEdits: TranscriptReviewDecision[];
  usedReview: boolean;
  summary: TranscriptReviewSummary;
}

export interface TranscriptReviewChunk {
  id: number;
  sourceWordStart: number;
  sourceWordEnd: number;
  sourceStart: number;
  sourceEnd: number;
  originalText: string;
}
