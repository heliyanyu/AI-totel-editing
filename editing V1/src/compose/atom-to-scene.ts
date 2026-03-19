// @ts-nocheck
/**
 * @deprecated 已被 segment-to-scene.ts 替代。
 * 保留供参考，新代码请使用 segmentToRenderScene()。
 */

import type {
  KeepAtom as KeptAtom,
  Word,
  TimingMap,
  TimingSegment,
  Scene,
  Item,
  SceneTimeline,
  TemplateId,
} from "../schemas/blueprint";

// 场景动画参数
const ENTER_LEAD_MS = 600;
const EXIT_DURATION_MS = 300;
const MIN_ITEM_GAP_MS = 300;

/**
 * 在 words 序列中查找 item 文本首次出现的位置，返回对应 word 的 start 时间。
 *
 * 策略：取 item text 的前几个关键字符，在 words 拼接文本中顺序查找。
 * 找到后返回该位置对应的 word.start（相对于 atom 起始的偏移 ms）。
 */
function findItemAnchorInWords(
  itemText: string,
  words: Word[],
  atomOriginalStart: number
): number | null {
  // 去标点，提取搜索关键字（取前4个汉字或全部，足以定位）
  const clean = itemText.replace(/[^\u4e00-\u9fff\w]/g, "");
  const searchKey = clean.slice(0, 4);
  if (searchKey.length < 2) return null;

  // 构建 words 拼接文本和字符→word 映射
  let accumulated = "";
  const charToWord: Word[] = [];
  for (const word of words) {
    const wordClean = word.text.replace(/[^\u4e00-\u9fff\w]/g, "");
    for (const ch of wordClean) {
      accumulated += ch;
      charToWord.push(word);
    }
  }

  // 在拼接文本中查找搜索关键字
  const idx = accumulated.indexOf(searchKey);
  if (idx === -1) return null;

  const matchedWord = charToWord[idx];
  return (matchedWord.start - atomOriginalStart) * 1000;
}

/**
 * 计算每个 item 的 anchor_offset_ms
 *
 * 优先用 words 时间戳定位 item 出现时机；
 * 找不到时回退到均匀分布在 atom 说话时段内。
 */
function computeAnchorOffsets(
  atom: KeptAtom,
  rawItems: Array<{ text: string; emoji?: string }>,
  atomDurationMs: number
): number[] {
  const count = rawItems.length;
  if (count === 0) return [];

  const words = atom.words ?? [];
  const atomStart = atom.time.start;

  // 先尝试 word-based 定位
  const anchors: (number | null)[] = rawItems.map((item) =>
    words.length > 0
      ? findItemAnchorInWords(item.text, words, atomStart)
      : null
  );

  // 回退策略：均匀分布在 [ENTER_LEAD, 70% of atom duration]
  const anchorStart = ENTER_LEAD_MS;
  const anchorEnd = Math.max(anchorStart + 500, atomDurationMs * 0.7);
  const span = anchorEnd - anchorStart;

  const resolved: number[] = anchors.map((a, i) => {
    if (a !== null && a >= 0) return a;
    // 均匀分布回退
    return count === 1
      ? anchorStart
      : Math.round(anchorStart + (i / (count - 1)) * span);
  });

  // 排序（保持原始顺序，但确保单调递增）
  for (let i = 1; i < resolved.length; i++) {
    if (resolved[i] < resolved[i - 1] + MIN_ITEM_GAP_MS) {
      resolved[i] = resolved[i - 1] + MIN_ITEM_GAP_MS;
    }
  }

  // 确保不超过 dwell 范围
  const maxAnchor = atomDurationMs - EXIT_DURATION_MS - 200;
  return resolved.map((a) => Math.min(a, Math.max(maxAnchor, anchorStart)));
}

/**
 * 从统一 display 格式提取 v4 Item 数组，附带 word-based anchor offsets
 */
function extractItems(atom: KeptAtom, atomDurationMs: number): Item[] {
  const display = atom.display as {
    items?: Array<{ text: string; emoji?: string }>;
    props?: Record<string, unknown>;
  };
  const rawItems = display.items ?? [];
  const offsets = computeAnchorOffsets(atom, rawItems, atomDurationMs);

  return rawItems.map((item, i) => ({
    text: item.text,
    emoji: item.emoji,
    anchor_offset_ms: offsets[i] ?? ENTER_LEAD_MS + i * MIN_ITEM_GAP_MS,
  }));
}

/**
 * 提取模板特殊 props（split_column, myth_buster, number_center 等）
 */
function extractProps(atom: KeptAtom): Record<string, unknown> {
  const display = atom.display as { props?: Record<string, unknown> };
  return display.props ?? {};
}

/**
 * 将 KeptAtom + timing 信息转换为 Scene
 *
 * 时间线策略：
 * - enter_ms = 0（场景从 atom 开头开始）
 * - first_anchor_ms = ENTER_LEAD（600ms 入场动画后内容出现）
 * - dwell_end_ms = atomDuration - EXIT_DURATION（模板保持到 atom 快结束）
 * - exit_end_ms = atomDuration（退出动画结束 = atom 结束）
 */
export function atomToScene(
  atom: KeptAtom,
  timingSegment: TimingSegment
): Scene {
  const outputStart = timingSegment.output.start * 1000;
  const outputEnd = timingSegment.output.end * 1000;
  const atomDuration = outputEnd - outputStart;

  const items = extractItems(atom, atomDuration);

  const firstAnchorMs = Math.min(ENTER_LEAD_MS, atomDuration * 0.15);
  const dwellEndMs = Math.max(
    firstAnchorMs + 500,
    atomDuration - EXIT_DURATION_MS
  );

  const timeline: SceneTimeline = {
    enter_ms: 0,
    first_anchor_ms: firstAnchorMs,
    dwell_end_ms: dwellEndMs,
    exit_end_ms: atomDuration,
  };

  return {
    id: atom.id,
    topic_id: "auto",
    variant_id: atom.template,
    timeline,
    items,
    template_props: extractProps(atom),
  };
}

/**
 * 将所有 KeptAtom 转换为 Scene 数组
 */
export function atomsToScenes(
  atoms: KeptAtom[],
  timingMap: TimingMap
): Scene[] {
  return atoms
    .map((atom) => {
      const segment = timingMap.segments.find((s) => s.atom_id === atom.id);
      if (!segment) {
        console.warn(`  警告: atom ${atom.id} 在 timing_map 中找不到对应段`);
        return null;
      }
      return atomToScene(atom, segment);
    })
    .filter((s): s is Scene => s !== null);
}
