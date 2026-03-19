import { join } from "path";
import { writeFileSync } from "fs";
import type { Blueprint, KeepAtom, TimingMap, TimingSegment, TimeRange } from "../schemas/blueprint.js";
import { keepAtoms } from "../schemas/blueprint.js";
import type {
  TimingValidationIssue,
  TimingValidationReport,
} from "../schemas/workflow.js";

const EPSILON = 0.001;
const OVERLAP_WARN_THRESHOLD = 0.3;

function pushIssue(
  issues: TimingValidationIssue[],
  issue: TimingValidationIssue
): void {
  issues.push(issue);
}

function hasPositiveRange(start: number, end: number): boolean {
  return typeof start === "number" && typeof end === "number" && end - start > EPSILON;
}

function atomPlaybackRange(atom: KeepAtom, mode: "cut_video" | "source_direct"): TimeRange {
  if (mode === "source_direct" && atom.media_range && hasPositiveRange(atom.media_range.start, atom.media_range.end)) {
    return atom.media_range;
  }
  return atom.time;
}

function isKeepOverlap(a: KeepAtom, b: KeepAtom, mode: "cut_video" | "source_direct"): number {
  const ar = atomPlaybackRange(a, mode);
  const br = atomPlaybackRange(b, mode);
  return Math.min(ar.end, br.end) - Math.max(ar.start, br.start);
}

export function validateTimingPlan(
  blueprint: Blueprint,
  timingMap: TimingMap
): TimingValidationReport {
  const issues: TimingValidationIssue[] = [];
  const mode = timingMap.mode ?? "cut_video";
  const clips = timingMap.clips ?? [];
  const keeps = keepAtoms(blueprint).sort((a, b) => atomPlaybackRange(a, mode).start - atomPlaybackRange(b, mode).start);
  const keepIds = new Set(keeps.map((atom) => atom.id));
  const segmentMap = new Map<number, TimingSegment[]>();

  for (const segment of timingMap.segments) {
    const arr = segmentMap.get(segment.atom_id) ?? [];
    arr.push(segment);
    segmentMap.set(segment.atom_id, arr);

    if (!hasPositiveRange(segment.original.start, segment.original.end)) {
      pushIssue(issues, {
        code: "invalid_segment_original_range",
        severity: "error",
        message: `atom ${segment.atom_id} 的 original 时间范围无效 (${segment.original.start} - ${segment.original.end})`,
        atom_id: segment.atom_id,
      });
    }

    if (!hasPositiveRange(segment.output.start, segment.output.end)) {
      pushIssue(issues, {
        code: "invalid_segment_output_range",
        severity: "error",
        message: `atom ${segment.atom_id} 的 output 时间范围无效 (${segment.output.start} - ${segment.output.end})`,
        atom_id: segment.atom_id,
      });
    }

    if (!keepIds.has(segment.atom_id)) {
      pushIssue(issues, {
        code: "orphan_timing_segment",
        severity: "warn",
        message: `timing_map.segment 引用了非 keep atom ${segment.atom_id}`,
        atom_id: segment.atom_id,
      });
    }
  }

  for (const atom of keeps) {
    if (!hasPositiveRange(atom.time.start, atom.time.end)) {
      pushIssue(issues, {
        code: "invalid_keep_atom_semantic_range",
        severity: "error",
        message: `keep atom ${atom.id} 的 semantic time 无效 (${atom.time.start} - ${atom.time.end})`,
        atom_id: atom.id,
      });
    }

    if (mode === "source_direct") {
      if (!atom.media_range) {
        pushIssue(issues, {
          code: "missing_media_range",
          severity: "warn",
          message: `keep atom ${atom.id} 缺少 media_range，已退回 atom.time`,
          atom_id: atom.id,
        });
      } else if (!hasPositiveRange(atom.media_range.start, atom.media_range.end)) {
        pushIssue(issues, {
          code: "invalid_media_range",
          severity: "error",
          message: `keep atom ${atom.id} 的 media_range 无效 (${atom.media_range.start} - ${atom.media_range.end})`,
          atom_id: atom.id,
        });
      }
    }

    const playback = atomPlaybackRange(atom, mode);
    if (!hasPositiveRange(playback.start, playback.end)) {
      pushIssue(issues, {
        code: "invalid_keep_atom_playback_range",
        severity: "error",
        message: `keep atom ${atom.id} 的 playback range 无效 (${playback.start} - ${playback.end})`,
        atom_id: atom.id,
      });
    }

    const mapped = segmentMap.get(atom.id) ?? [];
    if (mapped.length === 0) {
      pushIssue(issues, {
        code: "missing_timing_segment",
        severity: "error",
        message: `keep atom ${atom.id} 缺少 timing_map.segment`,
        atom_id: atom.id,
      });
    }
    if (mapped.length > 1) {
      pushIssue(issues, {
        code: "duplicate_timing_segment",
        severity: "error",
        message: `keep atom ${atom.id} 对应了 ${mapped.length} 个 timing_map.segment`,
        atom_id: atom.id,
      });
    }
  }

  for (let i = 1; i < keeps.length; i++) {
    const overlap = isKeepOverlap(keeps[i - 1], keeps[i], mode);
    if (overlap > OVERLAP_WARN_THRESHOLD) {
      pushIssue(issues, {
        code: "keep_atom_overlap",
        severity: "warn",
        message: `keep atom ${keeps[i - 1].id} 与 ${keeps[i].id} 在播放时间上重叠 ${overlap.toFixed(3)}s`,
        atom_id: keeps[i].id,
      });
    }
  }

  const sortedSegments = [...timingMap.segments].sort(
    (a, b) => a.output.start - b.output.start
  );
  for (let i = 1; i < sortedSegments.length; i++) {
    const prev = sortedSegments[i - 1];
    const curr = sortedSegments[i];
    const overlap = prev.output.end - curr.output.start;
    if (overlap > OVERLAP_WARN_THRESHOLD) {
      pushIssue(issues, {
        code: "output_segment_overlap",
        severity: "warn",
        message: `output segment ${prev.atom_id} 与 ${curr.atom_id} 重叠 ${overlap.toFixed(3)}s`,
        atom_id: curr.atom_id,
      });
    }
  }

  if (mode === "source_direct" && keeps.length > 0 && clips.length === 0) {
    pushIssue(issues, {
      code: "missing_clips",
      severity: "error",
      message: "timing_map 缺少 clips，无法驱动 source_direct 渲染",
    });
  }

  let previousClipOutputEnd = 0;
  for (const clip of clips) {
    if (!hasPositiveRange(clip.source.start, clip.source.end)) {
      pushIssue(issues, {
        code: "invalid_clip_source_range",
        severity: "error",
        message: `clip ${clip.id} 的 source 时间范围无效`,
        clip_id: clip.id,
      });
    }
    if (!hasPositiveRange(clip.content.start, clip.content.end)) {
      pushIssue(issues, {
        code: "invalid_clip_content_range",
        severity: "error",
        message: `clip ${clip.id} 的 content 时间范围无效`,
        clip_id: clip.id,
      });
    }
    if (!hasPositiveRange(clip.output.start, clip.output.end)) {
      pushIssue(issues, {
        code: "invalid_clip_output_range",
        severity: "error",
        message: `clip ${clip.id} 的 output 时间范围无效`,
        clip_id: clip.id,
      });
    }
    if (clip.content.start < clip.source.start - EPSILON || clip.content.end > clip.source.end + EPSILON) {
      pushIssue(issues, {
        code: "clip_content_outside_source",
        severity: "warn",
        message: `clip ${clip.id} 的 content 不完全落在 source 范围内`,
        clip_id: clip.id,
      });
    }
    if (clip.output.start + EPSILON < previousClipOutputEnd) {
      pushIssue(issues, {
        code: "clip_output_out_of_order",
        severity: "error",
        message: `clip ${clip.id} 的 output 起点早于前一 clip 终点`,
        clip_id: clip.id,
      });
    }
    previousClipOutputEnd = Math.max(previousClipOutputEnd, clip.output.end);

    if (clip.atom_ids.length === 0) {
      pushIssue(issues, {
        code: "clip_without_atoms",
        severity: "warn",
        message: `clip ${clip.id} 没有关联任何 keep atom`,
        clip_id: clip.id,
      });
    }

    for (const atomId of clip.atom_ids) {
      if (!keepIds.has(atomId)) {
        pushIssue(issues, {
          code: "clip_contains_non_keep_atom",
          severity: "warn",
          message: `clip ${clip.id} 引用了非 keep atom ${atomId}`,
          clip_id: clip.id,
          atom_id: atomId,
        });
      }
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warnCount = issues.filter((issue) => issue.severity === "warn").length;

  return {
    summary: {
      mode,
      keep_atom_count: keeps.length,
      clip_count: clips.length,
      segment_count: timingMap.segments.length,
      error_count: errorCount,
      warn_count: warnCount,
      generated_at: new Date().toISOString(),
    },
    issues,
  };
}

export function hasBlockingTimingIssues(report: TimingValidationReport): boolean {
  return report.summary.error_count > 0;
}

export function formatTimingValidationFailures(report: TimingValidationReport): string {
  return report.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => `- [${issue.code}] ${issue.message}`)
    .join("\n");
}

export function writeTimingValidationReport(
  outputDir: string,
  report: TimingValidationReport
): string {
  const reportPath = join(outputDir, "timing_validation_report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
  return reportPath;
}
