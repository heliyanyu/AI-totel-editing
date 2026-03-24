/**
 * 三级结构 JSON Schema 校验（Phase 0 验证版）
 *
 * 校验 LLM 输出的三级语义结构 JSON
 */

import { z } from "zod";

// ── 模板 ID ─────────────────────────────────────────

export const TemplateId3L = z.enum([
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

// ── 画面模式 ─────────────────────────────────────────

export const ViewMode3L = z.enum(["overlay", "graphics"]);

// ── 时间范围 ─────────────────────────────────────────

export const TimeRange3L = z.object({
  start: z.number(),
  end: z.number(),
});

// ── Item（渲染条目） ──────────────────────────────────

export const Item3L = z.object({
  text: z.string(),
  emoji: z.string().optional(),
});

// ── Atom（原子块） ────────────────────────────────────

export const KeepAtom3L = z.object({
  id: z.string(),
  text: z.string(),
  time: TimeRange3L,
  status: z.literal("keep"),
});

export const DiscardAtom3L = z.object({
  id: z.string(),
  text: z.string(),
  time: TimeRange3L,
  status: z.literal("discard"),
  reason: z.string(),
});

export const Atom3L = z.discriminatedUnion("status", [KeepAtom3L, DiscardAtom3L]);

// ── LogicSegment（逻辑段） ─────────────────────────────

export const LogicSegment3L = z.object({
  id: z.string(),
  transition_type: z.string(),
  template: TemplateId3L,
  items: z.array(Item3L),
  atoms: z.array(Atom3L),
  template_props: z.record(z.unknown()).optional(),
});

// ── Scene（场景） ─────────────────────────────────────

export const Scene3L = z.object({
  id: z.string(),
  title: z.string(),
  view: ViewMode3L,
  logic_segments: z.array(LogicSegment3L),
});

// ── Discarded（顶层废料） ──────────────────────────────

export const DiscardedEntry3L = z.object({
  id: z.string(),
  text: z.string(),
  time: TimeRange3L,
  reason: z.string(),
});

// ── Blueprint3Level（三级结构顶层） ─────────────────────

export const Blueprint3Level = z.object({
  title: z.string(),
  scenes: z.array(Scene3L),
  discarded: z.array(DiscardedEntry3L).optional().default([]),
});

export type Blueprint3Level = z.infer<typeof Blueprint3Level>;
export type Scene3LType = z.infer<typeof Scene3L>;
export type LogicSegment3LType = z.infer<typeof LogicSegment3L>;
export type Atom3LType = z.infer<typeof Atom3L>;
export type Item3LType = z.infer<typeof Item3L>;

// ── 自动修复 ──────────────────────────────────────────

export function autoRepair3Level(data: any): any {
  if (!data?.scenes || !Array.isArray(data.scenes)) return data;

  for (const scene of data.scenes) {
    if (!scene.logic_segments) continue;

    for (const seg of scene.logic_segments) {
      if (!seg.atoms || !Array.isArray(seg.atoms)) {
        seg.atoms = [];
        continue;
      }

      // atoms 按 start 排序
      seg.atoms.sort(
        (a: any, b: any) => (a.time?.start ?? 0) - (b.time?.start ?? 0)
      );

      // 修复重叠
      for (let i = 1; i < seg.atoms.length; i++) {
        const prev = seg.atoms[i - 1];
        const curr = seg.atoms[i];
        if (prev.time && curr.time && prev.time.end > curr.time.start) {
          prev.time.end = curr.time.start;
        }
      }

      // 确保 items 是数组
      if (!seg.items) seg.items = [];

      // 确保 template_props 是对象
      if (seg.template_props === null || seg.template_props === undefined) {
        seg.template_props = {};
      }
    }
  }

  // 确保 discarded 是数组
  if (!data.discarded) data.discarded = [];

  return data;
}

// ── 校验 ──────────────────────────────────────────────

export interface ValidationResult {
  success: boolean;
  data?: Blueprint3Level;
  zodErrors?: string[];
  logicErrors?: string[];
  warnings?: string[];
  stats?: Blueprint3LevelStats;
}

export interface Blueprint3LevelStats {
  sceneCount: number;
  segmentCount: number;
  keepAtomCount: number;
  discardAtomCount: number;
  topLevelDiscardCount: number;
  totalDurationCovered: number;
  templateDistribution: Record<string, number>;
  viewDistribution: Record<string, number>;
  avgItemsPerSegment: number;
  coveragePercent: number;
}

export function validate3Level(
  data: unknown,
  transcriptDuration?: number,
  spokenDuration?: number, // 有声时间（总时长 - 停顿），更准确的覆盖率基准
): ValidationResult {
  // Zod 校验
  const result = Blueprint3Level.safeParse(data);
  if (!result.success) {
    return {
      success: false,
      zodErrors: result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      ),
    };
  }

  const bp = result.data;
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── 逻辑校验 ──────────────────────────────────────

  // 收集所有 atoms（用于时间检查）
  const allAtoms: Array<{ id: string; time: { start: number; end: number }; status: string }> = [];
  let segmentCount = 0;
  let keepAtomCount = 0;
  let discardAtomCount = 0;
  let totalItemCount = 0;
  const templateDist: Record<string, number> = {};
  const viewDist: Record<string, number> = {};

  for (const scene of bp.scenes) {
    viewDist[scene.view] = (viewDist[scene.view] || 0) + 1;

    for (const seg of scene.logic_segments) {
      segmentCount++;
      totalItemCount += seg.items.length;
      templateDist[seg.template] = (templateDist[seg.template] || 0) + 1;

      for (const atom of seg.atoms) {
        allAtoms.push(atom);
        if (atom.status === "keep") keepAtomCount++;
        else discardAtomCount++;
      }

      // items 数量检查
      if (seg.items.length === 0) {
        warnings.push(`${seg.id}: items 为空（模板 ${seg.template} 需要至少 1 个 item）`);
      }

      // items text 长度检查
      for (let i = 0; i < seg.items.length; i++) {
        if (seg.items[i].text.length > 18) {
          warnings.push(
            `${seg.id} item[${i}]: text 超过 18 字 ("${seg.items[i].text.slice(0, 20)}...")`
          );
        }
      }

      // 模板特定 items 数量检查
      const itemCount = seg.items.length;
      switch (seg.template) {
        case "hero_text":
          if (itemCount !== 1) warnings.push(`${seg.id}: hero_text 需要 1 item，实际 ${itemCount}`);
          break;
        case "number_center":
          if (itemCount !== 1) warnings.push(`${seg.id}: number_center 需要 1 item，实际 ${itemCount}`);
          break;
        case "split_column":
        case "myth_buster":
        case "category_table":
          if (itemCount % 2 !== 0) warnings.push(`${seg.id}: ${seg.template} 需要偶数 items，实际 ${itemCount}`);
          break;
        case "branch_path":
          if (itemCount !== 3) warnings.push(`${seg.id}: branch_path 需要 3 items，实际 ${itemCount}`);
          break;
      }
    }
  }

  // 时间排序检查
  allAtoms.sort((a, b) => a.time.start - b.time.start);
  for (let i = 1; i < allAtoms.length; i++) {
    const prev = allAtoms[i - 1];
    const curr = allAtoms[i];
    if (curr.time.start < prev.time.end - 0.3) {
      errors.push(
        `时间重叠: ${prev.id} (end=${prev.time.end.toFixed(2)}) 与 ${curr.id} (start=${curr.time.start.toFixed(2)}) 重叠 ${(prev.time.end - curr.time.start).toFixed(2)}s`
      );
    }
  }

  // 时间范围合法性
  for (const atom of allAtoms) {
    if (atom.time.start >= atom.time.end) {
      errors.push(`${atom.id}: 无效时间范围 start=${atom.time.start} >= end=${atom.time.end}`);
    }
  }

  // 覆盖率计算（优先用有声时间，更准确）
  const keepAtoms = allAtoms.filter((a) => a.status === "keep");
  const totalCovered = keepAtoms.reduce((sum, a) => sum + (a.time.end - a.time.start), 0);

  // 使用有声时间计算覆盖率（更准确），fallback 到总时长
  const baseDuration = spokenDuration ?? transcriptDuration ?? 0;
  let coveragePercent = 0;
  if (baseDuration > 0) {
    coveragePercent = (totalCovered / baseDuration) * 100;
    if (coveragePercent < 50) {
      errors.push(`覆盖率过低: ${coveragePercent.toFixed(1)}% (最低要求 50%)`);
    } else if (coveragePercent < 70) {
      warnings.push(`覆盖率偏低: ${coveragePercent.toFixed(1)}% (建议 ≥85%)`);
    }
  }

  // 时间跳空检查
  for (let i = 1; i < keepAtoms.length; i++) {
    const gap = keepAtoms[i].time.start - keepAtoms[i - 1].time.end;
    if (gap > 8) {
      warnings.push(
        `时间跳空 ${gap.toFixed(1)}s: ${keepAtoms[i - 1].id} (end=${keepAtoms[i - 1].time.end.toFixed(1)}) → ${keepAtoms[i].id} (start=${keepAtoms[i].time.start.toFixed(1)})`
      );
    }
  }

  // 模板多样性检查
  const uniqueTemplates = Object.keys(templateDist).length;
  if (segmentCount >= 4 && uniqueTemplates <= 1) {
    warnings.push(`模板单一: ${segmentCount} 个逻辑段只用了 ${uniqueTemplates} 种模板`);
  }
  const listFadeCount = templateDist["list_fade"] || 0;
  if (segmentCount >= 4 && listFadeCount > segmentCount * 0.6) {
    warnings.push(
      `list_fade 过多: ${listFadeCount}/${segmentCount} (${((listFadeCount / segmentCount) * 100).toFixed(0)}%) 建议根据语义模式选择更精确的模板`
    );
  }

  // view 交替检查
  const sceneViews = bp.scenes.map((s) => s.view);
  let consecutiveSame = 1;
  for (let i = 1; i < sceneViews.length; i++) {
    if (sceneViews[i] === sceneViews[i - 1]) {
      consecutiveSame++;
      if (consecutiveSame >= 4) {
        warnings.push(`view 连续 ${consecutiveSame} 个 "${sceneViews[i]}"，建议交替使用`);
      }
    } else {
      consecutiveSame = 1;
    }
  }

  // ID 格式检查
  for (const scene of bp.scenes) {
    if (!/^S\d+$/.test(scene.id)) {
      warnings.push(`Scene ID 格式不规范: "${scene.id}" (建议 S1, S2, S3...)`);
    }
    for (const seg of scene.logic_segments) {
      if (!/^S\d+-L\d+$/.test(seg.id)) {
        warnings.push(`Segment ID 格式不规范: "${seg.id}" (建议 S1-L1, S1-L2...)`);
      }
    }
  }

  // 场景数量检查
  if (bp.scenes.length === 0) {
    errors.push("没有场景");
  } else if (bp.scenes.length === 1 && segmentCount >= 6) {
    warnings.push("只有 1 个场景但 ≥6 个逻辑段，建议拆分为多个场景");
  }

  // 统计
  const stats: Blueprint3LevelStats = {
    sceneCount: bp.scenes.length,
    segmentCount,
    keepAtomCount,
    discardAtomCount,
    topLevelDiscardCount: bp.discarded.length,
    totalDurationCovered: totalCovered,
    templateDistribution: templateDist,
    viewDistribution: viewDist,
    avgItemsPerSegment: segmentCount > 0 ? totalItemCount / segmentCount : 0,
    coveragePercent,
  };

  if (errors.length > 0) {
    return { success: false, logicErrors: errors, warnings, stats };
  }

  return { success: true, data: bp, warnings, stats };
}
