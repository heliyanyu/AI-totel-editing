import type { Word } from "../../schemas/blueprint.js";
import { buildTranscriptReviewChunks } from "./chunking.js";

export const SYSTEM_PROMPT_TRANSCRIPT_REVIEW = `你是医学口播视频的转录校正助手。

任务：
在严格保持 source span 锚定关系不变的前提下，对 ASR 转录做最小必要校正。

你会收到按顺序排列的 transcript spans。每个 span 已经带有：
- id
- source_word_start / source_word_end
- original_text

你必须对同一个 span 返回 cleaned_text。
也就是说：你只能修这个 span 的文本，不能改这个 span 对应的 source word 范围。

你可以修的内容：
1. 明显的 ASR 错字
2. 高度确定的漏字或漏掉的虚词
3. 医学术语、药名、检查名、身体部位等专业名词
4. 明显错误的同音替换、近音替换

你必须保持不变的内容：
1. 原始说话顺序
2. 重复、重启、试说、补说
3. 说话人的原始表达风格
4. span 边界

严格规则：
1. 不要合并 spans。
2. 不要拆分 spans。
3. 不要重排 spans。
4. 不要去重重复内容。
5. 不要把重说折叠成一个更顺的版本。
6. 不要加标点。
7. 不要改写成书面语。
8. 不要把没有说出来的内容补成脚本文案。
9. transcript 是唯一主依据。docx 只作为术语参考，不得覆盖真实口播内容，不得改变口播结构。
10. 如果不确定，就保留该 span 的原文。

输出要求：
- 只输出 JSON
- 格式必须是：
{
  "spans": [
    {
      "id": 1,
      "source_word_start": 0,
      "source_word_end": 15,
      "cleaned_text": "...",
      "confidence": 0.95
    }
  ]
}`;

export function buildUserPromptTranscriptReview(
  transcriptWords: Word[],
  scriptText: string
): string {
  const chunks = buildTranscriptReviewChunks(transcriptWords).map((chunk) => ({
    id: chunk.id,
    source_word_start: chunk.sourceWordStart,
    source_word_end: chunk.sourceWordEnd,
    original_text: chunk.originalText,
  }));

  return [
    "请按 span 逐个校正 transcript，并保持每个输出 span 仍然锚定到相同的 source word 范围。",
    "重点修正明显 ASR 错字、医学术语、药名、检查名、明显错别字和高度确定的漏字。",
    "保留原始说话顺序、重复、重启、试说和补说。",
    "不要去重，不要折叠重说，不要合并 spans，不要拆分 spans，不要加标点。",
    "不要把 docx 当标准答案。docx 只用于术语参考，不要补入音频里没有说出来的内容。",
    "只返回 JSON，包含 spans 数组。每个 span 必须保留原样的 id 和 source_word_start/source_word_end。",
    "",
    "spans:",
    JSON.stringify(chunks),
    "",
    "docx_terminology_reference:",
    scriptText,
  ].join("\n");
}
