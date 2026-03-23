/**
 * LogicSegment → RenderScene 适配器
 *
 * 将三级 Blueprint 中的 LogicSegment 转换为 Remotion 模板可用的 RenderScene。
 * 每个 LogicSegment 对应一个渲染场景（一种模板 + items）。
 *
 * 时间线策略：
 * - 从 TimingMap 找到该 segment 所有 keep atoms 的输出时间范围
 * - items 的 anchor_offset_ms 基于 keep atoms 的 words 时间戳计算
 */

import type {
  LogicSegment,
  BlueprintScene,
  KeepAtom,
  Word,
  TimingMap,
  TimingSegment,
  RenderScene,
  RenderItem,
  SceneTimeline,
  TemplateProps,
} from "../schemas/blueprint";

// 场景动画参数
const ENTER_LEAD_MS = 600;
const EXIT_DURATION_MS = 300;
const MIN_ITEM_GAP_MS = 300;

// ── 时间定位 ──────────────────────────────────────────

/**
 * 获取一个 segment 在输出视频中的时间范围（秒）
 */
function getSegmentOutputRange(
  segment: LogicSegment,
  timingMap: TimingMap
): { start: number; end: number; timings: TimingSegment[] } | null {
  const keepIds = new Set(
    segment.atoms
      .filter((a) => a.status === "keep")
      .map((a) => a.id)
  );

  const timings = timingMap.segments
    .filter((t) => keepIds.has(t.atom_id))
    .sort((a, b) => a.output.start - b.output.start);

  if (timings.length === 0) return null;

  return {
    start: timings[0].output.start,
    end: timings[timings.length - 1].output.end,
    timings,
  };
}

// ── Item anchor 计算 ─────────────────────────────────

/**
 * 在 words 序列中查找 item 文本首次出现的位置
 *
 * 搜索策略：取 item text 前4个汉字作为关键字，在所有 words 拼接文本中顺序查找。
 * 返回匹配位置对应的 word.start 相对于 segment 输出起点的偏移 ms。
 */
function findItemAnchorInWords(
  itemText: string,
  allWords: Word[],
  segOutputStartSec: number,
  timings: TimingSegment[]
): number | null {
  const clean = itemText.replace(/[^\u4e00-\u9fff\w]/g, "");
  const searchKey = clean.slice(0, 4);
  if (searchKey.length < 2) return null;

  // 构建拼接文本和字符→word 映射
  let accumulated = "";
  const charToWord: Word[] = [];
  for (const word of allWords) {
    const wordClean = word.text.replace(/[^\u4e00-\u9fff\w]/g, "");
    for (const ch of wordClean) {
      accumulated += ch;
      charToWord.push(word);
    }
  }

  const idx = accumulated.indexOf(searchKey);
  if (idx === -1) return null;

  const matchedWord = charToWord[idx];
  // word.start 是原始时间戳，需要转换为输出时间的偏移
  const wordOriginalTime = matchedWord.start;

  // 找到包含这个 word 的 timing segment
  for (const t of timings) {
    if (
      wordOriginalTime >= t.original.start - 0.1 &&
      wordOriginalTime <= t.original.end + 0.1
    ) {
      const offsetInAtom = wordOriginalTime - t.original.start;
      const wordOutputTime = t.output.start + offsetInAtom;
      return (wordOutputTime - segOutputStartSec) * 1000;
    }
  }

  return null;
}

/**
 * 计算 items 的 anchor_offset_ms
 *
 * 优先用 keep atoms 的 words 做定位；找不到时均匀分布在 segment 时段内。
 */
function computeItemAnchors(
  segment: LogicSegment,
  segOutputStartSec: number,
  segDurationMs: number,
  timings: TimingSegment[]
): RenderItem[] {
  const items = segment.items;
  if (items.length === 0) return [];

  // 收集所有 keep atoms 的 words
  const allWords: Word[] = [];
  for (const atom of segment.atoms) {
    if (atom.status === "keep" && atom.words) {
      allWords.push(...atom.words);
    }
  }

  // 尝试 word-based 定位
  const anchors: (number | null)[] = items.map((item) =>
    allWords.length > 0
      ? findItemAnchorInWords(item.text, allWords, segOutputStartSec, timings)
      : null
  );

  // 均匀分布回退
  const anchorStart = ENTER_LEAD_MS;
  const anchorEnd = Math.max(anchorStart + 500, segDurationMs * 0.7);
  const span = anchorEnd - anchorStart;

  const resolved: number[] = anchors.map((a, i) => {
    if (a !== null && a >= 0) return a;
    return items.length === 1
      ? anchorStart
      : Math.round(anchorStart + (i / (items.length - 1)) * span);
  });

  // 确保单调递增
  for (let i = 1; i < resolved.length; i++) {
    if (resolved[i] < resolved[i - 1] + MIN_ITEM_GAP_MS) {
      resolved[i] = resolved[i - 1] + MIN_ITEM_GAP_MS;
    }
  }

  // 确保不超过 dwell 范围
  const maxAnchor = segDurationMs - EXIT_DURATION_MS - 200;
  const clamped = resolved.map((a) =>
    Math.min(a, Math.max(maxAnchor, anchorStart))
  );

  return items.map((item, i) => ({
    text: item.text,
    emoji: item.emoji,
    anchor_offset_ms: clamped[i] ?? ENTER_LEAD_MS + i * MIN_ITEM_GAP_MS,
  }));
}

// ── 主转换 ────────────────────────────────────────────

/**
 * 将 LogicSegment 转换为 RenderScene
 */
export function segmentToRenderScene(
  segment: LogicSegment,
  parentScene: BlueprintScene,
  timingMap: TimingMap
): RenderScene | null {
  const range = getSegmentOutputRange(segment, timingMap);
  if (!range) {
    console.warn(`  警告: segment ${segment.id} 在 timing_map 中找不到对应段`);
    return null;
  }

  const segDurationMs = (range.end - range.start) * 1000;

  // 构建时间线
  const firstAnchorMs = Math.min(ENTER_LEAD_MS, segDurationMs * 0.15);
  const dwellEndMs = Math.max(
    firstAnchorMs + 500,
    segDurationMs - EXIT_DURATION_MS
  );

  const timeline: SceneTimeline = {
    enter_ms: 0,
    first_anchor_ms: firstAnchorMs,
    dwell_end_ms: dwellEndMs,
    exit_end_ms: segDurationMs,
  };

  // 构建 items（带 word-based anchor offsets）
  const items = computeItemAnchors(
    segment,
    range.start,
    segDurationMs,
    range.timings
  );

  return {
    id: segment.id,
    topic_id: parentScene.id,
    view: parentScene.view,
    variant_id: segment.template,
    title: parentScene.title,
    timeline,
    items,
    template_props: (segment.template_props ?? {}) as TemplateProps,
    transition_type: "fade",
  };
}

/**
 * 将 Blueprint 中所有 LogicSegments 转换为 RenderScene 数组
 *
 * 返回结果按输出时间排序，同时包含 segment 的输出起止时间。
 */
export interface SegmentRenderInfo {
  segment: LogicSegment;
  parentScene: BlueprintScene;
  renderScene: RenderScene;
  outputStart: number; // 秒
  outputEnd: number;   // 秒
}

export function segmentsToRenderScenes(
  blueprint: { scenes: BlueprintScene[] },
  timingMap: TimingMap
): SegmentRenderInfo[] {
  const results: SegmentRenderInfo[] = [];

  for (const scene of blueprint.scenes) {
    for (const segment of scene.logic_segments) {
      const range = getSegmentOutputRange(segment, timingMap);
      if (!range) continue;

      const renderScene = segmentToRenderScene(segment, scene, timingMap);
      if (!renderScene) continue;

      results.push({
        segment,
        parentScene: scene,
        renderScene,
        outputStart: range.start,
        outputEnd: range.end,
      });
    }
  }

  // 按输出时间排序
  results.sort((a, b) => a.outputStart - b.outputStart);

  return results;
}
