import type { Word } from "../../schemas/blueprint.js";

export interface TakePassTake {
  start_id: number;
  end_id: number;
  reason?: string;
}

export interface TakePassDiscardRange {
  start_id: number;
  end_id: number;
  reason?: string;
}

export interface TakePassResult {
  discard_ranges?: TakePassDiscardRange[];
  takes?: TakePassTake[];
}

type Step1AtomLike = {
  id: number;
  text: string;
  time: { s: number; e: number };
  status?: "keep" | "discard";
  boundary?: "scene" | "logic";
  reason?: string;
  audio_span_id?: string;
};

export const SYSTEM_PROMPT_TAKE_PASS = `你是医疗口播视频的 repair-pass 助手。

任务：
从按时间排序的 semantic atoms 中，找出应该删除的草稿、重启、重复起手和被后文覆盖的旧版本。

这一步不是最终 take 切块，也不是摘要，更不是压缩内容。
这一步只做一件事：
识别 repair chain 里哪些 atoms 是已经被后文覆盖的草稿，应该 discard。

所有 atoms 默认保留。
只有当一个 atom 或一段连续 atoms 明显是后文完整版本出现前的草稿、起手、重复开头、重说残留时，才把它放进 discard_ranges。

你要始终带着这个判断框架工作：

1. 从后往前看，而不是从前往后看。
2. 在一个局部连续 flow 里，后面出现的通顺版本，默认优先于前面的试说版本。
3. 如果后一句已经把前一句“重说了一遍并说得更完整”，前一句应删除。
4. 只有当前面的 atoms 是后一句不可缺少的必要前缀时，才把它们一起保留。
5. 如果拿不准，不要删除。

你要识别的典型现象：

A. restart / repair / 自我修正
这类要“删前留后”：
- “如果你 / 如果你长期睡不够” -> 删除前者
- “每周 / 每周至少三到五次” -> 删除前者
- “把它们 / 把它们安排好” -> 删除前者
- “之后呢 / 之后再根据你的情况来调药” -> 删除前者
- “减少 / 减少斑块里的炎症反应” -> 删除前者

B. 起手词 / 口头垫词 / 未提交草稿
这类通常应删除：
- “我们说”
- “就是说”
- “然后呢”
- “之后呢”
- “但如果你 / 但如果你……”
- 只说出一个开头又马上重来

C. 修辞性并列 / 列表 / 排比
这类不是 repair，不要误删：
- “好好吃饭 / 好好睡觉 / 好好活动”
- “快走 / 骑车 / 打太极”
- 并列列举、连续排比、节奏性重复强调

D. 短 atom 的处理
- 不要为了节奏、时长或摘要目的去删短 atom
- 只有当短 atom 明显是旧版本残留时，才删除
- 如果删掉一个范围会让剩余文本变成“动起来不能”“三到五次每次”“把它们把它们”这种残片，说明删法不对

具体决策流程：

第一步：先按时间顺序通读 atoms，但真正做判断时，要在每个局部连续片段内“从后往前”确认最终表达。
第二步：先找到最右侧那个已经自然、完整、可直接播出的表达。
第三步：再向左回看，判断前面的 atoms 是：
- 这个最终表达的必要组成部分
还是
- 被它覆盖掉的草稿、重启、重复开头、试说版本
第四步：必要组成部分保留；被覆盖的草稿加入 discard_ranges。
第五步：删除后，剩余 atoms 从左到右读起来仍应像正常说话，而不是散碎残片。

硬性约束：
1. 只能输出连续区间 discard_ranges。
2. 每个 discard range 必须是连续 atom id 范围。
3. discard_ranges 之间不得重叠。
4. 不要因为想“切分更漂亮”而删除。
5. 不要因为想“更精炼”而删除。
6. [scene] 是硬边界，判断时不要跨 scene 做覆盖。
7. [logic] 只是提示，不是硬边界。
8. 这是 repair-pass，不是最终 take 组装；你只负责删掉明确的草稿。

reason 的书写要求：
- reason 只描述“为什么这段应该删除”
- 明确指出它是被后文覆盖的草稿、起手、重复开头、restart 或旧版本
- 不要写泛泛的摘要理由

输出要求：
- 只输出 JSON
- 格式必须是：
{
  "discard_ranges": [
    { "start_id": 15, "end_id": 16, "reason": "这是后文完整版本出现前的重复起手，已被更顺的表达覆盖" }
  ]
}

如果没有明确应删的草稿，请输出：
{
  "discard_ranges": []
}`;

function atomText(atom: Step1AtomLike): string {
  return (atom.text ?? "").replace(/\s+/g, "");
}

function normalizeRanges(
  rawItems: unknown[],
  label: string
): Array<TakePassDiscardRange | TakePassTake> {
  return rawItems.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`take-pass ${label} 第 ${index + 1} 项不是对象`);
    }

    const start_id = Number((item as { start_id?: unknown }).start_id);
    const end_id = Number((item as { end_id?: unknown }).end_id);
    const reasonValue = (item as { reason?: unknown }).reason;
    const reason =
      typeof reasonValue === "string" && reasonValue.trim().length > 0
        ? reasonValue.trim()
        : undefined;

    if (!Number.isInteger(start_id) || !Number.isInteger(end_id)) {
      throw new Error(
        `take-pass ${label} 第 ${index + 1} 项缺少合法的 start_id/end_id`
      );
    }
    if (end_id < start_id) {
      throw new Error(
        `take-pass ${label} 第 ${index + 1} 项存在 end_id < start_id`
      );
    }

    return { start_id, end_id, reason };
  });
}

function normalizeTakePassResult(raw: unknown): TakePassResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("take-pass 结果不是对象");
  }

  const discardRanges = (raw as { discard_ranges?: unknown }).discard_ranges;
  if (Array.isArray(discardRanges)) {
    return {
      discard_ranges: normalizeRanges(
        discardRanges,
        "discard_ranges"
      ) as TakePassDiscardRange[],
    };
  }

  const takes = (raw as { takes?: unknown }).takes;
  if (Array.isArray(takes)) {
    return {
      takes: normalizeRanges(takes, "takes") as TakePassTake[],
    };
  }

  throw new Error("take-pass 结果缺少 discard_ranges 数组");
}

export { normalizeTakePassResult };

export function buildUserPromptTakePass(
  atoms: Array<{
    id: number;
    text: string;
    boundary?: "scene" | "logic";
    time: { s: number; e: number };
  }>,
  _words?: Word[]
): string {
  const atomLines = atoms.map((atom) => {
    const boundary = atom.boundary ? ` [${atom.boundary}]` : "";
    return `${atom.id}${boundary} (${atom.time.s.toFixed(
      2
    )}-${atom.time.e.toFixed(2)}) ${atomText(atom)}`;
  });

  return [
    "请对下面的 atom 序列执行 repair-pass。",
    "注意：你不是在输出最终 takes，你只需要列出应该 discard 的草稿范围。",
    "所有未列出的 atoms 默认 keep。",
    "只在 atom 明显是被后文覆盖的起手、重说、restart、旧版本时才 discard。",
    "不要因为节奏、摘要、压缩时长或主观润色去 discard。",
    "如果拿不准，不要 discard。",
    "如果一种删法会让剩余文本变成残句或碎片，也不要这么删。",
    "scene 是硬边界；logic 只是提示，不是硬切点。",
    "",
    "ATOM 列表：",
    ...atomLines,
    "",
    '只输出 JSON，格式为 {"discard_ranges":[...]}，不要解释。',
  ].join("\n");
}
