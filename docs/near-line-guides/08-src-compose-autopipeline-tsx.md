# `src/compose/AutoPipeline.tsx` 近乎逐行讲解

原文件：`src/compose/AutoPipeline.tsx`

这个文件是 Remotion 那一侧最核心的画面总装组件。

前面我们已经有了：

- `blueprint`
- `timingMap`

这个文件要做的事就是：

把这些数据变成真正挂在 Remotion 时间轴上的组件树。

## 第一段：文件开头先说自己的职责

```tsx
/**
 * AutoPipeline - Remotion 合成组件
 *
 * 输出实体视频（信息图形 + 字幕 + 音频）。
 * 医生真人画面由剪辑师在剪映中作为 overlay 叠加。
 *
 * 遍历三级结构：scenes -> logic_segments -> atoms
 * 每个 LogicSegment 渲染为一个 Sequence
 */
```

白话翻译：

这段是在告诉你：

- 这里负责的是“信息图形 + 字幕 + 音频”的主视频
- 医生真人画面不在这里硬做完
- 每个逻辑段最终会变成 Remotion 里的一个 `Sequence`

机器名词翻译：

- `component`：组件。你可以理解成“可以拼装画面的积木块”。
- `Sequence`：Remotion 里的时间片段容器，相当于“这段组件在某一段时间内出现”。

## 第二段：引入依赖

```tsx
import React from "react";
import {
  AbsoluteFill,
  useVideoConfig,
  staticFile,
} from "remotion";
```

白话翻译：

这里拿进来的都是 Remotion/React 画面工具。

- `AbsoluteFill`：铺满整个画面
- `useVideoConfig`：拿当前视频配置，比如 fps、总帧数
- `staticFile`：把静态文件路径转换成 Remotion 可用的资源路径

继续看：

```tsx
import { PipelineAudioTrack } from "./AudioTrack";
import { SegmentSequence } from "./SegmentSequence";
import {
  buildRenderSegmentSequencePlans,
  buildSourceDirectAudioSequencePlans,
} from "./pipeline-plan";
import { segmentsToRenderScenes } from "./segment-to-scene";
```

白话翻译：

这就像总导演把几个小组叫进来：

- 音频组：`PipelineAudioTrack`
- 单段画面组：`SegmentSequence`
- 排片秘书：`pipeline-plan`
- 数据适配组：`segmentsToRenderScenes`

## 第三段：组件输入参数

```tsx
export interface AutoPipelineProps {
  audioSrc?: string;
  sourceVideoSrc?: string;
  blueprint: Blueprint;
  timingMap: TimingMap;
}
```

白话翻译：

这个组件要想工作，至少要喂它这些东西：

- `blueprint`：内容和模板结构
- `timingMap`：时间执行表

另外还可以给：

- `audioSrc`：音频资源
- `sourceVideoSrc`：原视频资源

真实例子：

如果是 `source_direct` 模式，音频可能来自前面临时生成的 `source_direct_audio.wav`。

## 第四段：组件函数开头

```tsx
export const AutoPipeline: React.FC<AutoPipelineProps> = ({
  audioSrc,
  sourceVideoSrc,
  blueprint,
  timingMap,
}) => {
  const { fps, durationInFrames: totalFrames } = useVideoConfig();
```

白话翻译：

这段表示：

- 组件先接收外面传进来的数据
- 再从 Remotion 当前环境里拿到 `fps` 和总帧数

这里的 `durationInFrames: totalFrames` 是重命名写法。  
意思是：把 `durationInFrames` 这个字段拿出来，并在本地叫 `totalFrames`。

## 第五段：把资源路径转成 Remotion 可用路径

```tsx
  const audioUrl = audioSrc ? staticFile(audioSrc) : "";
  const sourceVideoUrl = sourceVideoSrc ? staticFile(sourceVideoSrc) : "";
```

白话翻译：

如果外面给了资源路径，就把它转换成 Remotion 运行时可访问的地址。  
如果没给，就留空字符串。

真实例子：

`final-video.ts` 那边可能传进来：

- `audioSrc = "source_direct_audio.wav"`

这里就把它转成 Remotion 能加载的静态资源地址。

## 第六段：把 blueprint 和 timingMap 转成渲染计划

```tsx
  const renderInfos = segmentsToRenderScenes(blueprint, timingMap);
  const sourceDirectAudioPlans = buildSourceDirectAudioSequencePlans(
    timingMap,
    fps
  );
  const renderSegmentPlans = buildRenderSegmentSequencePlans(
    renderInfos,
    timingMap,
    fps,
    totalFrames
  );
```

白话翻译：

这是整个组件最关键的准备阶段。

它做了三层转换：

1. `segmentsToRenderScenes`
   把逻辑段转成渲染层爱吃的 `renderScene`
2. `buildSourceDirectAudioSequencePlans`
   把 timing map 变成音频排片计划
3. `buildRenderSegmentSequencePlans`
   把画面段和字幕排成帧级时间表

真实例子：

假设某个逻辑段应该在成片第 12 秒到第 17 秒出现，  
这里就会把它换算成：

- 从第几帧开始
- 持续多少帧
- 这段里挂哪些字幕

## 第七段：真正返回的 JSX

```tsx
  return (
    <AbsoluteFill>
      <PipelineAudioTrack
        mode={timingMap.mode}
        audioUrl={audioUrl}
        sourceVideoUrl={sourceVideoUrl}
        sourceDirectPlans={sourceDirectAudioPlans}
      />
```

白话翻译：

这段先铺一个全屏容器，然后先把音频轨道塞进去。

也就是说，成片不只是看见画面，还得有音频在底下同步播放。

继续看：

```tsx
      {renderSegmentPlans.map((plan) => (
        <SegmentSequence key={plan.key} plan={plan} />
      ))}
    </AbsoluteFill>
  );
```

白话翻译：

这里把每一个逻辑段计划，渲染成一个 `SegmentSequence`。

你可以把它想成：

- 总时间轴上依次摆很多段
- 每一段负责自己的模板画面和字幕

真实例子：

如果视频有 5 个逻辑段，  
那这里最后就会在 React 树里摆出 5 个 `SegmentSequence`。

## 第八段：这个文件到底没做什么

很容易误会这个文件“包办一切”，其实没有。

它没有亲自做这些事：

- 不决定保留哪句
- 不决定模板名是什么
- 不计算 atom 对齐
- 不生成 timing_map

这些都已经在前面完成了。

它只负责：

- 把前面的结果组织成 Remotion 可以渲染的组件树

## 这个文件在整条链路里的作用

一句话：

`src/compose/AutoPipeline.tsx` 是“最终视频画面树的总装组件”。  
前面所有分析、对齐、时间规划的结果，都会在这里真正汇合成一条可渲染时间轴。
