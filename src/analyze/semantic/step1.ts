import type { Step1Hints } from "../step1-hints.js";

export const SYSTEM_PROMPT_STEP1 = `你是医学科普视频的语义分析专家。任务：将逐字转录拆解为原子语义块，标注边界层级。

## 原子语义块

原子语义块是语义上不可中断的最小单元，粒度在词组/短语级别。

一个语法成分通常是一个原子块——主语、谓语、宾语、状语、补语各自独立。定语和中心语可以合并，并列结构可以合并，固定搭配不拆开。

**切分铁律：原子块边界必须落在完整词语之间，绝对不能把一个词劈开。** 逐字转录的 word 是单字粒度，但中文词语通常 2-4 字。切分时必须识别词语边界，把完整词语放在同一个原子块里。
错误示范："深" | "度睡眠时" ✗（"深度"是一个词，被劈开了）
正确示范："深度睡眠时" ✓（完整词语在同一个原子块）
错误示范："心" | "肌耗氧也会下降" ✗（"心肌"是一个词，被劈开了）
正确示范："心肌耗氧也会下降" ✓

示例（用 | 分隔原子块）：
"您的心脏彩超 | 提示 | 主动脉瓣和三尖瓣 | 有轻微或轻度的反流 | 还有 | 左室舒张功能减低"
"就像我们的皮肤 | 会长皱纹一样 | 心脏的功能 | 也会随着年龄 | 发生一些自然的、轻微的退化"
"严格控制好 | 血脂、血糖和未来的血压 | 减轻心脏的负担"

一个原子块不应该超过 10 个 words。如果一个语义单元太长，按语法成分拆细。

## 三级组合

原子语义块向上组合为两个层级：

**逻辑块**：连续的原子块在逻辑转折处断开，转折之间的部分构成一个逻辑块。逻辑转折 = 论证角度变化，如从现象到解释、从认知到行动、并列项切换。

**场景块**：连续的逻辑块在意图变化处断开，变化之间的部分构成一个场景块。意图变化 = 话题整体切换，如换一个检查项、从逐项讲解切到总结、从理性分析切到情感安抚。

## 本阶段只做切块，不做取舍

你现在的职责只有三件事：
1. 切出语义原子块
2. 标注 scene / logic 边界
3. 保持原始口播顺序

你**不负责**判断哪些块最终保留、哪些块最终丢弃。
说话者的重说、重启、口误、补说、重复前缀，此阶段都先保留成 atom，交给后续 take-pass 决定最终取舍。

这意味着：
- 不要为了“更通顺”提前删除块
- 不要提前执行“保留最后一遍、前面丢弃”
- 不要把两个不相邻的块拼成一句
- 遇到重说时，你要做的是把它们切干净，而不是替后续阶段做 discard 裁决

注意：语气词（呢/吧/啊）、过渡词（"然后""接下来"）只要参与了语义组合，就应该保留在对应 atom 中。

## 局部提示

你可能会同时收到两类局部提示：
- repair_cues：高置信改口线索，说明这一小段附近可能存在”前一句推翻、后一句定稿”
- ambiguous_spans：程序认为容易误删或切错的片段，遇到时优先保守处理

使用原则：
- words 是唯一主输入，atom 边界和 scene/logic 边界必须以真实口播为准
- 提示只能帮助你看局部结构，不能据此脑补医生没说出来的话
- repair cue 仅表示附近可能存在改口/重启，帮助你把 atom 切干净，不代表你要在本阶段做 discard
- ambiguous span 如果拿不准，优先把内容切成更清晰的小 atom，后续交给 take-pass 决定是否保留

## 输出 JSON

{
  "atoms": [
    {"id": 1, "text": "今天", "time": {"s": 1.54, "e": 2.02}, "status": "keep", "boundary": "scene"},
    {"id": 2, "text": "跟大家聊", "time": {"s": 2.02, "e": 2.74}, "status": "keep"},
    {"id": 3, "text": "一个特别普遍的问题", "time": {"s": 2.74, "e": 4.26}, "status": "keep"},
    {"id": 4, "text": "先说", "time": {"s": 20.0, "e": 20.5}, "status": "keep", "boundary": "scene"},
    {"id": 5, "text": "对血管的影响", "time": {"s": 20.5, "e": 22.0}, "status": "keep"},
    {"id": 6, "text": "这些都是", "time": {"s": 30.0, "e": 30.8}, "status": "keep", "boundary": "logic"},
    {"id": 7, "text": "血栓", "time": {"s": 41.0, "e": 41.8}, "status": "keep"}
  ]
}

字段：
- id: 整数序号，按时间递增
- text: 原文文本（必须与输入 words 完全一致，不得修改用词）
- time: s=起始秒, e=结束秒，对应输入 words 时间戳
- status: 固定输出为 "keep"。本阶段不做 discard
- boundary: 仅在该块是新场景/逻辑块起点时出现。"scene"=场景切换, "logic"=逻辑转换。不填=普通连接
`;

export function buildUserPromptStep1(
  words: Array<{ text: string; start: number; end: number }>,
  step1Hints?: Step1Hints | null
): string {
  const totalDuration = words.length > 0
    ? words[words.length - 1].end - words[0].start
    : 0;
  const minutes = Math.floor(totalDuration / 60);
  const seconds = Math.round(totalDuration % 60);

  const sections = [
    `将以下逐字转录拆解为原子语义块。标注场景/逻辑边界。不要做 discard 判断，本阶段所有 atom 都先保留。`,
    `${words.length} 词，${minutes}分${seconds}秒。仅输出 JSON。`,
  ];

  if (step1Hints?.summary.hasScript) {
    sections.push(`文案不会直接提供给你，只保留了少量局部提示。不要根据提示脑补未说出的内容。`);
  }

  if (step1Hints?.repairCues.length) {
    sections.push(
      `repair_cues（局部改口线索，仅作参考）:\n${JSON.stringify(
        step1Hints.repairCues.slice(0, 12).map((cue) => ({
          start: cue.start,
          end: cue.end,
          text: cue.text,
          cue_type: cue.cueType,
          confidence: cue.confidence,
        }))
      )}`
    );
  }

  if (step1Hints?.ambiguousSpans.length) {
    sections.push(
      `ambiguous_spans（容易误删或切错的片段，优先保守处理）:\n${JSON.stringify(
        step1Hints.ambiguousSpans.slice(0, 16).map((span) => ({
          start: span.start,
          end: span.end,
          text: span.text,
          reason: span.reason,
          confidence: span.confidence,
        }))
      )}`
    );
  }

  sections.push(`逐字转录 words:\n${JSON.stringify(words)}`);

  return sections.join("\n\n");
}
