/**
 * Zustand Store — Blueprint 编辑器状态管理
 *
 * 管理 Blueprint、工作区元信息、timing_map、transcript、Step2 diagnostics、review_state
 * 以及定稿 / 渲染动作。
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  ReviewIssueTag,
  ReviewState,
  SegmentReviewState,
  SegmentReviewStatus,
  Step2Diagnostics,
  Step2SegmentDiagnostics,
  ReviewSummary,
} from "@schemas/workflow";

export interface TimeRange {
  start: number;
  end: number;
}

export interface Word {
  text: string;
  start: number;
  end: number;
  source_word_indices?: number[];
  source_start?: number;
  source_end?: number;
  synthetic?: boolean;
}

export interface Transcript {
  duration: number;
  words: Word[];
}

export interface TimingSegment {
  atom_id: number;
  original: TimeRange;
  output: TimeRange;
}

export interface TimingClip {
  id: string;
  source: TimeRange;
  content: TimeRange;
  output: TimeRange;
  atom_ids: number[];
}

export interface TimingMap {
  mode?: "cut_video" | "source_direct";
  segments: TimingSegment[];
  clips?: TimingClip[];
  totalDuration: number;
}

export interface JobMeta {
  jobDir: string;
  jobName: string;
  hasTimingMap: boolean;
  hasTranscript: boolean;
  hasCutVideo: boolean;
  hasResultVideo: boolean;
  hasReviewState: boolean;
  hasStep2Diagnostics: boolean;
  hasBlueprintFinal: boolean;
  hasJobManifest: boolean;
  hasTimingValidationReport: boolean;
  renderMode: "cut_video" | "source_direct";
  planningStrategy: "legacy_time" | "media_range_v2" | "occurrence_reanchor_v1";
  sourceVideoReady: boolean;
  timingValidationErrors: number;
  timingValidationWarnings: number;
  isTimingHealthy: boolean;
  isFinalStale: boolean;
  isRenderable: boolean;
  sourceVideoPath: string | null;
  sourceScriptPath: string | null;
  jobStatus: string;
  renderStatus: string;
  reviewSummary: ReviewSummary;
  media: {
    sourceVideoUrl: string | null;
    cutVideoUrl: string | null;
    resultVideoUrl: string | null;
  };
}

export interface BlueprintItem {
  text: string;
  emoji?: string;
}

export interface KeepAtom {
  id: number;
  text: string;
  time: TimeRange;
  status: "keep";
  words?: Word[];
  subtitle_text?: string;
  alignment_mode?: "reviewed_exact" | "reviewed_projected" | "static_fallback";
  alignment_confidence?: number;
  media_range?: TimeRange;
  media_mode?: "words_exact" | "words_projected" | "fallback_time";
  media_confidence?: number;
  media_occurrence?: "last_complete" | "last_window" | "fallback_time";
}

export interface DiscardAtom {
  id: number;
  text: string;
  time: TimeRange;
  status: "discard";
  reason: string;
}

export type BlueprintAtom = KeepAtom | DiscardAtom;

export interface LogicSegment {
  id: string;
  transition_type: string;
  template: string;
  items: BlueprintItem[];
  atoms: BlueprintAtom[];
  template_props?: Record<string, unknown>;
}

export interface BlueprintScene {
  id: string;
  title: string;
  view: "overlay" | "graphics";
  logic_segments: LogicSegment[];
}

export interface Blueprint {
  title: string;
  scenes: BlueprintScene[];
}

export type ReviewFilter = "all" | SegmentReviewStatus;

interface EditorState {
  blueprint: Blueprint | null;
  meta: JobMeta | null;
  timingMap: TimingMap | null;
  transcript: Transcript | null;
  step2Diagnostics: Step2Diagnostics | null;
  reviewState: ReviewState | null;
  reviewFilter: ReviewFilter;
  isDirty: boolean;
  selectedSceneId: string | null;
  selectedSegmentId: string | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  finalizeStatus: "idle" | "finalizing" | "done" | "error";
  renderStatus: "idle" | "rendering" | "done" | "error";
  keepAtomBackup: Record<number, KeepAtom>;

  loadBlueprint: () => Promise<void>;
  saveBlueprint: () => Promise<void>;
  finalizeBlueprint: () => Promise<void>;
  triggerRender: () => Promise<void>;

  selectSegment: (segmentId: string) => void;
  setReviewFilter: (filter: ReviewFilter) => void;
  setReviewStatus: (segmentId: string, status: SegmentReviewStatus) => void;
  toggleIssueTag: (segmentId: string, tag: ReviewIssueTag) => void;
  updateReviewNote: (segmentId: string, note: string) => void;

  updateSceneTitle: (sceneId: string, title: string) => void;
  changeSceneView: (sceneId: string, view: BlueprintScene["view"]) => void;
  updateTransitionType: (segmentId: string, transitionType: string) => void;
  updateTemplateProp: (segmentId: string, key: string, value: unknown) => void;
  removeTemplateProp: (segmentId: string, key: string) => void;

  toggleAtomStatus: (segmentId: string, atomId: number) => void;
  changeTemplate: (segmentId: string, template: string) => void;
  updateItem: (
    segmentId: string,
    index: number,
    text: string,
    emoji?: string
  ) => void;
  addItem: (segmentId: string, text: string, emoji?: string) => void;
  removeItem: (segmentId: string, index: number) => void;
  moveItem: (segmentId: string, index: number, direction: -1 | 1) => void;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) {
    return null;
  }
  return (await res.json()) as T;
}

function findSegment(
  blueprint: Blueprint | null,
  segmentId: string
): { scene: BlueprintScene; segment: LogicSegment } | null {
  if (!blueprint) return null;
  for (const scene of blueprint.scenes) {
    for (const seg of scene.logic_segments) {
      if (seg.id === segmentId) {
        return { scene, segment: seg };
      }
    }
  }
  return null;
}

function findScene(blueprint: Blueprint | null, sceneId: string): BlueprintScene | null {
  if (!blueprint) return null;
  return blueprint.scenes.find((scene) => scene.id === sceneId) ?? null;
}

function ensureReviewEntry(reviewState: ReviewState | null, segmentId: string): SegmentReviewState | null {
  if (!reviewState) return null;
  const existing = reviewState.segments[segmentId];
  if (existing) return existing;
  reviewState.segments[segmentId] = {
    review_status: "todo",
    issue_tags: [],
    note: "",
    updated_at: null,
  };
  return reviewState.segments[segmentId];
}

function markSegmentEdited(state: EditorState, segmentId: string) {
  const entry = ensureReviewEntry(state.reviewState, segmentId);
  if (!entry) return;
  if (entry.review_status === "accepted") {
    entry.review_status = "accepted_after_edit";
  }
  entry.updated_at = new Date().toISOString();
}

function syncRenderStatus(reviewState: ReviewState | null): EditorState["renderStatus"] {
  const status = reviewState?.render.status;
  if (status === "rendering") return "rendering";
  if (status === "done") return "done";
  if (status === "error") return "error";
  return "idle";
}

function scheduleStatusReset(
  setter: (cb: (state: EditorState) => void) => void,
  key: "saveStatus" | "finalizeStatus",
  value: "saved" | "done"
) {
  setTimeout(() => {
    setter((state) => {
      if (state[key] === value) {
        state[key] = "idle" as never;
      }
    });
  }, 1800);
}

function atomMediaRange(atom: BlueprintAtom): TimeRange {
  if (atom.status === "keep" && atom.media_range) {
    return atom.media_range;
  }
  return atom.time;
}
function startRenderPolling(get: () => EditorState, set: (cb: (state: EditorState) => void) => void) {
  const poll = async () => {
    const reviewState = await fetchJson<ReviewState>("/api/review-state");
    const meta = await fetchJson<JobMeta>("/api/meta");
    if (!reviewState || !meta) {
      return;
    }

    set((state) => {
      state.reviewState = reviewState;
      state.meta = meta;
      state.renderStatus = syncRenderStatus(reviewState);
    });

    if (reviewState.render.status === "rendering") {
      window.setTimeout(poll, 3000);
    }
  };

  const state = get();
  if (state.renderStatus === "rendering") {
    window.setTimeout(poll, 3000);
  }
}

export const useEditorStore = create<EditorState>()(
  immer((set, get) => ({
    blueprint: null,
    meta: null,
    timingMap: null,
    transcript: null,
    step2Diagnostics: null,
    reviewState: null,
    reviewFilter: "all",
    isDirty: false,
    selectedSceneId: null,
    selectedSegmentId: null,
    saveStatus: "idle",
    finalizeStatus: "idle",
    renderStatus: "idle",
    keepAtomBackup: {},

    loadBlueprint: async () => {
      try {
        const [meta, bp, diagnostics, reviewState] = await Promise.all([
          fetchJson<JobMeta>("/api/meta"),
          fetchJson<Blueprint>("/api/blueprint"),
          fetchJson<Step2Diagnostics>("/api/step2-diagnostics"),
          fetchJson<ReviewState>("/api/review-state"),
        ]);

        if (!bp) {
          throw new Error("Failed to load blueprint");
        }

        const [timingMap, transcript] = await Promise.all([
          meta?.hasTimingMap ? fetchJson<TimingMap>("/api/timing-map") : Promise.resolve(null),
          meta?.hasTranscript ? fetchJson<Transcript>("/api/transcript") : Promise.resolve(null),
        ]);

        set((state) => {
          state.blueprint = bp;
          state.meta = meta;
          state.timingMap = timingMap;
          state.transcript = transcript;
          state.step2Diagnostics = diagnostics;
          state.reviewState = reviewState;
          state.renderStatus = syncRenderStatus(reviewState);
          state.isDirty = false;
          if (bp.scenes.length > 0 && bp.scenes[0].logic_segments.length > 0) {
            state.selectedSceneId = bp.scenes[0].id;
            state.selectedSegmentId = bp.scenes[0].logic_segments[0].id;
          }
        });

        if (reviewState?.render.status === "rendering") {
          startRenderPolling(get, set);
        }
      } catch (err) {
        console.error("Failed to load editor data:", err);
      }
    },

    saveBlueprint: async () => {
      const bp = get().blueprint;
      const reviewState = get().reviewState;
      if (!bp) return;

      set((state) => {
        state.saveStatus = "saving";
      });

      try {
        const bpRes = await fetch("/api/blueprint", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bp),
        });
        if (!bpRes.ok) {
          throw new Error(`Save failed: ${bpRes.status}`);
        }

        if (reviewState) {
          const reviewRes = await fetch("/api/review-state", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reviewState),
          });
          if (!reviewRes.ok) {
            throw new Error(`Review save failed: ${reviewRes.status}`);
          }
        }

        const [meta, nextReviewState] = await Promise.all([
          fetchJson<JobMeta>("/api/meta"),
          fetchJson<ReviewState>("/api/review-state"),
        ]);

        set((state) => {
          state.meta = meta;
          state.reviewState = nextReviewState;
          state.renderStatus = syncRenderStatus(nextReviewState);
          state.isDirty = false;
          state.saveStatus = "saved";
        });
        scheduleStatusReset(set, "saveStatus", "saved");
      } catch (err) {
        console.error(err);
        set((state) => {
          state.saveStatus = "error";
        });
      }
    },

    finalizeBlueprint: async () => {
      if (get().isDirty) {
        await get().saveBlueprint();
      }

      set((state) => {
        state.finalizeStatus = "finalizing";
      });

      try {
        const res = await fetch("/api/finalize", { method: "POST" });
        if (!res.ok) {
          throw new Error(`Finalize failed: ${res.status}`);
        }
        const payload = (await res.json()) as {
          reviewState: ReviewState;
          meta: JobMeta;
        };

        set((state) => {
          state.reviewState = payload.reviewState;
          state.meta = payload.meta;
          state.renderStatus = syncRenderStatus(payload.reviewState);
          state.finalizeStatus = "done";
          state.isDirty = false;
        });
        scheduleStatusReset(set, "finalizeStatus", "done");
      } catch (err) {
        console.error(err);
        set((state) => {
          state.finalizeStatus = "error";
        });
      }
    },

    triggerRender: async () => {
      if (get().isDirty) {
        await get().saveBlueprint();
      }

      set((state) => {
        state.renderStatus = "rendering";
      });

      try {
        const res = await fetch("/api/render", { method: "POST" });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({ error: `Render failed: ${res.status}` }))) as {
            error?: string;
          };
          throw new Error(payload.error || `Render failed: ${res.status}`);
        }

        const [meta, reviewState] = await Promise.all([
          fetchJson<JobMeta>("/api/meta"),
          fetchJson<ReviewState>("/api/review-state"),
        ]);

        set((state) => {
          state.meta = meta;
          state.reviewState = reviewState;
          state.renderStatus = syncRenderStatus(reviewState);
        });

        startRenderPolling(get, set);
      } catch (err) {
        console.error(err);
        set((state) => {
          state.renderStatus = "error";
        });
      }
    },

    selectSegment: (segmentId: string) => {
      set((state) => {
        state.selectedSegmentId = segmentId;
        if (state.blueprint) {
          for (const scene of state.blueprint.scenes) {
            for (const seg of scene.logic_segments) {
              if (seg.id === segmentId) {
                state.selectedSceneId = scene.id;
                return;
              }
            }
          }
        }
      });
    },

    setReviewFilter: (filter) => {
      set((state) => {
        state.reviewFilter = filter;
      });
    },

    setReviewStatus: (segmentId, status) => {
      set((state) => {
        const entry = ensureReviewEntry(state.reviewState, segmentId);
        if (!entry) return;
        entry.review_status = status;
        entry.updated_at = new Date().toISOString();
        state.isDirty = true;
      });
    },

    toggleIssueTag: (segmentId, tag) => {
      set((state) => {
        const entry = ensureReviewEntry(state.reviewState, segmentId);
        if (!entry) return;
        const hasTag = entry.issue_tags.includes(tag);
        entry.issue_tags = hasTag
          ? entry.issue_tags.filter((current) => current !== tag)
          : [...entry.issue_tags, tag];
        entry.updated_at = new Date().toISOString();
        state.isDirty = true;
      });
    },

    updateReviewNote: (segmentId, note) => {
      set((state) => {
        const entry = ensureReviewEntry(state.reviewState, segmentId);
        if (!entry) return;
        entry.note = note;
        entry.updated_at = new Date().toISOString();
        state.isDirty = true;
      });
    },

    updateSceneTitle: (sceneId, title) => {
      set((state) => {
        const scene = findScene(state.blueprint, sceneId);
        if (!scene) return;
        scene.title = title;
        state.isDirty = true;
        const firstSegmentId = scene.logic_segments[0]?.id;
        if (firstSegmentId) markSegmentEdited(state, firstSegmentId);
      });
    },

    changeSceneView: (sceneId, view) => {
      set((state) => {
        const scene = findScene(state.blueprint, sceneId);
        if (!scene) return;
        scene.view = view;
        state.isDirty = true;
        const firstSegmentId = scene.logic_segments[0]?.id;
        if (firstSegmentId) markSegmentEdited(state, firstSegmentId);
      });
    },

    updateTransitionType: (segmentId, transitionType) => {
      set((state) => {
        const found = findSegment(state.blueprint, segmentId);
        if (!found) return;
        found.segment.transition_type = transitionType;
        state.isDirty = true;
        markSegmentEdited(state, segmentId);
      });
    },

    updateTemplateProp: (segmentId, key, value) => {
      set((state) => {
        const found = findSegment(state.blueprint, segmentId);
        if (!found) return;
        found.segment.template_props = found.segment.template_props ?? {};
        found.segment.template_props[key] = value;
        state.isDirty = true;
        markSegmentEdited(state, segmentId);
      });
    },

    removeTemplateProp: (segmentId, key) => {
      set((state) => {
        const found = findSegment(state.blueprint, segmentId);
        if (!found || !found.segment.template_props) return;
        delete found.segment.template_props[key];
        state.isDirty = true;
        markSegmentEdited(state, segmentId);
      });
    },

    toggleAtomStatus: (segmentId, atomId) => {
      set((state) => {
        const found = findSegment(state.blueprint, segmentId);
        if (!found) return;

        const idx = found.segment.atoms.findIndex((atom) => atom.id === atomId);
        if (idx === -1) return;

        const atom = found.segment.atoms[idx];
        if (atom.status === "keep") {
          state.keepAtomBackup[atomId] = {
            id: atom.id,
            text: atom.text,
            time: { start: atom.time.start, end: atom.time.end },
            status: "keep",
            words: atom.words ? [...atom.words] : [],
            subtitle_text: atom.subtitle_text,
            alignment_mode: atom.alignment_mode,
            alignment_confidence: atom.alignment_confidence,
            media_range: atom.media_range ? { ...atom.media_range } : undefined,
            media_mode: atom.media_mode,
            media_confidence: atom.media_confidence,
            media_occurrence: atom.media_occurrence,
          };
          found.segment.atoms[idx] = {
            id: atom.id,
            text: atom.text,
            time: { ...atom.time },
            status: "discard",
            reason: "编辑移除",
          };
        } else {
          const backup = state.keepAtomBackup[atomId];
          found.segment.atoms[idx] = backup
            ? {
                ...backup,
                words: backup.words ? [...backup.words] : [],
                media_range: backup.media_range ? { ...backup.media_range } : undefined,
                media_occurrence: backup.media_occurrence,
              }
            : {
                id: atom.id,
                text: atom.text,
                time: { ...atom.time },
                status: "keep",
                words: [],
              };
        }
        state.isDirty = true;
        markSegmentEdited(state, segmentId);
      });
    },

    changeTemplate: (segmentId, template) => {
      set((state) => {
        const found = findSegment(state.blueprint, segmentId);
        if (!found) return;
        found.segment.template = template;
        state.isDirty = true;
        markSegmentEdited(state, segmentId);
      });
    },

    updateItem: (segmentId, index, text, emoji) => {
      set((state) => {
        const found = findSegment(state.blueprint, segmentId);
        if (!found || index >= found.segment.items.length) return;
        found.segment.items[index].text = text;
        if (emoji !== undefined) {
          found.segment.items[index].emoji = emoji;
        }
        state.isDirty = true;
        markSegmentEdited(state, segmentId);
      });
    },

    addItem: (segmentId, text, emoji) => {
      set((state) => {
        const found = findSegment(state.blueprint, segmentId);
        if (!found) return;
        found.segment.items.push({ text, emoji });
        state.isDirty = true;
        markSegmentEdited(state, segmentId);
      });
    },

    removeItem: (segmentId, index) => {
      set((state) => {
        const found = findSegment(state.blueprint, segmentId);
        if (!found || index >= found.segment.items.length) return;
        found.segment.items.splice(index, 1);
        state.isDirty = true;
        markSegmentEdited(state, segmentId);
      });
    },

    moveItem: (segmentId, index, direction) => {
      set((state) => {
        const found = findSegment(state.blueprint, segmentId);
        if (!found) return;
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= found.segment.items.length) return;
        const [item] = found.segment.items.splice(index, 1);
        found.segment.items.splice(nextIndex, 0, item);
        state.isDirty = true;
        markSegmentEdited(state, segmentId);
      });
    },
  }))
);

export function useSelectedSegment() {
  const blueprint = useEditorStore((state) => state.blueprint);
  const selectedSegmentId = useEditorStore((state) => state.selectedSegmentId);
  if (!blueprint || !selectedSegmentId) return null;
  return findSegment(blueprint, selectedSegmentId);
}

export function useSelectedSegmentContext() {
  const blueprint = useEditorStore((state) => state.blueprint);
  const selectedSegmentId = useEditorStore((state) => state.selectedSegmentId);
  const timingMap = useEditorStore((state) => state.timingMap);
  const transcript = useEditorStore((state) => state.transcript);
  const meta = useEditorStore((state) => state.meta);
  const diagnostics = useEditorStore((state) => state.step2Diagnostics);
  const reviewState = useEditorStore((state) => state.reviewState);

  if (!blueprint || !selectedSegmentId) return null;
  const found = findSegment(blueprint, selectedSegmentId);
  if (!found) return null;

  const { scene, segment } = found;
  const keepAtoms = segment.atoms.filter((atom): atom is KeepAtom => atom.status === "keep");
  const discardAtoms = segment.atoms.filter((atom): atom is DiscardAtom => atom.status === "discard");
  const allAtoms = segment.atoms;

  const originalStart = allAtoms.length > 0
    ? Math.min(...allAtoms.map((atom) => atom.time.start))
    : 0;
  const originalEnd = allAtoms.length > 0
    ? Math.max(...allAtoms.map((atom) => atom.time.end))
    : 0;

  const timingByAtomId = new Map((timingMap?.segments || []).map((item) => [item.atom_id, item]));
  const outputSegments = keepAtoms
    .map((atom) => timingByAtomId.get(atom.id))
    .filter((item): item is TimingSegment => Boolean(item));

  const outputStart = outputSegments.length > 0
    ? Math.min(...outputSegments.map((item) => item.output.start))
    : null;
  const outputEnd = outputSegments.length > 0
    ? Math.max(...outputSegments.map((item) => item.output.end))
    : null;

  const transcriptExcerpt = transcript
    ? transcript.words.filter((word) => word.start < originalEnd + 2 && word.end > originalStart - 2)
    : [];

  return {
    scene,
    segment,
    keepAtoms,
    discardAtoms,
    keepText: keepAtoms.map((atom) => atom.text).join(""),
    originalStart,
    originalEnd,
    outputStart,
    outputEnd,
    transcriptExcerpt,
    diagnostics: diagnostics?.segments?.[segment.id] ?? null,
    reviewEntry: reviewState?.segments?.[segment.id] ?? null,
    meta,
  };
}

export function useStats() {
  const blueprint = useEditorStore((state) => state.blueprint);
  const timingMap = useEditorStore((state) => state.timingMap);
  const reviewState = useEditorStore((state) => state.reviewState);
  if (!blueprint) return null;

  let sceneCount = blueprint.scenes.length;
  let segmentCount = 0;
  let keepCount = 0;
  let discardCount = 0;
  for (const scene of blueprint.scenes) {
    segmentCount += scene.logic_segments.length;
    for (const seg of scene.logic_segments) {
      for (const atom of seg.atoms) {
        if (atom.status === "keep") keepCount++;
        else discardCount++;
      }
    }
  }

  const reviewSummary = reviewState
    ? Object.values(reviewState.segments).reduce<ReviewSummary>(
        (summary, entry) => {
          summary.total += 1;
          summary[entry.review_status] += 1;
          return summary;
        },
        { total: 0, todo: 0, accepted: 0, needs_edit: 0, accepted_after_edit: 0 }
      )
    : null;

  return {
    sceneCount,
    segmentCount,
    keepCount,
    discardCount,
    outputDuration: timingMap?.totalDuration ?? null,
    reviewSummary,
  };
}

export function useSegmentDiagnostics(segmentId: string | null): Step2SegmentDiagnostics | null {
  return useEditorStore((state) => (segmentId ? state.step2Diagnostics?.segments?.[segmentId] ?? null : null));
}






