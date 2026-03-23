# `src/renderer/final-video.ts` 近乎逐行讲解

原文件：`src/renderer/final-video.ts`

这个文件负责一件最直接的事：

把 `blueprint + timing_map + 媒体资源` 真正渲染成一个 MP4 文件。

如果说 `AutoPipeline.tsx` 是画面装配图，  
那这个文件就是“按下导出按钮的人”。

## 第一段：文件开头的注释很直白

```ts
/**
 * 程序化 Remotion 渲染
 *
 * 读取 blueprint + timing_map，调用 Remotion 渲染输出实体 MP4 视频
 */
```

白话翻译：

这已经说明了它不是做分析的，也不是做时间规划的。  
它是最终导出的执行层。

## 第二段：引入真正的渲染工具

```ts
import { renderMedia, selectComposition } from "@remotion/renderer";
import { readFileSync } from "fs";
import { resolve, basename, dirname } from "path";
```

白话翻译：

这几行说明：

- 要从磁盘读 json
- 要处理路径
- 要调用 Remotion 的核心渲染接口

后面关键 import 还有：

```ts
import { VIDEO_FPS } from "../remotion/utils.js";
import type { Blueprint, TimingMap } from "../schemas/blueprint.js";
import { allAtoms } from "../schemas/blueprint.js";
import {
  validateTimingPlan,
  hasBlockingTimingIssues,
  formatTimingValidationFailures,
} from "../timing/validate-timing-map.js";
import { bundleRemotionProject } from "./bundle.js";
import { resolveRenderConcurrency } from "./render-concurrency.js";
import { renderSourceDirectAudioTrack } from "./source-direct-audio.js";
```

白话翻译：

这说明在真正渲染前，它还要先做几件事：

- 校验 timing
- 准备 Remotion bundle
- 决定并发数
- 必要时先生成 `source_direct` 音轨

## 第三段：渲染参数说明

```ts
export interface RenderOptions {
  blueprintPath: string;
  timingMapPath: string;
  cutVideoPath?: string;
  sourceVideoPath?: string;
  outputPath: string;
  codec?: "h264" | "h265" | "vp8" | "vp9";
  concurrency?: number;
}
```

白话翻译：

这个接口就是“导出视频时，你得交给我的那些东西”。

最核心的是：

- `blueprintPath`
- `timingMapPath`
- `outputPath`

另外还可能需要：

- `cutVideoPath`
- `sourceVideoPath`

因为不同模式喂的媒体源不一样。

机器名词翻译：

- `codec`：编码格式。你可以先把它理解成“导出视频采用哪种压缩编码方案”。
- `concurrency`：并发。可以理解成“同时开多少个工位来渲染”。

## 第四段：先决定媒体怎么喂给渲染器

```ts
function resolveMediaPath(
  timingMap: TimingMap,
  options: RenderOptions
): { publicDir: string; audioSrc?: string; sourceVideoSrc?: string } {
```

白话翻译：

这段是个很关键的分流器。  
它要根据 `timingMap.mode` 决定：

- 这次渲染实际该用哪种媒体资源
- Remotion 的 `publicDir` 应该指向哪里

### 如果是 `source_direct`

```ts
  if (timingMap.mode === "source_direct") {
    if (!options.sourceVideoPath) {
      throw new Error("timing_map.mode=source_direct 时必须提供 sourceVideoPath");
    }
    const audioTrackPath = resolve(
      dirname(options.outputPath),
      "source_direct_audio.wav"
    );
    renderSourceDirectAudioTrack(
      resolve(options.sourceVideoPath),
      timingMap,
      audioTrackPath
    );
```

白话翻译：

这段意思是：

- 如果采用 `source_direct`
- 那必须给原视频路径
- 而且要先根据 timing map，从原视频里拼出一条新的音轨文件

这条音轨文件默认会放在最终输出视频旁边，名字叫：

`source_direct_audio.wav`

真实例子：

如果最终视频只保留了原视频里的第 10-14 秒、第 20-24 秒两段，  
这里就会先把这两段音频拼成一条连续 wav，再交给 Remotion。

### 如果不是 `source_direct`

```ts
  if (!options.cutVideoPath) {
    throw new Error("timing_map.mode=cut_video 时必须提供 cutVideoPath");
  }
  const mediaPath = resolve(options.cutVideoPath);
  return {
    publicDir: dirname(mediaPath),
    audioSrc: basename(mediaPath),
  };
```

白话翻译：

如果是传统 `cut_video` 模式，就直接使用已经裁好的成品视频作为媒体源。

## 第五段：真正的主入口 `renderFinalVideo`

```ts
export async function renderFinalVideo(options: RenderOptions): Promise<string> {
  const {
    blueprintPath,
    timingMapPath,
    outputPath,
    codec = "h264",
    concurrency,
  } = options;
```

白话翻译：

这就是外面真正会调用的核心函数。  
它先把参数拆开，并给 `codec` 默认值 `h264`。

### 先把蓝图和 timing map 读进来

```ts
  const blueprint: Blueprint = JSON.parse(
    readFileSync(resolve(blueprintPath), "utf-8")
  );
  const timingMap: TimingMap = JSON.parse(
    readFileSync(resolve(timingMapPath), "utf-8")
  );
```

白话翻译：

导出视频前，它需要先把前面步骤产出的 json 都重新读进内存。

### 统计 atom 数量和总帧数

```ts
  const atoms = allAtoms(blueprint);
  const totalDurationFrames = Math.ceil(timingMap.totalDuration * VIDEO_FPS);
```

白话翻译：

这里做两件常规准备：

- 数一下一共有多少 atom
- 根据总秒数和 fps 算出整片总帧数

真实例子：

如果总时长是 `46.2s`，fps 是 `30`，  
总帧数大约就是 `1386` 帧。

## 第六段：渲染前再次做 timing 校验

```ts
  const timingValidation = validateTimingPlan(blueprint, timingMap);
  if (hasBlockingTimingIssues(timingValidation)) {
    throw new Error(
      `渲染前 timing 校验失败:\n${formatTimingValidationFailures(timingValidation)}`
    );
  }
```

白话翻译：

即使 timing 在生成时已经验过一次，  
这里还是再验一次。

原因很简单：

- 渲染是昂贵步骤
- 如果时间表有硬伤，宁可现在停，不要渲到一半才发现片子是坏的

再看：

```ts
  if (timingValidation.summary.warn_count > 0) {
    console.log(`  timing 警告: ${timingValidation.summary.warn_count} 条`);
  }
```

白话翻译：

如果只是警告，不一定阻塞，但也会提示你注意。

## 第七段：解析媒体路径

```ts
  const media = resolveMediaPath(timingMap, options);
```

白话翻译：

这句会触发前面讲的分流逻辑：

- `source_direct` 就先拼音频
- `cut_video` 就直接用裁好的视频

## 第八段：打印渲染前摘要

```ts
  console.log(`  Blueprint: ${blueprint.scenes.length} 场景, ${atoms.length} 原子块`);
  console.log(`  模式: ${timingMap.mode}`);
  console.log(
    `  时长: ${timingMap.totalDuration.toFixed(2)}s (${totalDurationFrames} frames)`
  );
```

白话翻译：

这是给你一个出发前的概览：

- 几个场景
- 几个 atom
- 什么模式
- 多长

这对肉眼判断“这次渲染是不是明显不对劲”很有帮助。

## 第九段：决定并发数

```ts
  const resolvedConcurrency = resolveRenderConcurrency(
    timingMap.mode,
    concurrency
  );
  if (resolvedConcurrency !== null) {
    console.log(`  并发: ${resolvedConcurrency}`);
  }
```

白话翻译：

这里是在决定：

- 这次到底开多少并发去渲染

并发不是越高越好，因为电脑资源有限。  
这个 helper 会根据模式和用户输入，给出一个合适结果。

## 第十段：先打包 Remotion 项目

```ts
  console.log("  打包 Remotion 项目...");
  const bundleLocation = await bundleRemotionProject({
    publicDir: media.publicDir,
  });
```

白话翻译：

这一步可以理解成：

- 先把 React/Remotion 这套视频工程打成一个可运行包
- 之后渲染器才能去执行它

机器名词翻译：

- `bundle`：打包。意思是把分散的源码、组件、资源整理成渲染器能直接运行的版本。

## 第十一段：准备传给 Remotion 的输入

```ts
  const inputProps = {
    audioSrc: media.audioSrc ?? "",
    sourceVideoSrc: media.sourceVideoSrc ?? "",
    blueprint,
    timingMap,
    durationInFrames: totalDurationFrames,
  };
```

白话翻译：

这就是喂给 Remotion 组件树的主要数据包。

你可以把它理解成：

- 画面组件要看的 blueprint
- 时间轴要看的 timingMap
- 音频路径
- 总帧数

## 第十二段：选中名为 `AutoPipeline` 的 composition

```ts
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "AutoPipeline",
    inputProps,
  });
```

白话翻译：

Remotion 项目里可能有多个 composition。  
这里明确说：我要用那个叫 `AutoPipeline` 的。

这就和前面 `src/compose/AutoPipeline.tsx` 对上了。

## 第十三段：真正开始渲染

```ts
  await renderMedia({
    composition: {
      ...composition,
      durationInFrames: totalDurationFrames,
    },
    serveUrl: bundleLocation,
    codec,
    outputLocation: resolvedOutput,
    inputProps,
    concurrency: resolvedConcurrency,
```

白话翻译：

这就是“按下导出”本体。

它把：

- 选好的 composition
- 输入 props
- 输出路径
- 编码格式
- 并发数

全都交给 Remotion 渲染器。

再看进度回调：

```ts
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 10 === 0) {
        process.stdout.write(`\r  渲染进度: ${Math.round(progress * 100)}%`);
      }
    },
```

白话翻译：

这不是影响业务逻辑，只是为了在终端里显示渲染进度。

## 第十四段：渲染完成

```ts
  console.log(`\n  渲染完成: ${resolvedOutput}`);
  return resolvedOutput;
```

白话翻译：

最终：

- 在终端里告诉你输出文件在哪
- 同时把输出路径作为函数返回值交出去

## 这个文件在整条链路里的作用

一句话：

`src/renderer/final-video.ts` 就是“真正导出成片”的执行器。  
前面所有蓝图、对齐、时间规划，到了这里才最终变成一个可以打开观看的 MP4。
