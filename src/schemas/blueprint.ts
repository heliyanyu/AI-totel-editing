/**
 * Blueprint Schema — 三级语义结构
 *
 * 三级结构: Blueprint → BlueprintScene → LogicSegment → BlueprintAtom
 * - BlueprintScene: 话题场景（意图变化处分割），控制 overlay/graphics 模式
 * - LogicSegment:   逻辑段（角度转变处分割），携带模板和渲染条目
 * - BlueprintAtom:  原子语义块（最小不可中断单元），携带时间戳和 keep/discard 状态
 *
 * 数据流:
 * Step 1 LLM → flat atoms[] → groupStep1Atoms() → Step 2 LLM → mergeStep2WithAtoms() → Blueprint
 * Blueprint → segment-to-scene adapter → RenderScene[] → Remotion 15 模板
 */

import { z } from "zod";

// ══════════════════════════════════════════════════════
// 基础类型（全局复用）
// ══════════════════════════════════════════════════════

// ── 模板类型 ──────────────────────────────────────────

export const TemplateId = z.enum([
  "subtitle_only",
  "hero_text",
  "number_center",
  "warning_alert",
  "term_card",
  "list_fade",
  "color_grid",
  "body_annotate",
  "step_arrow",
  "branch_path",
  "brick_stack",
  "split_column",
  "myth_buster",
  "category_table",
  "vertical_timeline",
]);
export type TemplateId = z.infer<typeof TemplateId>;

// ── Word（底层时间对齐单元，来自 ASR 或 forced alignment） ─────────────

export const Word = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  source_word_indices: z.array(z.number()).optional(),
  source_start: z.number().optional(),
  source_end: z.number().optional(),
  synthetic: z.boolean().optional(),
});
export type Word = z.infer<typeof Word>;

// ── Transcript（转录 / 强制对齐结果） ──────────────────────────────

export const Transcript = z.object({
  duration: z.number(),
  words: z.array(Word),
});
export type Transcript = z.infer<typeof Transcript>;

// ── ReviewedToken（review 后、强制对齐前的文本单元） ─────────────────

export const ReviewedToken = z.object({
  id: z.number(),
  text: z.string(),
  raw_word_indices: z.array(z.number()).optional(),
  source_start: z.number().optional(),
  source_end: z.number().optional(),
  synthetic: z.boolean().optional(),
});
export type ReviewedToken = z.infer<typeof ReviewedToken>;

export const ReviewedTokenDocument = z.object({
  duration: z.number().optional(),
  text: z.string(),
  tokens: z.array(ReviewedToken),
});
export type ReviewedTokenDocument = z.infer<typeof ReviewedTokenDocument>;

// ── AlignedToken（强制对齐后的底层真值单元） ─────────────────────────

export const AlignedToken = z.object({
  id: z.number(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number().optional(),
  status: z.enum(["aligned", "fallback"]).optional(),
  raw_word_indices: z.array(z.number()).optional(),
  source_start: z.number().optional(),
  source_end: z.number().optional(),
  synthetic: z.boolean().optional(),
});
export type AlignedToken = z.infer<typeof AlignedToken>;

export const AlignedTokenTranscript = z.object({
  duration: z.number(),
  tokens: z.array(AlignedToken),
});
export type AlignedTokenTranscript = z.infer<typeof AlignedTokenTranscript>;

// ── 时间范围 ─────────────────────────────────────────

export const TimeRange = z.object({
  start: z.number(),
  end: z.number(),
});
export type TimeRange = z.infer<typeof TimeRange>;

// ── 画面模式 ─────────────────────────────────────────

export const ViewMode = z.enum(["overlay", "graphics"]);
export type ViewMode = z.infer<typeof ViewMode>;


// ══════════════════════════════════════════════════════
// 三级语义结构（Blueprint 层）
// ══════════════════════════════════════════════════════

// ── BlueprintItem（渲染条目，≤18字） ──────────────────

export const BlueprintItem = z.object({
  text: z.string(),
  emoji: z.string().optional(),
});
export type BlueprintItem = z.infer<typeof BlueprintItem>;

// ── BlueprintAtom（原子语义块） ──────────────────────────
// id 为整数序号（来自 Step 1 LLM 输出），全局递增
// time 使用 TimeRange {start, end}（mergeStep2WithAtoms 从 {s,e} 转换）

export const KeepAtom = z.object({
  id: z.number(),
  start_id: z.number().optional(),
  end_id: z.number().optional(),
  text: z.string(),
  time: TimeRange,
  status: z.literal("keep"),
  audio_span_id: z.string().optional(),
  words: z.array(Word).optional().default([]),
  subtitle_text: z.string().optional(),
  alignment_mode: z
    .enum(["reviewed_exact", "reviewed_projected", "static_fallback"])
    .optional(),
  alignment_confidence: z.number().optional(),
  media_range: TimeRange.optional(),
  media_mode: z
    .enum(["words_exact", "words_projected", "fallback_time"])
    .optional(),
  media_confidence: z.number().optional(),
  media_occurrence: z
    .enum(["last_complete", "last_window", "fallback_time"])
    .optional(),
});
export type KeepAtom = z.infer<typeof KeepAtom>;

export const DiscardAtom = z.object({
  id: z.number(),
  start_id: z.number().optional(),
  end_id: z.number().optional(),
  text: z.string(),
  time: TimeRange,
  status: z.literal("discard"),
  reason: z.string(),
});
export type DiscardAtom = z.infer<typeof DiscardAtom>;

export const BlueprintAtom = z.discriminatedUnion("status", [
  KeepAtom,
  DiscardAtom,
]);
export type BlueprintAtom = z.infer<typeof BlueprintAtom>;

// ── LogicSegment（逻辑段） ──────────────────────────────
// 同一场景内的角度转变处分割，选用模板 + 提炼渲染条目

export const LogicSegment = z.object({
  id: z.string(),                                     // "S1-L1"
  transition_type: z.string(),                         // 语义功能描述
  template: TemplateId,                                // 渲染模板（15 种之一）
  items: z.array(BlueprintItem),                       // 渲染条目
  atoms: z.array(BlueprintAtom),                       // 原子块（含 keep + discard）
  template_props: z.record(z.unknown()).optional().default({}),
});
export type LogicSegment = z.infer<typeof LogicSegment>;

// ── BlueprintScene（场景） ──────────────────────────────
// 话题整体切换处分割，控制 overlay/graphics 模式

export const BlueprintScene = z.object({
  id: z.string(),                                      // "S1"
  title: z.string(),                                   // 场景短标题
  view: ViewMode,                                      // overlay / graphics
  logic_segments: z.array(LogicSegment),
});
export type BlueprintScene = z.infer<typeof BlueprintScene>;

// ── Blueprint（三级结构顶层） ──────────────────────────

export const Blueprint = z.object({
  title: z.string(),                                   // 视频标题（2-10字）
  scenes: z.array(BlueprintScene),
});
export type Blueprint = z.infer<typeof Blueprint>;


// ══════════════════════════════════════════════════════
// Timing Map（视频切割后的时间映射）
// ══════════════════════════════════════════════════════

export const TimingSegment = z.object({
  atom_id: z.number(),                                 // 对应 BlueprintAtom.id
  original: TimeRange,
  output: TimeRange,
});
export type TimingSegment = z.infer<typeof TimingSegment>;

export const TimingMode = z.enum(["cut_video", "source_direct"]);
export type TimingMode = z.infer<typeof TimingMode>;

export const TimingClip = z.object({
  id: z.string(),
  source: TimeRange,
  content: TimeRange,
  output: TimeRange,
  atom_ids: z.array(z.number()),
});
export type TimingClip = z.infer<typeof TimingClip>;

export const TimingMap = z.object({
  mode: TimingMode.optional().default("cut_video"),
  segments: z.array(TimingSegment),
  clips: z.array(TimingClip).optional().default([]),
  totalDuration: z.number(),
});
export type TimingMap = z.infer<typeof TimingMap>;


// ══════════════════════════════════════════════════════
// 三级遍历辅助函数
// ══════════════════════════════════════════════════════

/** 收集所有 atoms（三层扁平化） */
export function allAtoms(bp: Blueprint): BlueprintAtom[] {
  const result: BlueprintAtom[] = [];
  for (const scene of bp.scenes) {
    for (const seg of scene.logic_segments) {
      result.push(...seg.atoms);
    }
  }
  return result;
}

/** 收集所有 keep atoms */
export function keepAtoms(bp: Blueprint): KeepAtom[] {
  return allAtoms(bp).filter((a): a is KeepAtom => a.status === "keep");
}

/** 收集所有 discard atoms */
export function discardAtoms(bp: Blueprint): DiscardAtom[] {
  return allAtoms(bp).filter((a): a is DiscardAtom => a.status === "discard");
}

/** 收集所有 logic segments */
export function allSegments(bp: Blueprint): LogicSegment[] {
  const result: LogicSegment[] = [];
  for (const scene of bp.scenes) {
    result.push(...scene.logic_segments);
  }
  return result;
}


// ══════════════════════════════════════════════════════
// Remotion 渲染层类型（v4 兼容）
// ══════════════════════════════════════════════════════
//
// 这些类型供 Remotion 模板组件使用。
// Phase 2 中 segment-to-scene 适配器将 LogicSegment → RenderScene。
// 15 个模板组件接收 RenderScene 作为 props。

export type VariantId = TemplateId;
export type TransitionType =
  | "fade"
  | "slide_left"
  | "slide_right"
  | "slide_up"
  | "wipe_right"
  | "wipe_down"
  | "clock_wipe"
  | "blur_scale";

export interface SceneTimeline {
  enter_ms: number;
  first_anchor_ms: number;
  dwell_end_ms: number;
  exit_end_ms: number;
}

export interface RenderItem {
  id?: string;
  text: string;
  emoji?: string;
  anchor_offset_ms?: number;
  visual_mode?: "icon" | "emoji";
}

export interface TemplateProps {
  left_label?: string;
  right_label?: string;
  [key: string]: unknown;
}

export interface RenderScene {
  id: string;
  topic_id: string;
  view?: ViewMode;
  variant_id: VariantId;
  title?: string;
  timeline: SceneTimeline;
  items: RenderItem[];
  template_props?: TemplateProps;
  transition_type?: TransitionType;
}

// ── 导航类型 ──────────────────────────────────────────

export interface NavNode {
  id: string;
  label: string;
}

export interface NavAppearance {
  at_ms: number;
  active_node_id: string;
  animation: string;
}

export interface NavStructure {
  nodes: NavNode[];
  appearances: NavAppearance[];
}

// ── 向后兼容 ──────────────────────────────────────────
// Scene → RenderScene 重命名，旧代码过渡用
/** @deprecated 使用 RenderScene */
export type Scene = RenderScene;
/** @deprecated 使用 RenderItem */
export type Item = RenderItem;



