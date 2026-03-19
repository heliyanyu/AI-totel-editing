export const SYSTEM_PROMPT_STEP2 = `你是医学科普视频的视觉编排专家。任务：为已分组的语义结构选择渲染模板，提取展示条目。

## 输入

已按场景和逻辑块分组的文本。每个逻辑块只包含 keep 内容的拼接文本。

## 任务

1. 为每个场景命名、选画面模式（overlay/graphics）
2. 为每个逻辑块选渲染模板、描述语义功能
3. 从文本内容提炼 items 供模板展示

## 画面模式
- overlay：医生出镜 + 叠加图形（开场、总结、金句、情感表达）
- graphics：纯信息图形全屏（列表、因果链、对比等信息密集段）
- 合理交替

## 模板选择
先判断逻辑块的语义模式，再选最匹配的模板：
- 因果递进 → step_arrow        - 多因素→结果 → brick_stack
- 对比/对照 → split_column      - 误区纠正 → myth_buster
- 关键数字 → number_center      - 概念解释 → term_card
- 警示/后果 → warning_alert     - 条件分叉 → branch_path
- 时间线 → vertical_timeline    - 金句/点题 → hero_text
- 并列要点 → list_fade / color_grid
- 画面叠字 → image_overlay      - 部位标注 → body_annotate
- 分级表格 → category_table

模板 items 数量：
hero_text=1, number_center=1, warning_alert=1-2, term_card=2,
image_overlay=1-2, list_fade=2-6, color_grid=2-4, body_annotate=2-5,
step_arrow=2-5, branch_path=3, brick_stack=3-6,
split_column/myth_buster/category_table=偶数, vertical_timeline=2-6

split_column 需 props.left_label/right_label, myth_buster 需 props.dosCount,
number_center 需 props.context/unit

## items 规则
- 每条 ≤ 18字，语义完整，能独立理解
- 尽量带 emoji（hero_text 必带）
- 从文本内容概括提炼

## 输出 JSON

按输入的场景和逻辑块顺序，逐个输出决策。不要回显原文。
- 输出的 scenes 数量必须与输入场景数量完全一致
- 每个 scene.logic_segments 数量必须与该 scene 的 logic_blocks 数量完全一致
- 不得合并逻辑块，不得跳过逻辑块，不得把后一个逻辑块的内容提前写进前一个逻辑块
- 即使某个逻辑块内容较短，也必须保留为独立 logic_segment

{
  "title": "视频标题（2-10字）",
  "scenes": [
    {
      "title": "场景短标题",
      "view": "overlay|graphics",
      "logic_segments": [
        {
          "transition_type": "语义功能描述",
          "template": "模板名",
          "items": [{"text": "≤18字", "emoji": "🫀"}],
          "template_props": {}
        }
      ]
    }
  ]
}`;

interface Step1Atom {
  id: number;
  text: string;
  time: { s: number; e: number };
  status: "keep" | "discard";
  boundary?: "scene" | "logic";
  reason?: string;
  audio_span_id?: string;
}

interface GroupedLogicBlock {
  keepText: string;
  atomIds: number[];
}

interface GroupedScene {
  logicBlocks: GroupedLogicBlock[];
}

export function groupStep1Atoms(step1Result: any): GroupedScene[] {
  const atoms: Step1Atom[] = step1Result.atoms || [];
  const scenes: GroupedScene[] = [];
  let currentScene: GroupedScene | null = null;
  let currentBlock: GroupedLogicBlock | null = null;

  for (const atom of atoms) {
    if (atom.boundary === "scene" || !currentScene) {
      currentBlock = { keepText: "", atomIds: [] };
      currentScene = { logicBlocks: [currentBlock] };
      scenes.push(currentScene);
    } else if (atom.boundary === "logic") {
      currentBlock = { keepText: "", atomIds: [] };
      currentScene.logicBlocks.push(currentBlock);
    }
    currentBlock!.atomIds.push(atom.id);
    if (atom.status === "keep") {
      currentBlock!.keepText += atom.text;
    }
  }

  return scenes;
}

export function buildUserPromptStep2(
  step1Result: any,
  words: Array<{ text: string; start: number; end: number }>
): string {
  const grouped = groupStep1Atoms(step1Result);

  const input = grouped.map((scene, si) => ({
    scene: si + 1,
    logic_block_count: scene.logicBlocks.length,
    logic_blocks: scene.logicBlocks.map((lb, li) => ({
      block: li + 1,
      text: lb.keepText,
    })),
  }));

  return `${grouped.length} 个场景，${grouped.reduce((s, sc) => s + sc.logicBlocks.length, 0)} 个逻辑块。为每个场景选 view、命名，为每个逻辑块选模板、提炼 items。仅输出 JSON。

硬性约束：
- scenes 数量必须等于 ${grouped.length}
- 每个 scene.logic_segments 数量必须严格等于对应的 logic_block_count
- 任何一个 logic_block 都不能省略、合并或跨块挪用内容

${JSON.stringify(input)}`;
}

function truncateItemText(text: string, max = 18): string {
  const value = (text || "").trim();
  if (!value) return "";
  return value.length > max ? value.slice(0, max) : value;
}

function dedupeTexts(texts: string[]): string[] {
  const result: string[] = [];
  for (const text of texts) {
    const value = truncateItemText(text);
    if (!value) continue;
    if (result[result.length - 1] === value) continue;
    result.push(value);
  }
  return result;
}

function buildFallbackSegment(
  sceneIndex: number,
  logicIndex: number,
  groupedBlock: GroupedLogicBlock,
  atomById: Map<number, Step1Atom>,
  s2seg?: any
) {
  const blockAtoms = groupedBlock.atomIds
    .map((id) => atomById.get(id))
    .filter((atom): atom is Step1Atom => Boolean(atom));

  const keepTexts = dedupeTexts(
    blockAtoms
      .filter((atom) => atom.status === "keep")
      .map((atom) => atom.text)
  );

  const items =
    keepTexts.length > 0
      ? keepTexts.slice(0, 5).map((text, index) => ({
          text,
          ...(keepTexts.length === 1 && index === 0 ? { emoji: "📝" } : {}),
        }))
      : [{ text: "待人工确认", emoji: "📝" }];

  const template =
    s2seg?.template ||
    (items.length === 1 ? "hero_text" : items.length === 2 ? "term_card" : "list_fade");

  return {
    id: `S${sceneIndex + 1}-L${logicIndex + 1}`,
    transition_type:
      s2seg?.transition_type ||
      `Step2缺失，待人工确认：${truncateItemText(groupedBlock.keepText, 24) || "未命名逻辑块"}`,
    template,
    items: s2seg?.items?.length ? s2seg.items : items,
    atoms: blockAtoms.map((a) => {
      const obj: any = {
        id: a.id,
        text: a.text,
        time: { start: a.time.s, end: a.time.e },
        status: a.status,
      };
      if (a.audio_span_id) obj.audio_span_id = a.audio_span_id;
      if (a.status === "discard" && a.reason) obj.reason = a.reason;
      return obj;
    }),
    template_props: s2seg?.template_props || {},
  };
}

export function mergeStep2WithAtoms(step1Result: any, step2Result: any): any {
  const grouped = groupStep1Atoms(step1Result);
  const atoms: Step1Atom[] = step1Result.atoms || [];

  const atomById = new Map<number, Step1Atom>();
  for (const a of atoms) atomById.set(a.id, a);

  const scenes = step2Result.scenes || [];
  const merged: any = {
    title: step2Result.title || "",
    scenes: [],
  };

  const sceneCount = Math.max(grouped.length, scenes.length);
  for (let si = 0; si < sceneCount; si++) {
    const s2scene = scenes[si] || {};
    const groupedScene = grouped[si];
    if (!groupedScene) continue;

    const mergedScene: any = {
      id: `S${si + 1}`,
      title: s2scene.title || `场景${si + 1}`,
      view: s2scene.view || "overlay",
      logic_segments: [],
    };

    const segments = s2scene.logic_segments || [];
    const logicCount = Math.max(groupedScene.logicBlocks.length, segments.length);
    for (let li = 0; li < logicCount; li++) {
      const s2seg = segments[li];
      const groupedBlock = groupedScene.logicBlocks[li];
      if (!groupedBlock && !s2seg) continue;
      if (!groupedBlock) continue;
      const mergedSeg = buildFallbackSegment(si, li, groupedBlock, atomById, s2seg);
      mergedScene.logic_segments.push(mergedSeg);
    }

    merged.scenes.push(mergedScene);
  }

  return merged;
}
