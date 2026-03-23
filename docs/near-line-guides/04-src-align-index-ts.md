# `src/align/index.ts` 近乎逐行讲解

原文件：`src/align/index.ts`

这个文件专门解决一个非常难、但非常关键的问题：

清洗过的文字，怎么重新对回原视频里的字级时间？

你可以把它理解成“字幕时间侦探”。

因为前面分析链用的文本，已经不完全等于原始 ASR 了。  
但最后做字幕和媒体切片时，又必须尽量回到原视频的真实时间边界。

## 第一段：文件开头先把目标讲清楚

```ts
/**
 * 最终成片的切点和逐字字幕，优先回到原始 ASR 的字级时间边界。
 * 这里不再做“全局 LCS 拼字”，而是只在局部连续窗口里找匹配：
 * - 优先选择最后一次完整出现
 * - 优先选择时间上连续、紧凑的窗口
 * - 找不到可靠窗口时，宁可退化成静态字幕，也不跨远距离拼字
 */
```

白话翻译：

这段话其实已经给出原则了：

- 目标不是“勉强对上任何字”
- 目标是“尽量在合理的局部窗口里，找到最可信的一次出现”

如果找不到足够可靠的匹配，它宁可保守一点，也不胡乱拼。

真实例子：

清洗后文本可能是：

“饭后半小时吃”

原始 ASR 里可能出现过两次类似表达：

1. 前面一次是口误修正前
2. 后面一次才是最终正确说法

这个文件会更偏向“最后一次完整出现”。

## 第二段：输出结果长什么样

```ts
export type AlignmentMode = "reviewed_exact" | "reviewed_projected" | "static_fallback";

export interface WordAlignmentResult {
  words: Word[];
  confidence: number;
  mode: AlignmentMode;
  matchedChars: number;
  targetChars: number;
  occurrence: "last_complete" | "last_window" | "fallback_time";
  timingHint?: {
    start: number;
    end: number;
  };
}
```

白话翻译：

这个文件最后会返回一个“对齐结果盒子”，里面至少回答 6 件事：

- 对到了哪些 `words`
- 置信度多少
- 是精确对齐、投影对齐，还是退化失败
- 匹配到了多少字
- 总共目标有多少字
- 这次匹配算哪种出现方式

机器名词翻译：

- `confidence`：置信度。你可以先理解成“这个结果有多像真的”。
- `projected`：投影。意思是没法一字不差对上，但根据已有匹配估计出一套时间。

## 第三段：一堆阈值常量

```ts
const MIN_PROJECTED_CONFIDENCE = 0.72;
const MIN_TIMING_HINT_CONFIDENCE = 0.42;
const WINDOW_LENGTH_PADDING = 6;
const WINDOW_LENGTH_BACKOFF = 2;
const SHORT_TARGET_GAP = 0.38;
const MEDIUM_TARGET_GAP = 0.55;
const LONG_TARGET_GAP = 0.85;
```

白话翻译：

这些值不是业务内容，而是这套对齐算法的“性格设置”。

比如：

- 置信度至少到多少，才允许做 `projected`
- 搜索窗口最多允许比目标多出几格
- 短句和长句分别允许多大的时间间隙

真实例子：

一句 2 个字的短词，如果中间隔了很久才拼起来，一般就不可信。  
一句 8 个字的长句，允许的时间松动会稍微大一点。

## 第四段：基础小工具

```ts
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeText(text: string): string {
  return text.replace(/[，。、？！：；“”‘’（）《》【】\s,.\-!?:;"'()\[\]]/g, "");
}

function toChars(text: string): string[] {
  return Array.from(text);
}
```

白话翻译：

这三段分别负责：

- `round3`：统一把秒数保留到 3 位小数
- `normalizeText`：去掉标点和空格，减少无意义干扰
- `toChars`：把一段字符串拆成单个字符列表

真实例子：

“高血压，不是只看一次。”  
经过 `normalizeText` 后，更像：

`高血压不是只看一次`

这样对齐时就不会被逗号、句号打断。

## 第五段：为什么要把词拆成“字级”

```ts
function expandToCharWords(words: Word[]): Word[] {
  const expanded: Word[] = [];

  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const normalized = normalizeText(word.text);
    const chars = toChars(normalized);
```

白话翻译：

这里做了一件本文件最关键的预处理：

把原本的 `Word[]` 再细拆成“每个字一个时间片”。

为什么要这样？

因为中文里一个 `word.text` 可能本来就含多个字，  
如果不拆成字级，很多细粒度对齐会不够准。

继续看：

```ts
    if (chars.length === 1) {
      expanded.push({
        ...cloneWord(word),
        text: chars[0],
        start: round3(word.start),
        end: round3(word.end),
        ...
      });
      continue;
    }
```

白话翻译：

如果这个词本来就只有一个字，那最简单，直接塞进去。

再看多字情况：

```ts
    const duration = Math.max(0, safeEnd - safeStart);
    const step = duration / chars.length;

    chars.forEach((char, charIndex) => {
      const charStart = round3(safeStart + step * charIndex);
      const charEnd =
        charIndex === chars.length - 1 ? safeEnd : round3(safeStart + step * (charIndex + 1));
```

白话翻译：

如果一个词里有多个字，就把这段总时长平均切开，分给每个字。

真实例子：

假设：

- `"高血压"` 这三个字
- 从 `12.000s` 到 `12.300s`

那就大致拆成：

- 高：12.000 到 12.100
- 血：12.100 到 12.200
- 压：12.200 到 12.300

这当然不是完美声学真相，但已经比把三个字绑成一团更利于后面对齐。

## 第六段：LCS 表

```ts
function buildLcsTable(target: string[], reference: string[]): Uint16Array[] {
  const rows: Uint16Array[] = Array.from(
    { length: target.length + 1 },
    () => new Uint16Array(reference.length + 1)
  );
```

白话翻译：

这里开始进入经典的字符串匹配思路：LCS。

机器名词翻译：

- `LCS`：Longest Common Subsequence，最长公共子序列。
- 你可以先把它理解成：“两串字符里，按顺序能对上的最长公共骨架”。

继续看：

```ts
  for (let i = 1; i <= target.length; i++) {
    for (let j = 1; j <= reference.length; j++) {
      if (target[i - 1] === reference[j - 1]) {
        rows[i][j] = rows[i - 1][j - 1] + 1;
      } else {
        rows[i][j] = Math.max(rows[i - 1][j], rows[i][j - 1]);
      }
    }
  }
```

白话翻译：

这就是在一格一格地填匹配表。

- 当前两个字相同，就在左上角基础上加 1
- 不同，就继承左边和上边中较大的那个值

你不用死记公式，只要知道：

它是在给后面“回溯出哪些字符对上了”做准备。

## 第七段：把匹配路径倒着找回来

```ts
function tracebackMatchedPairs(
  table: Uint16Array[],
  target: string[],
  reference: string[]
): LcsPair[] {
```

白话翻译：

前面那张 LCS 表只是“算分表”，这一步才是“把真正对上的字符下标找回来”。

```ts
  while (i > 0 && j > 0) {
    if (target[i - 1] === reference[j - 1]) {
      matched.push({ targetIndex: i - 1, referenceIndex: j - 1 });
      i -= 1;
      j -= 1;
      continue;
    }
```

白话翻译：

如果当前两个字符一样，就记录这对匹配，并一起往左上走。

如果不一样，就根据表里哪边更大，决定往上走还是往左走。

最后得到的就是：

- 目标文本第几个字
- 对上了参考窗口里的第几个字

## 第八段：时间紧凑性检查

```ts
function computeGapMetrics(words: Word[]): { maxGap: number; totalGap: number } {
  let maxGap = 0;
  let totalGap = 0;

  for (let index = 1; index < words.length; index++) {
    const gap = Math.max(0, words[index].start - words[index - 1].end);
```

白话翻译：

这里不是看字像不像，而是看时间上是不是“挨得住”。

它会统计：

- 最大间隙是多少
- 总间隙是多少

后面：

```ts
function isTemporallyCompact(words: Word[], targetLength: number, windowLength = words.length): boolean {
  if (words.length <= 1) {
    return true;
  }

  const { maxGap, totalGap } = computeGapMetrics(words);
  const gapLimit = allowedGapSeconds(targetLength, windowLength);
  if (maxGap > gapLimit) {
    return false;
  }
```

白话翻译：

意思是：

- 就算文字看起来勉强能拼上
- 如果时间上跳得太散
- 也不要认作好匹配

真实例子：

如果一句短句的前半在 10 秒，后半居然在 25 秒，  
那它大概率不是同一次正常说出来的内容，而是跨段拼出来的错觉。

## 第九段：找“精确完整窗口”

```ts
function findExactWindow(targetChars: string[], charWords: Word[]): CandidateWindow | null {
  const targetText = targetChars.join("");
  const referenceText = charWords.map((word) => word.text).join("");

  let start = referenceText.lastIndexOf(targetText);
```

白话翻译：

这里优先尝试最理想的情况：

- 目标整句在参考窗口里完整出现过
- 直接从最后一次完整出现开始找

为什么 `lastIndexOf`？

因为项目倾向于“最后一次完整出现”，这通常更接近修正后的最终说法。

接着：

```ts
    const windowWords = charWords.slice(start, start + targetChars.length).map(cloneWord);
    if (isTemporallyCompact(windowWords, targetChars.length)) {
      return {
        matchedWords: windowWords,
        matchedCount: targetChars.length,
        ...
      };
    }
```

白话翻译：

即使文字完整命中了，也还要过一道“时间是不是紧凑”的检查。  
过了才算真正的 `exact`。

## 第十段：如果找不到完整出现，就搜“最好的局部窗口”

```ts
function searchBestWindow(targetChars: string[], charWords: Word[]): CandidateWindow | null {
  const minWindowLength = Math.max(1, targetChars.length - WINDOW_LENGTH_BACKOFF);
  const maxWindowLength = Math.min(charWords.length, targetChars.length + WINDOW_LENGTH_PADDING);
  let best: CandidateWindow | null = null;
```

白话翻译：

这里开始做更灵活的搜索：

- 不要求完全一字不差
- 允许窗口比目标稍短或稍长
- 但要在一个合理范围内找最好的

再看评分过程：

```ts
      const coverage = matchedCount / targetChars.length;
      if (coverage < MIN_TIMING_HINT_CONFIDENCE) {
        continue;
      }

      const density = matchedCount / matchedSpanLength;
      const precision = matchedCount / length;
```

白话翻译：

这里在看几个核心指标：

- `coverage`：目标有多少比例对上了
- `density`：这些匹配字在窗口里是不是够集中
- `precision`：窗口里有多少是真的匹配，不是杂质

最后：

```ts
      const score =
        coverage * 0.64 +
        density * 0.22 +
        precision * 0.14 -
        maxGap * 0.08 -
        totalGap * 0.03;
```

白话翻译：

这是在给候选窗口打综合分。

- 覆盖率最重要
- 密度和精度次之
- 时间跳跃太大要扣分

## 第十一段：投影出一套合成字时间

```ts
function buildProjectedWords(targetChars: string[], basisWords: Word[]): Word[] {
  if (basisWords.length === 0 || targetChars.length === 0) {
    return [];
  }
```

白话翻译：

如果找不到完美一字对一字的结果，但找到了一个可信的时间窗口，  
这个函数会“估算”出一套新的字级时间。

继续看：

```ts
  const start = round3(basisWords[0].start);
  const end = round3(Math.max(basisWords[basisWords.length - 1].end, start + 0.06));
  const duration = Math.max(0.06, end - start);
  const step = duration / targetChars.length;
```

白话翻译：

逻辑很朴素：

- 先拿到一段可信的大致时间范围
- 再把这段时间平均分给目标文本里的每个字

真实例子：

目标清洗后变成“饭后半小时”，  
虽然字面没法在 ASR 里完全逐字重现，  
但如果能确定它大致落在 8.20 秒到 9.10 秒，  
就可以把这 0.9 秒平均投给这几个字。

## 第十二段：最终总入口 `alignWords`

```ts
export function alignWords(cleanText: string, referenceWords: Word[]): WordAlignmentResult {
  if (referenceWords.length === 0) {
    return {
      words: [],
      confidence: 0,
      mode: "static_fallback",
      ...
    };
  }
```

白话翻译：

真正对外使用的就是这个函数。

它先处理一些最基本的兜底情况：

- 没有参考词，直接 fallback
- 目标文本清理后为空，也直接 fallback

### 先把目标和参考都预处理

```ts
  const targetChars = toChars(normalizeText(cleanText));
  const charWords = expandToCharWords(referenceWords);
```

白话翻译：

就是把：

- 目标文本清掉标点后拆成字
- 参考词也拆成字级时间片

让双方进入同一种比较颗粒度。

### 优先 exact

```ts
  const exact = findExactWindow(targetChars, charWords);
  if (exact) {
    return {
      words: exact.matchedWords,
      confidence: 1,
      mode: "reviewed_exact",
      ...
    };
  }
```

白话翻译：

能精确找到，就直接用。  
这是最理想结果。

### 再尝试 best window

```ts
  const best = searchBestWindow(targetChars, charWords);
  if (!best) {
    return {
      words: [],
      confidence: 0,
      mode: "static_fallback",
      ...
    };
  }
```

白话翻译：

找不到完整精确命中，就退一步找“最好的局部窗口”。

### 如果覆盖率足够高，就做 projected

```ts
  if (best.coverage >= MIN_PROJECTED_CONFIDENCE) {
    return {
      words: buildProjectedWords(targetChars, best.matchedWords),
      confidence,
      mode: "reviewed_projected",
      ...
    };
  }
```

白话翻译：

意思是：

- 虽然不是完美 exact
- 但这个窗口已经够像了
- 那就大胆但受控地估一套时间

### 再不行就 static fallback

```ts
  return {
    words: [],
    confidence,
    mode: "static_fallback",
    ...
  };
```

白话翻译：

最后这层保底很重要。

它的态度是：

- 如果把握不大
- 就别伪造一套看起来很精确的逐字时间
- 宁可后面用静态字幕

## 这个文件在整条链路里的作用

一句话总结：

`src/align/index.ts` 是“把清洗后的句子，谨慎地重新挂回原视频时间轴”的核心匹配器。  
它不负责决定保留哪句，也不负责渲染画面，它只负责尽量对准时间。
