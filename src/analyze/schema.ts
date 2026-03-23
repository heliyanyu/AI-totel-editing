/**
 * Blueprint JSON Schema 校验 + 自动修复
 *
 * 三级结构校验: Blueprint → BlueprintScene → LogicSegment → BlueprintAtom
 */

import {
  Blueprint,
  type BlueprintAtom,
  type KeepAtom,
  type LogicSegment,
  type BlueprintScene,
  allAtoms,
  keepAtoms,
  allSegments,
} from "../schemas/blueprint.js";

const MIN_ATOM_DURATION_SEC = 0.02;

// ══════════════════════════════════════════════════════
// JSON 提取
// ══════════════════════════════════════════════════════

/**
 * 从 LLM 返回的文本中提取 JSON
 * 支持 ```json...``` 包裹和裸 JSON
 */
export function extractJson(text: string): unknown {
  // 尝试 ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    return JSON.parse(fenced[1].trim());
  }

  // 尝试裸 JSON（找第一个 { 到最后一个 }）
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return JSON.parse(text.substring(start, end + 1));
  }

  throw new Error("无法从 LLM 响应中提取 JSON");
}

// ══════════════════════════════════════════════════════
// 自动修复
// ══════════════════════════════════════════════════════

/**
 * 自动修复 LLM 输出的三级 Blueprint JSON 的常见问题：
 * - 每个 logic_segment 内 atoms 按 start 排序
 * - 修复时间重叠
 * - 确保 items / template_props / atoms 有默认值
 */
export function autoRepairBlueprint(data: any): any {
  if (!data?.scenes || !Array.isArray(data.scenes)) return data;

  let totalRepairs = 0;

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

      // 修复 start >= end 的异常时间范围，避免单个 atom 卡死整条链
      for (const atom of seg.atoms) {
        if (!atom.time) {
          continue;
        }
        if (typeof atom.time.start !== "number" || typeof atom.time.end !== "number") {
          continue;
        }
        if (atom.time.start >= atom.time.end) {
          atom.time.end = atom.time.start + MIN_ATOM_DURATION_SEC;
          totalRepairs++;
        }
      }

      // 仅修复 keep-keep 的危险重叠；discard/keep 可共存于同一原始时间段
      for (let i = 1; i < seg.atoms.length; i++) {
        const prev = seg.atoms[i - 1];
        const curr = seg.atoms[i];
        if (!prev.time || !curr.time || prev.time.end <= curr.time.start) {
          continue;
        }
        if (prev.status !== "keep" || curr.status !== "keep") {
          continue;
        }

        const overlap = prev.time.end - curr.time.start;
        const nextEnd = Math.max(prev.time.start + MIN_ATOM_DURATION_SEC, curr.time.start);
        if (nextEnd >= prev.time.end) {
          continue;
        }

        prev.time.end = nextEnd;
        totalRepairs++;
        if (overlap > 0.5) {
          console.log(
            `  自动修复: keep atom ${prev.id} end 裁掉 ${overlap.toFixed(1)}s 重叠`
          );
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

  if (totalRepairs > 0) {
    console.log(`  共修复 ${totalRepairs} 处时间重叠`);
  }

  return data;
}

// ══════════════════════════════════════════════════════
// 校验
// ══════════════════════════════════════════════════════

export interface BlueprintStats {
  sceneCount: number;
  segmentCount: number;
  keepAtomCount: number;
  discardAtomCount: number;
  totalDurationCovered: number;
  templateDistribution: Record<string, number>;
  viewDistribution: Record<string, number>;
  avgItemsPerSegment: number;
  coveragePercent: number;
}

export interface ValidationResult {
  success: boolean;
  data?: Blueprint;
  zodErrors?: string[];
  logicErrors?: string[];
  warnings?: string[];
  stats?: BlueprintStats;
}

/**
 * 校验三级 Blueprint JSON
 *
 * @param data - 待校验数据
 * @param transcriptDuration - 转录总时长（秒）
 * @param spokenDuration - 有声时长（秒），更准确的覆盖率基准
 */
export function validateBlueprint(
  data: unknown,
  transcriptDuration?: number,
  spokenDuration?: number,
): ValidationResult {
  // ── Zod 结构校验 ────────────────────────────────────
  const result = Blueprint.safeParse(data);
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

  // ── 收集统计 ────────────────────────────────────────
  const atoms = allAtoms(bp);
  const segments = allSegments(bp);
  const keeps = keepAtoms(bp);

  let totalItemCount = 0;
  const templateDist: Record<string, number> = {};
  const viewDist: Record<string, number> = {};

  for (const scene of bp.scenes) {
    viewDist[scene.view] = (viewDist[scene.view] || 0) + 1;

    for (const seg of scene.logic_segments) {
      totalItemCount += seg.items.length;
      templateDist[seg.template] = (templateDist[seg.template] || 0) + 1;
      const isSubtitleOnly = seg.template === "subtitle_only";

      // items 数量检查
      if (!isSubtitleOnly && seg.items.length === 0) {
        warnings.push(`${seg.id}: items 为空（模板 ${seg.template}）`);
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
        case "subtitle_only":
          if (itemCount !== 0) warnings.push(`${seg.id}: subtitle_only 需要 0 item，实际 ${itemCount}`);
          break;
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

  // ── 时间排序检查（仅对 keep atoms 严格） ─────────────────
  const sortedKeepsForOverlap = [...keeps].sort((a, b) => a.time.start - b.time.start);
  for (let i = 1; i < sortedKeepsForOverlap.length; i++) {
    const prev = sortedKeepsForOverlap[i - 1];
    const curr = sortedKeepsForOverlap[i];
    if (curr.time.start < prev.time.end - 0.3) {
      warnings.push(
        `keep 时间重叠: atom ${prev.id} (end=${prev.time.end.toFixed(2)}) 与 atom ${curr.id} (start=${curr.time.start.toFixed(2)}) 重叠 ${(prev.time.end - curr.time.start).toFixed(2)}s`
      );
    }
  }

  // ── 时间范围合法性 ──────────────────────────────────
  for (const atom of atoms) {
    if (atom.time.start >= atom.time.end) {
      errors.push(`atom ${atom.id}: 无效时间范围 start=${atom.time.start} >= end=${atom.time.end}`);
    }
  }

  // ── 覆盖率计算 ──────────────────────────────────────
  const totalCovered = keeps.reduce((sum, a) => sum + (a.time.end - a.time.start), 0);
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

  // ── 时间跳空检查 ────────────────────────────────────
  const sortedKeeps = [...keeps].sort((a, b) => a.time.start - b.time.start);
  for (let i = 1; i < sortedKeeps.length; i++) {
    const gap = sortedKeeps[i].time.start - sortedKeeps[i - 1].time.end;
    if (gap > 8) {
      warnings.push(
        `时间跳空 ${gap.toFixed(1)}s: atom ${sortedKeeps[i - 1].id} → atom ${sortedKeeps[i].id}`
      );
    }
  }

  // ── 模板多样性检查 ──────────────────────────────────
  const uniqueTemplates = Object.keys(templateDist).length;
  const isPureSubtitleOnly =
    uniqueTemplates === 1 && (templateDist["subtitle_only"] || 0) === segments.length;
  if (segments.length >= 4 && uniqueTemplates <= 1 && !isPureSubtitleOnly) {
    warnings.push(`模板单一: ${segments.length} 个逻辑段只用了 ${uniqueTemplates} 种模板`);
  }
  const listFadeCount = templateDist["list_fade"] || 0;
  if (segments.length >= 4 && listFadeCount > segments.length * 0.6) {
    warnings.push(
      `list_fade 过多: ${listFadeCount}/${segments.length} (${((listFadeCount / segments.length) * 100).toFixed(0)}%)`
    );
  }

  // ── view 交替检查 ──────────────────────────────────
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

  // ── ID 格式检查 ────────────────────────────────────
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

  // ── 场景数量检查 ────────────────────────────────────
  if (bp.scenes.length === 0) {
    errors.push("没有场景");
  } else if (bp.scenes.length === 1 && segments.length >= 6) {
    warnings.push("只有 1 个场景但 ≥6 个逻辑段，建议拆分为多个场景");
  }

  // ── 统计 ────────────────────────────────────────────
  const stats: BlueprintStats = {
    sceneCount: bp.scenes.length,
    segmentCount: segments.length,
    keepAtomCount: keeps.length,
    discardAtomCount: atoms.length - keeps.length,
    totalDurationCovered: totalCovered,
    templateDistribution: templateDist,
    viewDistribution: viewDist,
    avgItemsPerSegment: segments.length > 0 ? totalItemCount / segments.length : 0,
    coveragePercent,
  };

  if (errors.length > 0) {
    return { success: false, logicErrors: errors, warnings, stats };
  }

  return { success: true, data: bp, warnings, stats };
}


