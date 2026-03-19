import type { Blueprint } from "./blueprint.js";

export type ReviewIssueTag =
  | "template"
  | "items"
  | "scene_title"
  | "view"
  | "discard"
  | "timing"
  | "template_props"
  | "other";

export type SegmentReviewStatus =
  | "todo"
  | "accepted"
  | "needs_edit"
  | "accepted_after_edit";

export type JobReviewStatus = "in_review" | "finalized";
export type RenderJobStatus = "idle" | "rendering" | "done" | "error";
export type RenderMode = "cut_video" | "source_direct";
export type PlanningStrategy =
  | "legacy_time"
  | "media_range_v2"
  | "occurrence_reanchor_v1";
export type Step2DiagnosticSeverity = "info" | "warn";
export type TimingValidationSeverity = "error" | "warn";

export interface SegmentReviewState {
  review_status: SegmentReviewStatus;
  issue_tags: ReviewIssueTag[];
  note: string;
  updated_at: string | null;
}

export interface RenderState {
  status: RenderJobStatus;
  output_path: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface ReviewState {
  job_status: JobReviewStatus;
  finalized_at: string | null;
  finalized_snapshot_hash: string | null;
  last_saved_hash: string | null;
  render: RenderState;
  segments: Record<string, SegmentReviewState>;
}

export interface Step2DiagnosticIssue {
  code: string;
  severity: Step2DiagnosticSeverity;
  message: string;
  field?: string;
}

export interface Step2SegmentDiagnostics {
  scene_id: string;
  segment_id: string;
  template: string;
  view: string;
  keep_atom_count: number;
  discard_atom_count: number;
  item_count: number;
  fallback: boolean;
  issues: Step2DiagnosticIssue[];
}

export interface Step2DiagnosticsSummary {
  segment_count: number;
  flagged_segment_count: number;
  warn_count: number;
  info_count: number;
  generated_at: string;
}

export interface Step2Diagnostics {
  summary: Step2DiagnosticsSummary;
  segments: Record<string, Step2SegmentDiagnostics>;
}

export interface TimingValidationIssue {
  code: string;
  severity: TimingValidationSeverity;
  message: string;
  atom_id?: number;
  clip_id?: string;
}

export interface TimingValidationSummary {
  mode: RenderMode;
  keep_atom_count: number;
  clip_count: number;
  segment_count: number;
  error_count: number;
  warn_count: number;
  generated_at: string;
}

export interface TimingValidationReport {
  summary: TimingValidationSummary;
  issues: TimingValidationIssue[];
}

export interface ReviewSummary {
  total: number;
  todo: number;
  accepted: number;
  needs_edit: number;
  accepted_after_edit: number;
}

export interface JobManifest {
  jobDir: string;
  sourceVideoPath: string;
  sourceScriptPath: string | null;
  createdAt: string;
  model: string;
  step1Provider?: "anthropic" | "openai";
  step1Model?: string | null;
  takePassProvider?: "anthropic" | "openai";
  takePassModel?: string | null;
  renderMode: RenderMode;
  planningStrategy: PlanningStrategy;
  transcriptPath: string;
  blueprintPath: string;
  timingMapPath: string;
  cutVideoPath: string | null;
  resultPath: string | null;
}

function defaultSegmentReviewState(): SegmentReviewState {
  return {
    review_status: "todo",
    issue_tags: [],
    note: "",
    updated_at: null,
  };
}

export function createEmptyRenderState(): RenderState {
  return {
    status: "idle",
    output_path: null,
    started_at: null,
    finished_at: null,
    error: null,
  };
}

export function ensureReviewState(
  reviewState: ReviewState | null | undefined,
  blueprint: Blueprint
): ReviewState {
  const next: ReviewState = {
    job_status: reviewState?.job_status ?? "in_review",
    finalized_at: reviewState?.finalized_at ?? null,
    finalized_snapshot_hash: reviewState?.finalized_snapshot_hash ?? null,
    last_saved_hash: reviewState?.last_saved_hash ?? null,
    render: reviewState?.render ?? createEmptyRenderState(),
    segments: {},
  };

  for (const scene of blueprint.scenes) {
    for (const segment of scene.logic_segments) {
      next.segments[segment.id] = reviewState?.segments?.[segment.id]
        ? {
            review_status: reviewState.segments[segment.id].review_status,
            issue_tags: [...reviewState.segments[segment.id].issue_tags],
            note: reviewState.segments[segment.id].note,
            updated_at: reviewState.segments[segment.id].updated_at,
          }
        : defaultSegmentReviewState();
    }
  }

  return next;
}

export function summarizeReviewState(
  reviewState: ReviewState | null | undefined
): ReviewSummary {
  const summary: ReviewSummary = {
    total: 0,
    todo: 0,
    accepted: 0,
    needs_edit: 0,
    accepted_after_edit: 0,
  };

  if (!reviewState) {
    return summary;
  }

  for (const entry of Object.values(reviewState.segments)) {
    summary.total += 1;
    switch (entry.review_status) {
      case "todo":
        summary.todo += 1;
        break;
      case "accepted":
        summary.accepted += 1;
        break;
      case "needs_edit":
        summary.needs_edit += 1;
        break;
      case "accepted_after_edit":
        summary.accepted_after_edit += 1;
        break;
    }
  }

  return summary;
}


