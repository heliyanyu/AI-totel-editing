# `src/compose/pipeline-plan.ts` 近乎逐行讲解

原文件：`src/compose/pipeline-plan.ts`

这个文件很容易被低估，但它其实非常关键。

它负责把“秒”翻译成“帧”，把 `timing_map` 翻译成 Remotion 真正能排进时间轴的计划。

你可以把它理解成：

视频工厂里的“排片秘书”。

## 第一段：定义几种计划类型

```ts
export interface SourceDirectAudioSequencePlan {
  key: string;
  fromFrame: number;
  durationInFrames: number;
  trimBefore: number;
  trimAfter: number;
}
```

白话翻译：

这是给 `source_direct` 音频用的时间计划。

它回答：

- 这个音频片段从第几帧开始播
- 一共播多少帧
- 原视频音轨前面要裁掉多少帧
- 后面要保留到多少帧

真实例子：

如果原视频 20s 到 24s 这段音频要出现在成片的 5s 到 9s，  
那这里就会把这组信息翻译成帧数。

再看字幕计划：

```ts
export interface SubtitleSequencePlan {
  key: string;
  fromFrame: number;
  durationInFrames: number;
  atomOriginalStart: number;
  words: Word[];
  fallbackText: string;
}
```

白话翻译：

这是在描述“某条字幕该怎么挂到时间轴上”。

- 从第几帧出现
- 持续多少帧
- 逐字时间有哪些
- 如果逐字不可靠，就显示哪段静态文本

## 第二段：再定义一个“整段画面”的计划

```ts
export interface RenderSegmentSequencePlan {
  key: string;
  fromFrame: number;
  durationInFrames: number;
  renderScene: SegmentRenderInfo["renderScene"];
  subtitles: SubtitleSequencePlan[];
}
```

白话翻译：

这不是单个字，也不是单条音频，而是一个完整逻辑段的渲染计划。

一个逻辑段进入 Remotion 前，至少要知道：

- 从第几帧开始出现
- 持续多少帧
- 用哪个 `renderScene`
- 它下面挂哪些字幕计划

## 第三段：秒和帧之间怎么换算

```ts
export function secondsToFramesFloor(seconds: number, fps: number): number {
  return Math.floor(seconds * fps);
}

export function secondsToFramesCeil(seconds: number, fps: number): number {
  return Math.ceil(seconds * fps);
}
```

白话翻译：

这两句看起来简单，但用途很多。

- `floor`：向下取整帧
- `ceil`：向上取整帧

机器名词翻译：

- `fps`：frames per second，每秒多少帧。

真实例子：

如果 `fps = 30`：

- `2.0s` 就是第 `60` 帧
- `2.4s` 大约是第 `72` 帧

为什么有时向下、有时向上？

因为：

- 起点一般更适合向下取整
- 终点一般更适合向上取整

这样更不容易把内容截短。

## 第四段：给 source_direct 音频做计划

```ts
export function buildSourceDirectAudioSequencePlans(
  timingMap: TimingMap,
  fps: number
): SourceDirectAudioSequencePlan[] {
  if (timingMap.mode !== "source_direct") {
    return [];
  }
```

白话翻译：

只有 `source_direct` 模式才需要这类计划。  
如果不是这个模式，直接返回空列表。

继续看：

```ts
  return timingMap.clips.map((clip) => {
    const fromFrame = secondsToFramesFloor(clip.output.start, fps);
    const endFrame = secondsToFramesCeil(clip.output.end, fps);
    const durationInFrames = Math.max(1, endFrame - fromFrame);
```

白话翻译：

这里是在把每个 clip 的成片时间：

- `output.start`
- `output.end`

换成：

- 从第几帧开始
- 播多少帧

再看：

```ts
    const trimBefore = secondsToFramesFloor(clip.source.start, fps);
    const trimAfter = Math.max(
      trimBefore + 1,
      secondsToFramesCeil(clip.source.end, fps)
    );
```

白话翻译：

这两项说的是：

- 原视频音轨前面要切掉多少
- 最多保留到哪一帧

真实例子：

原视频第 1000 到 1120 帧是一段有效音频，  
那这个计划就会把这段信息明确写出来，方便 Remotion 只播这一截。

## 第五段：给字幕做计划

```ts
function buildSubtitleSequencePlans(
  keepAtoms: KeepAtom[],
  atomTimingById: Map<number, TimingMap["segments"][number]>,
  segmentOutputStart: number,
  fps: number
): SubtitleSequencePlan[] {
```

白话翻译：

这个函数专门处理字幕，不处理画面模板本身。

它会对每个 keep atom：

- 找到它对应的 timing segment
- 计算它在当前逻辑段内部从哪一帧开始
- 持续多少帧

继续看：

```ts
      const atomTiming = atomTimingById.get(atom.id);
      if (!atomTiming) {
        return null;
      }
```

白话翻译：

如果某个 keep atom 连 timing 都没找到，那就没法排字幕，只能先跳过。

再看关键时间换算：

```ts
      const fromFrame = secondsToFramesFloor(
        atomTiming.output.start - segmentOutputStart,
        fps
      );
```

白话翻译：

这里不是算“整片里的绝对帧”，而是在算：

“这个字幕相对于当前 segment 的局部起点，应该从第几帧出现。”

最后：

```ts
      return {
        key: `sub-${atom.id}`,
        fromFrame: Math.max(0, fromFrame),
        durationInFrames,
        atomOriginalStart: atomTiming.original.start,
        words: atom.words ?? [],
        fallbackText: atom.subtitle_text ?? atom.text,
      };
```

白话翻译：

这就是一条字幕的完整挂载计划。

尤其注意：

- 如果有 `atom.words`，就可以做更细的逐字效果
- 否则至少还能退回 `fallbackText`

## 第六段：给整个逻辑段做渲染计划

```ts
export function buildRenderSegmentSequencePlans(
  renderInfos: SegmentRenderInfo[],
  timingMap: TimingMap,
  fps: number,
  totalFrames: number
): RenderSegmentSequencePlan[] {
```

白话翻译：

这一步是把“逻辑段级别的画面”真正排到时间轴上。

先建立 atom timing 索引：

```ts
  const atomTimingById = new Map(
    timingMap.segments.map((timing) => [timing.atom_id, timing] as const)
  );
```

白话翻译：

以后只要拿 atom id，就能快速查到它在 timing map 里的时间。

再看主循环：

```ts
  return renderInfos
    .map((info, index) => {
      const fromFrame = secondsToFramesFloor(info.outputStart, fps);
      const segDurationFrames = secondsToFramesCeil(
        info.outputEnd - info.outputStart,
        fps
      );
```

白话翻译：

这里先按每个 segment 自己的输出时间，换出：

- 这个 segment 从第几帧开始
- 理论上至少要持续多少帧

但它还做了一个重要处理：

```ts
      const nextInfo = renderInfos[index + 1];
      const sequenceEnd = nextInfo
        ? secondsToFramesFloor(nextInfo.outputStart, fps)
        : totalFrames;
      const durationInFrames = Math.max(
        segDurationFrames,
        sequenceEnd - fromFrame
      );
```

白话翻译：

意思是：

- 一个 segment 的持续时间，不只看自己最短内容时长
- 还会参考“下一个 segment 什么时候开始”

这样可以保证时间轴没有莫名空洞。

真实例子：

如果当前段理论内容只有 40 帧，  
但下一段要到 52 帧才开始，  
那当前段就会被撑到至少 52 帧，避免画面中间掉空。

### 最后把 keep atoms 的字幕也挂进去

```ts
      const keepAtoms = info.segment.atoms.filter(
        (atom): atom is KeepAtom => atom.status === "keep"
      );
```

白话翻译：

字幕只给保留的 atom 生成，discard 自然不该上屏。

最后返回：

```ts
      return {
        key: info.segment.id,
        fromFrame,
        durationInFrames,
        renderScene: info.renderScene,
        subtitles: buildSubtitleSequencePlans(
          keepAtoms,
          atomTimingById,
          info.outputStart,
          fps
        ),
      };
```

白话翻译：

这就形成了一个完整的“逻辑段渲染计划”：

- 段本身怎么排
- 这段里的字幕怎么排

## 这个文件在整条链路里的作用

一句话：

`src/compose/pipeline-plan.ts` 是“把秒级 timing map 翻译成 Remotion 帧级时间表”的中转层。  
没有它，后面的组件虽然知道要播什么，但不知道该在第几帧开始和结束。
