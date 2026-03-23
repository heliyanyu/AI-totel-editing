# `src/align/subtitle-align.ts` 近乎逐行讲解

原文件：`src/align/subtitle-align.ts`

这个文件是在 `align/index.ts` 之上，再往前走一步：

它不是只做“对齐算法”，而是把对齐结果真正写回 `blueprint`。

也就是说，这里负责把每个 keep atom 补成“可执行 atom”。

先提醒你一件事：  
这个源文件里有几段注释已经乱码了，但代码逻辑本身是正常的。下面这份讲解会把那部分重新翻成人话。

## 第一段：引入依赖

```ts
import { writeFileSync } from "fs";
import { alignWords, type WordAlignmentResult } from "./index.js";
import { buildMediaPayload } from "./media-range.js";
import type { Blueprint, KeepAtom, Transcript } from "../schemas/blueprint.js";
```

白话翻译：

这里拿进来了 4 类工具：

- 写调试文件
- 真正做文字对齐的 `alignWords`
- 计算媒体区间的 `buildMediaPayload`
- 蓝图和转录相关类型

你可以把这个文件理解成一个总装配工：

- `alignWords` 负责“找时间”
- `buildMediaPayload` 负责“算最终媒体播放区间”
- 它自己负责“把这些结果填回 blueprint”

## 第二段：调试记录长什么样

```ts
export interface AtomAlignmentDebugEntry {
  atomId: number;
  text: string;
  windowWordCount: number;
  matchedWordCount: number;
  confidence: number;
  mode: "reviewed_exact" | "reviewed_projected" | "static_fallback";
  semanticStart: number;
  semanticEnd: number;
  mediaStart: number;
  mediaEnd: number;
  ...
}
```

白话翻译：

这不是给前台用户看的，而是给我们自己排查问题看的“对齐诊断记录”。

每个 atom 都会留下这样一份小报告，帮助你回答：

- 当时搜索窗口里一共有多少词
- 最后匹配上多少
- 置信度多少
- 用的是 exact 还是 projected 还是 fallback
- 最终媒体区间是多少

真实例子：

如果某个 atom 总是切早了或者切晚了，你就可以看这份 debug：

- 是窗口一开始就圈错了
- 还是文字对齐没对上
- 还是后面媒体区间又被修剪了

## 第三段：几个小工具函数

```ts
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function compactText(text: string): string {
  return text.replace(/\s+/g, "");
}
```

白话翻译：

- `round3`：统一秒数精度
- `compactText`：把空白压掉，方便比较文本重叠

再看：

```ts
function sharedPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;

  while (index < limit && left[index] === right[index]) {
    index += 1;
  }

  return index;
}
```

白话翻译：

这段是专门算“两段文本开头连续一样了多少个字”。

真实例子：

- `但如果你已经`
- `但如果你只是`

它们共享前缀就是 `但如果你` 这几个字。

这对判断“前一句 discard 是否其实是当前 keep 的修正版前半截”很有用。

## 第四段：判断前一个 discard 和当前 keep 是否重叠

```ts
function getRepairOverlapChars(
  previousAtom: BlueprintAtomLike | undefined,
  currentAtom: KeepAtom
): number {
  if (!previousAtom || previousAtom.status !== "discard") {
    return 0;
  }
```

白话翻译：

这段先卡死一个条件：

- 只有前一个 atom 存在
- 而且它是 `discard`

才有必要考虑“是不是修正重叠”。

继续看：

```ts
  const gapSec = Math.max(0, currentAtom.time.start - previousAtom.time.end);
  if (gapSec > REPAIR_ADJACENT_GAP_EPSILON_SEC) {
    return 0;
  }
```

白话翻译：

如果两个 atom 在时间上离得太远，那就不算同一口修正过程，直接放弃重叠判断。

意思就是：

- 这套修剪逻辑只针对“几乎挨着发生的改口”
- 不会把远处无关句子也扯进来

再往下：

```ts
  return sharedPrefixLength(previousText, currentText);
```

白话翻译：

如果确实是前后挨着的 discard 和 keep，就算它们共同开头有多少字重叠。

真实例子：

医生先说：

- discard: “这个药一天三次”

马上改口：

- keep: “这个药一天两次”

这两句开头会高度重叠。

## 第五段：根据重叠程度，修剪 keep 的起点

```ts
function computeRepairStartTrimSec(
  atom: KeepAtom,
  overlapChars: number
): number {
  const mediaRange = atom.media_range ?? atom.time;
  const atomDuration = Math.max(0, mediaRange.end - mediaRange.start);
```

白话翻译：

这段在回答一个问题：

“如果当前 keep 开头其实还粘着前一句 discard 的尾巴，那应该往后剪多少？”

继续看：

```ts
  const overlapDrivenTrim = Math.max(
    REPAIR_START_TRIM_MIN_SEC,
    overlapChars * 0.02
  );
```

白话翻译：

重叠字数越多，建议剪掉的时间就越多。  
但也有下限，不会一点都不剪。

最后：

```ts
  return round3(
    Math.min(
      REPAIR_START_TRIM_MAX_SEC,
      overlapDrivenTrim,
      Math.max(0, atomDuration * 0.25)
    )
  );
```

白话翻译：

这里加了三层保险：

- 不能超过固定上限
- 不能超过按重叠估出来的建议值
- 也不能一下剪掉 atom 自己太大比例

说明这段代码很保守，不想把修剪做得过猛。

## 第六段：真正应用“改口感知修剪”

```ts
export function applyRepairAwareMediaRangeTrims(
  blueprint: Blueprint,
  debugEntries?: AtomAlignmentDebugEntry[]
): void {
  const orderedAtoms = blueprint.scenes.flatMap((scene) =>
    scene.logic_segments.flatMap((segment) => segment.atoms)
  );
```

白话翻译：

这一步先把所有 atom 按全局顺序摊平。  
因为“前一句”和“后一句”的关系不能只在单个 segment 里看。

继续看循环：

```ts
  for (let index = 1; index < orderedAtoms.length; index++) {
    const currentAtom = orderedAtoms[index];
    if (currentAtom.status !== "keep" || !currentAtom.media_range) {
      continue;
    }
```

白话翻译：

只处理：

- 当前是 keep
- 而且已经有媒体区间

的 atom。

再看核心：

```ts
    const previousAtom = orderedAtoms[index - 1];
    const overlapChars = getRepairOverlapChars(previousAtom, currentAtom);
    if (overlapChars <= 0) {
      continue;
    }
```

白话翻译：

如果前一个 discard 和当前 keep 没有真正的重叠关系，就完全不动它。

最后真的修剪：

```ts
    currentAtom.media_range.start = round3(
      Math.min(currentAtom.media_range.end, currentAtom.media_range.start + trimSec)
    );
```

白话翻译：

就是把当前 keep 的媒体起点往后推一点点。  
目的不是改字，而是避免成片里重复播到前一句口误残留。

## 第七段：判断文本是否有“修正重叠”

```ts
function hasRepairTextOverlap(discardText: string, keepText: string): boolean {
  if (!discardText || !keepText) return false;
  if (discardText.includes(keepText)) return true;
  if (keepText.includes(discardText)) return true;
  if (sharedPrefixLength(discardText, keepText) >= 2) return true;
  return false;
}
```

白话翻译：

这段判断逻辑非常实用：

只要满足下面任一条，就认为有修正重叠：

- discard 包含 keep
- keep 包含 discard
- 两者至少共享 2 个字以上的开头

真实例子：

- discard: “之后呢”
- keep: “之后”

这当然算重叠。

或者：

- discard: “但是如果你”
- keep: “但是如果”

也算明显重叠。

## 第八段：给某个 keep atom 算一个 discard-aware 搜索窗口

```ts
function computeDiscardAwareSearchWindow(
  atom: BlueprintAtomLike,
  orderedAtoms: BlueprintAtomLike[],
  atomIndex: number,
  padding: number
): {
  windowStart: number;
  windowEnd: number;
  prevDiscardId?: number;
  nextDiscardId?: number;
} {
  let windowStart = atom.time.start - padding;
  let windowEnd = atom.time.end + padding;
```

白话翻译：

这段先给 keep atom 画了一个最朴素的搜索窗口：

- 左边稍微往前放一点
- 右边稍微往后放一点

然后它会看相邻的 discard，有没有必要把窗口收紧。

### 向前扫描连续 discard

```ts
  for (let i = atomIndex - 1; i >= 0; i--) {
    const prev = orderedAtoms[i];
    if (prev.status !== "discard") break;
```

白话翻译：

从当前 atom 往前找，只要前面连续还是 discard，就继续看。

如果：

- 这个 discard 在文本上和当前 keep 有重叠

就执行：

```ts
      windowStart = Math.max(windowStart, prev.time.end);
      prevDiscardId = prev.id;
```

白话翻译：

把搜索窗口左边界推到那个 discard 结束之后。  
这样对齐时就不容易误命中前一个错误版本。

### 向后扫描连续 discard

```ts
  for (let i = atomIndex + 1; i < orderedAtoms.length; i++) {
    const next = orderedAtoms[i];
    if (next.status !== "discard") break;
```

白话翻译：

这次换成往后看。  
如果后面紧跟着的 discard 和当前 keep 有重叠，就收紧右边界。

最后：

```ts
  windowStart = Math.min(windowStart, atom.time.start);
  windowEnd = Math.max(windowEnd, atom.time.end);
```

白话翻译：

即使你前后怎么收紧，也必须保证至少覆盖 atom 自己原本的语义时间，不然就剪过头了。

## 第九段：真正的大总入口 `postProcessBlueprint`

```ts
export function postProcessBlueprint(
  blueprint: Blueprint,
  sourceTranscript: Transcript,
  _referenceTranscript: Transcript = sourceTranscript,
  options?: { debugPath?: string }
): Blueprint {
```

白话翻译：

这就是这个文件最核心的函数。  
它会直接修改并补充 `blueprint` 里的 keep atoms。

### 先准备统计和调试容器

```ts
  let aligned = 0;
  let staticFallback = 0;
  let reviewedProjected = 0;
  let discardConstrained = 0;
  const debugEntries: AtomAlignmentDebugEntry[] = [];
  const WINDOW_PADDING = 0.4;
```

白话翻译：

这里在记账：

- 成功对齐了多少
- 有多少退化成静态 fallback
- 有多少用了 projected
- 有多少窗口因为 discard 被约束过

### 先把所有 atom 摊平，建立索引

```ts
  const orderedAtoms: BlueprintAtomLike[] = blueprint.scenes.flatMap(
    (scene) => scene.logic_segments.flatMap((segment) => segment.atoms)
  );
  const atomIndexById = new Map<number, number>();
```

白话翻译：

这一步是为了后面能快速知道：

- 某个 atom 在全局顺序里排第几
- 它前后挨着的是谁

### 遍历每个 keep atom

```ts
  for (const scene of blueprint.scenes) {
    for (const seg of scene.logic_segments) {
      for (const atom of seg.atoms) {
        if (atom.status !== "keep") continue;

        atom.subtitle_text = atom.text;
```

白话翻译：

这里开始逐个处理保留的 atom。

第一件事先把字幕文字默认设成 atom 文本本身。

也就是说，如果后面没有特别替换，字幕就显示它自己的文本。

### 算 discard-aware 搜索窗口

```ts
        const baseWindowStart = atom.time.start - WINDOW_PADDING;
        const baseWindowEnd = atom.time.end + WINDOW_PADDING;
        let windowStart = baseWindowStart;
        let windowEnd = baseWindowEnd;
```

白话翻译：

先设一个基础窗口，再看需不需要因为相邻 discard 收紧。

```ts
          const constraint = computeDiscardAwareSearchWindow(
            atom, orderedAtoms, flatIndex, WINDOW_PADDING
          );
          windowStart = constraint.windowStart;
          windowEnd = constraint.windowEnd;
```

白话翻译：

如果这个 atom 周围存在和它重叠的 discard，那么搜索字幕时间时就别乱搜太宽。

### 从 source transcript 里裁出候选 sourceWords

```ts
        const sourceWords = sourceTranscript.words.filter(
          (w) => w.end > windowStart && w.start < windowEnd
        );
```

白话翻译：

这一步并不是从整条 transcript 里盲目全局搜索，  
而是只拿这个窗口内的词出来对齐。

这样更稳，也更快。

### 调用真正的对齐器

```ts
        const result: WordAlignmentResult = alignWords(atom.text, sourceWords);
        atom.alignment_mode = result.mode;
        atom.alignment_confidence = result.confidence;
```

白话翻译：

前面 `align/index.ts` 的算法在这里真正被用上。

对齐结果回来之后，先把“怎么对齐的”和“多可信”记到 atom 上。

### 根据结果决定有没有逐字 words

```ts
        if (result.mode === "static_fallback" || result.words.length === 0) {
          atom.words = [];
          staticFallback += 1;
        } else {
          atom.words = result.words;
          aligned += 1;
          if (result.mode === "reviewed_projected") {
            reviewedProjected += 1;
          }
        }
```

白话翻译：

- 如果对齐失败，就不给逐字时间
- 如果成功，就把 `result.words` 塞回 atom

这里也顺手统计：

- exact/projected 成功了多少
- fallback 多少

### 计算最终媒体区间

```ts
        const media = buildMediaPayload(atom as KeepAtom, result);
        atom.media_range = media.mediaRange;
        atom.media_mode = media.mediaMode;
        atom.media_confidence = media.mediaConfidence;
        atom.media_occurrence = media.mediaOccurrence;
```

白话翻译：

这一步非常重要。

因为字幕时间和真正要拿去播放的媒体区间，不一定完全一回事。

这里会算出：

- 最终原视频应该取哪一段
- 这段是 exact 还是 projected 或 fallback 得来的

真实例子：

有时字幕对齐到的 words 范围很准确，  
那 `media_range` 也可以跟着很准。  
如果字幕只能 fallback，那媒体区间也只能退化用语义时间。

### 把调试信息记下来

```ts
        debugEntries.push({
          atomId: atom.id,
          text: atom.text,
          windowWordCount: sourceWords.length,
          matchedWordCount: result.mode === "static_fallback" ? result.matchedChars : result.words.length,
          confidence: result.confidence,
          ...
        });
```

白话翻译：

每处理完一个 atom，都留一份“验尸报告”。  
之后出了问题，可以倒查每一步发生了什么。

## 第十段：最后再做一次修正感知修剪

```ts
  applyRepairAwareMediaRangeTrims(blueprint, debugEntries);
```

白话翻译：

前面每个 atom 已经有 `media_range` 了，  
这里再做最后一道细修，避免成片一开头还沾到前一句 discard 的残影。

真实例子：

医生说：

“这个药一天三次……不对，一天两次。”

即使 keep 已经对齐成功，  
它的媒体起点也可能还略微粘着“三次”的尾音。  
这一步就是把那一点点脏边修掉。

## 第十一段：打印总结并写出 debug 文件

```ts
  console.log(
    `  Words 对齐: ${aligned} 个 atom 已对齐` +
      (discardConstrained > 0 ? `, ${discardConstrained} 个窗口被 discard 约束` : "") +
      (reviewedProjected > 0 ? `, ${reviewedProjected} 个使用 projected timing` : "") +
      (staticFallback > 0 ? `, ${staticFallback} 个退化为静态字幕` : "")
  );
```

白话翻译：

这段就是给终端一个总结，让你一眼看出这次后处理质量怎么样。

最后：

```ts
  if (options?.debugPath) {
    writeFileSync(options.debugPath, JSON.stringify(debugEntries, null, 2), "utf-8");
  }
```

白话翻译：

如果你给了 `debugPath`，就把刚才那一堆 atom 调试报告写成 JSON 文件。

## 这个文件在整条链路里的作用

一句话：

`src/align/subtitle-align.ts` 把“抽象的 keep atom”补成“真的可拿去做字幕和取媒体片段的 keep atom”。  
它是蓝图从“能看懂”走向“能执行”的关键一步。
