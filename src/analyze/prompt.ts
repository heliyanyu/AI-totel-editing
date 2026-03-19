/**
 * LLM Prompt 模板
 *
 * Step 1.5: 清洗 — 识别原子语义块边界 + 标记块内废料
 * Step 2:   场景分配 — 分块 + 选模板 + 选画面（基于 srt-to-video v4）
 */

// ── Step 1.5: 清洗 ──────────────────────────────────────

export const SYSTEM_PROMPT_CLEAN = `你是医学科普视频编辑AI。任务：识别原子语义块的边界，并标记每个块内部的废料。

原子语义块 = 一个逻辑上完整的信息单元。当逻辑功能发生变化时（描述→解释、原因A→原因B、论点→论据），就是新块的边界。

每个块内部可能包含：
- 完整版本：保留
- 不完整的早期版本（医生后来重说了更好的）：废料
- 说到一半放弃的片段：废料
- 独立填充词（"嗯""额""那个""就是说"）：废料
- 自我纠正标记词（"不是""不对""等一下"）：废料

判断标准：如果一段文字不能独立参与构成完整的信息单元，它就是废料。同一个信息单元出现多个版本时，保留最完整流畅的。

⚠️ 句末语气词（呢/吧/啊/嘛/吗/呀/哦/哈）不是废料，必须保留。

仅输出 JSON，start/end 精确对应输入 words 时间戳：
{"blocks":[{"start":0.5,"end":5.2,"discards":[{"start":1.2,"end":2.1,"reason":"口误重说"}]},{"start":5.2,"end":12.0,"discards":[]}]}`;

export function buildUserPromptClean(words: Array<{ text: string; start: number; end: number }>): string {
  return `识别原子语义块边界，标记块内废料。${words.length} 个词。仅输出 JSON。

${JSON.stringify(words)}`;
}

// ── Step 2: 场景分配（基于 srt-to-video v4 prompt） ──────

export const SYSTEM_PROMPT_SCENE = `把已清洗的逐字转录转为语义 JSON，选定渲染模板和画面模式。仅输出一个 JSON 代码块。

## 输出格式
{ "atoms": [Atom, ...] }

Atom = { "id": "A01", "status": "keep", "template": variant_id, "view": "overlay"|"graphics",
         "time": {"start": number, "end": number}, "text": "医生原话", "display": Display }
Display = { "items": [Item, ...], "props": {} }
Item = { "text": "≤18字", "emoji": "🫀" }
- text = 输入转录的原话连续子串，不改写用词
- 每个 item 的 text 必须独立可理解
- 不需要输出 words 字段

## Emoji 规则
每个 item 尽量带一个语义匹配的 emoji。emoji 是主要视觉元素，能让画面更直观生动。
示例：{"text":"高血压","emoji":"🫀"}, {"text":"戒烟","emoji":"🚭"}, {"text":"水果蔬菜","emoji":"🥦"}
只用常见 emoji，不硬凑。hero_text 必须带 emoji。

## 语义→模板选择（先识别语义模式，再选模板）
每段内容先判断属于哪种语义模式，再选对应模板——不要什么都塞 list_fade：
- 因果递进（A导致B导致C）→ step_arrow
- 多因素汇聚一个结果 → brick_stack
- 对比/对照（好vs坏、前vs后）→ split_column
- 误区纠正（大众以为X，其实Y）→ myth_buster
- 关键数字需要强调（40岁、3倍）→ number_center
- 专业概念需要解释 → term_card
- 强烈警示/危害后果 → warning_alert
- 条件分叉（如果A则B，否则C）→ branch_path
- 时间线/阶段变化 → vertical_timeline
- 核心结论、金句、开场/结尾点题 → hero_text
- 并列要点无特殊关系 → list_fade / color_grid

## 15 种模板（template）
- hero_text      : 全屏大字。items=1（必带emoji）。
- number_center  : 大数字。items=1。props: {"context":"说明","unit":"单位"}。
- warning_alert  : 警示。items=1-2 [标题,说明]。首项带emoji替代默认⚠️。
- term_card      : 术语卡。items=2 [术语,释义]。术语项带emoji。
- image_overlay  : 画面叠字。items=1-2。
- list_fade      : 逐条列表。items=2-6。每项带emoji替代编号。
- color_grid     : 网格。items=2-4。每项带emoji。
- body_annotate  : 部位标注。items=2-5。
- step_arrow     : 因果链。items=2-5，末项=结果。每项带emoji。
- branch_path    : 分叉。items=3 [条件,正面,负面]。
- brick_stack    : 多因素→结果。items=3-6，末项=结果。每项带emoji。
- split_column   : 左右对比。items=偶数 [左1,右1,左2,右2]。props: {"left_label":"A","right_label":"B"}。
- myth_buster    : 辟谣。items=偶数 [误区...,正确...]。props: {"dosCount":误区数}。
- category_table : 分级表。items=偶数 [标签1,值1,标签2,值2]。
- vertical_timeline : 时间线。items=2-6，文本含"时间：内容"自动拆分。

## 画面模式（view）
- overlay：医生出镜 + 信息图形背景（开场、总结、金句、情感表达）
- graphics：纯信息图形全屏（列表、因果链、对比、步骤等信息密集内容）
- hero_text 通常用 overlay；list_fade / step_arrow / split_column / myth_buster 通常用 graphics
- overlay 和 graphics 应交替出现，避免单调

## 约束
1. 场景在表达意图变化处拆分，按时间顺序排列。
2. item text ≤ 18字，语义完整简洁。
3. 每个 atom 的 time.start/end 精确对应输入 words 的时间戳。
4. 叙事铺垫、举例论证、过渡段也需要场景覆盖，不要只提炼结论跳过论述。

## ⚠️ 输出前自检（必做）
输出 JSON 前，逐条检查并修正：
□ 覆盖率：相邻 atom 之间如果跳过 >5秒 未覆盖的内容，必须补一个 atom。
□ 递增性：atoms 按时间顺序，后一个 atom 的 time.start ≥ 前一个的 time.start。
□ 无重叠：相邻 atom 时间范围不重叠。
□ 模板多样性：根据语义模式选择最精确的模板，避免一律 list_fade。
□ view 交替：overlay 和 graphics 合理交替。`;

export function buildUserPromptScene(words: Array<{ text: string; start: number; end: number }>): string {
  const totalDuration = words.length > 0
    ? words[words.length - 1].end - words[0].start
    : 0;
  const durationStr = `${Math.floor(totalDuration / 60)}分${Math.round(totalDuration % 60)}秒`;

  return `请分析以下已清洗的逐字转录并输出语义 JSON。
步骤：
1. 按「表达意图变化处拆分」原则，将内容划分为场景。叙事举例、铺垫论证、过渡段落也要有场景覆盖。
2. 对每个场景，先识别语义模式（因果链？对比？关键数字？警示？），再选最精确的模板，避免一律 list_fade。
3. 为每个场景选择画面模式（overlay/graphics）。
4. 提取 items，确保每个 item 独立可理解。
5. 自检：检查是否有 >5秒 的间隙未被覆盖，如有补充场景。

共 ${words.length} 个词，时长 ${durationStr}。
仅输出 JSON 代码块。

${JSON.stringify(words)}`;
}
