import type { Step1Atom } from "./step1.js";

const SUPPORTED_TEMPLATES = new Set([
  "hero_text",
  "number_center",
  "warning_alert",
  "list_fade",
  "body_annotate",
  "step_arrow",
  "branch_path",
  "brick_stack",
  "split_column",
  "myth_buster",
  "vertical_timeline",
  "asset_clip",
]);

export const SYSTEM_PROMPT_STEP2 = `你是医学科普视频的视觉编排专家。任务：为已分组的语义结构选择渲染模板，并提取屏幕展示条目。

输入：
- 文本已经按 scene 和 logic block 分组
- 每个 logic block 只包含 keep 内容的拼接文本
- 文本顺序已经固定，你不能重排结构
- 附带可用素材场景列表（用于 asset_clip 模板）

你的任务：
1. 为每个 scene 起短标题，并选择画面模式：overlay
2. 为每个 logic block 选择最匹配的渲染模板
3. 为每个 logic block 提炼可上屏的 items
4. 为需要额外参数的模板填写 template_props

模板选择：
你必须严格从下面这些模板名中选择，不得自造模板名，不得使用别名：
- hero_text
- number_center
- warning_alert
- list_fade
- body_annotate
- step_arrow
- branch_path
- brick_stack
- split_column
- myth_buster
- vertical_timeline
- asset_clip

先判断 logic block 的语义模式，再选最匹配的模板：
- 具体的器官结构/病理过程/手术过程/药物机制，且可用素材列表中有匹配的场景 -> asset_clip
- 因果递进 -> step_arrow
- 多因素汇聚到结果 -> brick_stack
- 对比 / 对照 -> split_column
- 误区纠正 -> myth_buster
- 关键数字 -> number_center
- 警示 / 后果 -> warning_alert
- 条件分叉 -> branch_path
- 时间线 / 阶段变化 -> vertical_timeline
- 并列要点 / 分类列举 -> list_fade
- 部位标注 -> body_annotate
- 金句 / 点题 / 结论 / 开场 / 收尾 / 过渡 -> hero_text

关于 asset_clip 模板：
- 仅当 logic block 描述了可视化的医学过程（器官工作、病理变化、手术操作、药物机制等），且输入中的「可用素材场景」列表里有匹配项时，才选 asset_clip
- 如果内容虽涉及医学，但可用素材中没有对应的场景，不要选 asset_clip，退回其他文字模板
- asset_clip 的 items 只需 1 条，描述这段需要什么画面
- 选了 asset_clip 后，必须输出 ASSET: <素材场景名>，从可用素材列表中精确选择一个
- 不要对观点表达、情感、金句、总结、提问等内容选 asset_clip

关于 hero_text 模板：
- hero_text 仅用于金句、点题、情感表达、开场引出、结尾总结等短句
- 如果内容包含具体的医学事实或可视化过程，不要用 hero_text，优先选 asset_clip 或其他结构化模板
- hero_text 不应连续出现超过 3 次，如果发现连续多段都倾向 hero_text，重新审视是否有更好的模板

items 数量约束：
- hero_text = 1
- number_center = 1
- warning_alert = 1-2
- list_fade = 2-6
- body_annotate = 2-5
- step_arrow = 2-5
- branch_path = 3
- brick_stack = 3-6
- split_column = 偶数
- myth_buster = 偶数
- vertical_timeline = 2-6
- asset_clip = 1

结构化模板要求：
- split_column：items 必须左右交替排列，并提供 template_props.left_label / right_label
- myth_buster：items 必须按”误区 / 正解”成对出现，并提供 template_props.dosCount
- number_center：items[0].text 应是核心数字本体，说明写入 template_props.context / unit
- branch_path：3 个 items 依次表示”条件 / 正向结果 / 负向结果”
- vertical_timeline：每个 item 应尽量体现”阶段或时间 + 内容”
- asset_clip：items[0].text 描述需要的画面内容
- 未使用额外参数时，template_props 也必须输出 {}

items 规则：
- 每条 text 不超过 18 个字
- 每条都要语义完整，能独立理解
- items 是屏幕展示语，不是 transcript 原文回显，也不是标题党改写
- 先保证语义准确和信息结构清晰，再考虑视觉简洁
- 每条 item 都应该带 emoji 字段，用来做视觉焦点
- emoji 要和内容语义匹配（如鱼→🐟、药丸→💊、心脏→🫀、蔬菜→🥬、警告→⚠️）
- 不要用万能 emoji（如 ✅、📌、💡），要用具体的、有画面感的 emoji
- emoji 只放在 emoji 字段里，text 里不要重复写 emoji

硬性约束：
- 按输入的 scene 和 logic block 顺序逐个输出
- scenes 数量必须与输入 scene 数量完全一致
- 每个 scene.logic_segments 数量必须与该 scene 的 logic_blocks 数量完全一致
- 不得合并 logic block
- 不得跳过 logic block
- 不得把后一个 logic block 的内容提前写进前一个 logic block
- 即使某个 logic block 很短，也必须保留为独立 logic_segment
- 如果内容较短或信息量不足，选择最保守、最匹配的模板，不要和相邻块合并
- 不要回显原文
- 只输出格式规定的纯文本行，不要 JSON，不要解释，不要代码块

输出格式（纯文本行，不要花括号、方括号）：

TITLE: 视频标题

SCENE 1 | overlay | 场景短标题
SEG 1 | hero_text | 语义功能描述
ITEM: 🫀 核心表达

SCENE 2 | overlay | 场景短标题
SEG 1 | asset_clip | 血管堵塞的病理过程
ITEM: 🫀 血栓堵塞冠状动脉
ASSET: 斑块破裂→急性血栓
SEG 2 | step_arrow | 因果递进
ITEM: 🔬 第一步内容
ITEM: 💊 第二步内容
ITEM: ✅ 最终结果
SEG 3 | split_column | 对比分析
ITEM: ❌ 错误做法
ITEM: ✅ 正确做法
PROP: left_label=错误认知
PROP: right_label=科学依据

格式规则：
- SCENE <n> | overlay | <场景短标题>
- SEG <n> | <模板名> | <语义功能描述>
- ITEM: <emoji> <文字>（每条 item 一行，emoji 和文字之间一个空格）
- PROP: <属性名>=<属性值>（有额外参数的模板才写，其余不要写 PROP 行）
- ASSET: <素材场景名>（仅 asset_clip 模板需要，从可用素材列表中选择）`;

// ─── Marked-text parser ───────────────────────────────────────────────────────

export interface ParsedStep2Segment {
  transition_type: string;
  template: string;
  items: Array<{ text: string; emoji?: string }>;
  template_props: Record<string, string | number>;
  asset_sub_scene?: string;
}

export interface ParsedStep2Scene {
  title: string;
  view: string;
  logic_segments: ParsedStep2Segment[];
}

export interface ParsedStep2Result {
  title: string;
  scenes: ParsedStep2Scene[];
}

/**
 * 解析 step2 非 JSON 标记文本输出。
 *
 * 格式（每行一条指令，顺序决定归属）：
 *   TITLE: <视频标题>
 *   SCENE <n> | <overlay|graphics> | <场景标题>
 *   SEG <n> | <模板名> | <语义功能描述>
 *   ITEM: <emoji> <文字>
 *   PROP: <key>=<value>
 */
export function parseStep2MarkedText(text: string): ParsedStep2Result {
  const result: ParsedStep2Result = { title: "", scenes: [] };
  let currentScene: ParsedStep2Scene | null = null;
  let currentSeg: ParsedStep2Segment | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("TITLE:")) {
      result.title = line.slice(6).trim();
      continue;
    }

    if (/^SCENE\s+\d+\s*\|/i.test(line)) {
      // SCENE 1 | overlay | 场景标题
      const afterKeyword = line.replace(/^SCENE\s+\d+\s*\|\s*/i, "");
      const pipeIdx = afterKeyword.indexOf("|");
      const view = pipeIdx >= 0 ? afterKeyword.slice(0, pipeIdx).trim() : afterKeyword.trim();
      const sceneTitle = pipeIdx >= 0 ? afterKeyword.slice(pipeIdx + 1).trim() : "";
      currentScene = { title: sceneTitle, view: view || "overlay", logic_segments: [] };
      currentSeg = null;
      result.scenes.push(currentScene);
      continue;
    }

    if (/^SEG\s+\d+\s*\|/i.test(line)) {
      // SEG 1 | hero_text | 语义功能描述
      const afterKeyword = line.replace(/^SEG\s+\d+\s*\|\s*/i, "");
      const pipeIdx = afterKeyword.indexOf("|");
      const template = pipeIdx >= 0 ? afterKeyword.slice(0, pipeIdx).trim() : afterKeyword.trim();
      const transitionType = pipeIdx >= 0 ? afterKeyword.slice(pipeIdx + 1).trim() : "";
      currentSeg = { transition_type: transitionType, template, items: [], template_props: {} };
      if (currentScene) currentScene.logic_segments.push(currentSeg);
      continue;
    }

    if (/^ITEM:\s*/i.test(line)) {
      // ITEM: 🦠 文字内容
      const rest = line.replace(/^ITEM:\s*/i, "");
      const spaceIdx = rest.indexOf(" ");
      let emoji: string | undefined;
      let itemText: string;
      if (spaceIdx > 0) {
        emoji = rest.slice(0, spaceIdx);
        itemText = rest.slice(spaceIdx + 1).trim();
      } else {
        itemText = rest;
      }
      if (currentSeg && itemText) {
        currentSeg.items.push({ text: itemText, ...(emoji ? { emoji } : {}) });
      }
      continue;
    }

    if (/^PROP:\s*/i.test(line)) {
      // PROP: left_label=对比左侧
      const rest = line.replace(/^PROP:\s*/i, "");
      const eqIdx = rest.indexOf("=");
      if (eqIdx > 0 && currentSeg) {
        const key = rest.slice(0, eqIdx).trim();
        const rawVal = rest.slice(eqIdx + 1).trim();
        const numVal = Number(rawVal);
        currentSeg.template_props[key] = !isNaN(numVal) && rawVal !== "" ? numVal : rawVal;
      }
      continue;
    }

    if (/^ASSET:\s*/i.test(line)) {
      // ASSET: 斑块破裂→急性血栓
      const rest = line.replace(/^ASSET:\s*/i, "").trim();
      if (currentSeg && rest) {
        currentSeg.asset_sub_scene = rest;
      }
      continue;
    }

    // Any other line (LLM preamble, comments, etc.) — silently ignore
  }

  return result;
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

interface GroupedLogicBlock {
  keepText: string;
  atomIds: number[];
}

interface GroupedScene {
  logicBlocks: GroupedLogicBlock[];
}

function dedupeTexts(texts: string[]): string[] {
  const result: string[] = [];
  for (const text of texts) {
    const value = text.trim();
    if (!value) continue;
    if (result[result.length - 1] === value) continue;
    result.push(value.length > 18 ? value.slice(0, 18) : value);
  }
  return result;
}

function pickFallbackItems(blockAtoms: Step1Atom[]): Array<{ text: string; emoji?: string }> {
  const keepTexts = dedupeTexts(
    blockAtoms.filter((atom) => atom.status === "keep").map((atom) => atom.text)
  );

  if (keepTexts.length === 0) {
    return [{ text: "待人工确认", emoji: "*" }];
  }

  return keepTexts.slice(0, 5).map((text, index) => ({
    text,
    ...(keepTexts.length === 1 && index === 0 ? { emoji: "*" } : {}),
  }));
}

function pickFallbackTemplate(items: Array<{ text: string; emoji?: string }>): string {
  return items.length === 1 ? "hero_text" : "list_fade";
}

function normalizeTemplate(template: unknown, items: Array<{ text: string; emoji?: string }>): string {
  if (typeof template === "string" && SUPPORTED_TEMPLATES.has(template)) {
    return template;
  }

  const alias = typeof template === "string" ? template.trim().toLowerCase() : "";
  if (alias === "bullet_list" || alias === "bullet-list" || alias === "list") {
    return "list_fade";
  }

  return pickFallbackTemplate(items);
}

export function groupStep1Atoms(step1Result: { atoms?: Step1Atom[] }): GroupedScene[] {
  const atoms = step1Result.atoms ?? [];
  const scenes: GroupedScene[] = [];
  let currentScene: GroupedScene | null = null;
  let currentBlock: GroupedLogicBlock | null = null;

  for (const atom of atoms) {
    if (!currentScene || atom.boundary === "scene") {
      currentBlock = { keepText: "", atomIds: [] };
      currentScene = { logicBlocks: [currentBlock] };
      scenes.push(currentScene);
    } else if (atom.boundary === "logic" || !currentBlock) {
      currentBlock = { keepText: "", atomIds: [] };
      currentScene.logicBlocks.push(currentBlock);
    }

    currentBlock.atomIds.push(atom.id);
    if (atom.status === "keep") {
      currentBlock.keepText += atom.text;
    }
  }

  return scenes;
}

export function buildUserPromptStep2(
  step1Result: { atoms?: Step1Atom[] },
  _words: Array<{ text: string; start: number; end: number }>,
  availableAssetSubScenes?: string[]
): string {
  const grouped = groupStep1Atoms(step1Result);
  const input = grouped.map((scene, sceneIndex) => ({
    scene: sceneIndex + 1,
    logic_block_count: scene.logicBlocks.length,
    logic_blocks: scene.logicBlocks.map((logicBlock, logicIndex) => ({
      block: logicIndex + 1,
      text: logicBlock.keepText,
    })),
  }));

  const parts = [
    `Scenes: ${grouped.length}`,
    `Logic blocks: ${grouped.reduce((sum, scene) => sum + scene.logicBlocks.length, 0)}`,
    "请严格保持 scene 和 logic block 数量一致。",
    "请不要回显原文，只输出结构化决策。",
    JSON.stringify(input),
  ];

  if (availableAssetSubScenes && availableAssetSubScenes.length > 0) {
    parts.push(
      "可用素材场景列表（选择 asset_clip 时只能从这里选）：",
      availableAssetSubScenes.map((s) => `- ${s}`).join("\n")
    );
  } else {
    parts.push("当前无可用素材，不要选择 asset_clip 模板。");
  }

  return parts.join("\n\n");
}

function buildFallbackSegment(
  sceneIndex: number,
  logicIndex: number,
  groupedBlock: GroupedLogicBlock,
  atomById: Map<number, Step1Atom>,
  step2Segment?: any
) {
  const blockAtoms = groupedBlock.atomIds
    .map((id) => atomById.get(id))
    .filter((atom): atom is Step1Atom => Boolean(atom));

  const items =
    Array.isArray(step2Segment?.items) && step2Segment.items.length > 0
      ? step2Segment.items
      : pickFallbackItems(blockAtoms);
  const template = normalizeTemplate(step2Segment?.template, items);

  return {
    id: `S${sceneIndex + 1}-L${logicIndex + 1}`,
    transition_type:
      step2Segment?.transition_type ||
      `Logic block ${sceneIndex + 1}-${logicIndex + 1}`,
    template,
    items,
    atoms: blockAtoms.map((atom) => {
      const result: any = {
        id: atom.id,
        start_id: atom.start_id,
        end_id: atom.end_id,
        text: atom.text,
        time: {
          start: atom.time.s,
          end: atom.time.e,
        },
        status: atom.status,
      };
      if (atom.audio_span_id) {
        result.audio_span_id = atom.audio_span_id;
      }
      if (atom.status === "discard" && atom.reason) {
        result.reason = atom.reason;
      }
      return result;
    }),
    template_props: step2Segment?.template_props || {},
    ...(step2Segment?.asset_sub_scene
      ? { asset_sub_scene: step2Segment.asset_sub_scene }
      : {}),
  };
}

export function buildSubtitleOnlyBlueprint(
  step1Result: { atoms?: Step1Atom[] },
  title = "医生字幕版"
): any {
  const grouped = groupStep1Atoms(step1Result);
  const atoms = step1Result.atoms ?? [];
  const atomById = new Map<number, Step1Atom>(atoms.map((atom) => [atom.id, atom]));

  return {
    title,
    scenes: grouped.map((scene, sceneIndex) => ({
      id: `S${sceneIndex + 1}`,
      title: `口播片段 ${sceneIndex + 1}`,
      view: "overlay",
      logic_segments: scene.logicBlocks.map((groupedBlock, logicIndex) =>
        buildFallbackSegment(
          sceneIndex,
          logicIndex,
          groupedBlock,
          atomById,
          {
            transition_type: "subtitle_only",
            template: "subtitle_only",
            items: [],
            template_props: {},
          }
        )
      ),
    })),
  };
}

export function mergeStep2WithAtoms(
  step1Result: { atoms?: Step1Atom[] },
  step2Result: any
): any {
  const grouped = groupStep1Atoms(step1Result);
  const atoms = step1Result.atoms ?? [];
  const atomById = new Map<number, Step1Atom>(atoms.map((atom) => [atom.id, atom]));
  const scenes = Array.isArray(step2Result?.scenes) ? step2Result.scenes : [];

  const merged: any = {
    title: step2Result?.title || "",
    scenes: [],
  };

  const sceneCount = Math.max(grouped.length, scenes.length);
  for (let sceneIndex = 0; sceneIndex < sceneCount; sceneIndex++) {
    const groupedScene = grouped[sceneIndex];
    if (!groupedScene) {
      continue;
    }

    const step2Scene = scenes[sceneIndex] || {};
    const mergedScene: any = {
      id: `S${sceneIndex + 1}`,
      title: step2Scene.title || `Scene ${sceneIndex + 1}`,
      view: step2Scene.view || "overlay",
      logic_segments: [],
    };

    const segments = Array.isArray(step2Scene.logic_segments)
      ? step2Scene.logic_segments
      : [];
    const logicCount = Math.max(groupedScene.logicBlocks.length, segments.length);

    for (let logicIndex = 0; logicIndex < logicCount; logicIndex++) {
      const groupedBlock = groupedScene.logicBlocks[logicIndex];
      if (!groupedBlock) {
        continue;
      }
      mergedScene.logic_segments.push(
        buildFallbackSegment(
          sceneIndex,
          logicIndex,
          groupedBlock,
          atomById,
          segments[logicIndex]
        )
      );
    }

    merged.scenes.push(mergedScene);
  }

  return merged;
}
