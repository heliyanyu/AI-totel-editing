# `src/renderer/source-direct-audio.ts` 近乎逐行讲解

原文件：`src/renderer/source-direct-audio.ts`

这个文件只做一件事：

按 `timingMap.clips` 把原视频里的音频片段抽出来，再拼成一条新的连续音轨。

如果说 `final-video.ts` 是总导出器，  
那这个文件就是 `source_direct` 路线里的“音频拼接师”。

## 第一段：只引入两个东西

```ts
import { execFileSync } from "child_process";
import type { TimingMap } from "../schemas/blueprint.js";
```

白话翻译：

这里说明它没有复杂的业务依赖。

- `TimingMap`：告诉它该切哪些片段
- `execFileSync`：让它去调用外部程序 `ffmpeg`

机器名词翻译：

- `child_process`：子进程。你可以理解成“让 Node 临时叫外部程序帮忙干活”。

## 第二段：先生成 ffmpeg 过滤器字符串

```ts
function buildConcatFilter(timingMap: TimingMap): string {
  if (timingMap.mode !== "source_direct") {
    throw new Error("Only source_direct timing maps can be rendered as direct audio.");
  }
```

白话翻译：

这个函数先卡死一个条件：

- 只有 `source_direct` 模式的 timing map 才能用这里的逻辑

因为这个文件就是专门为 `source_direct` 服务的。

### 给每个 clip 生成一段 `atrim`

```ts
  const trims = timingMap.clips.map((clip, index) => {
    const start = clip.source.start.toFixed(3);
    const end = clip.source.end.toFixed(3);
    return `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`;
  });
```

白话翻译：

这段是在给 ffmpeg 拼命令片段。

每个 clip 都会被翻译成一句意思大概像：

- 从原视频音轨里截出 `start` 到 `end`
- 然后把它时间轴重新从 0 开始记
- 给这一段起个临时名字，比如 `a0`、`a1`

机器名词翻译：

- `atrim`：音频裁剪。
- `asetpts=PTS-STARTPTS`：把这段裁出来的音频时间戳重置回从零开始。

真实例子：

如果 clip 要取原视频 `20.000s` 到 `24.500s`，  
这一句就会告诉 ffmpeg：把这段音频单独切出来。

### 如果只有一段 clip

```ts
  if (timingMap.clips.length === 1) {
    return `${trims[0]};[a0]anull[outa]`;
  }
```

白话翻译：

如果只有一段，就不用真的做拼接了。  
直接把这一段当成最终输出音轨即可。

### 如果有多段 clip

```ts
  const concatInputs = timingMap.clips.map((_, index) => `[a${index}]`).join("");
  return `${trims.join(";")};${concatInputs}concat=n=${timingMap.clips.length}:v=0:a=1[outa]`;
```

白话翻译：

这里才是真正多段拼接的情况。

逻辑是：

1. 前面每段先各自切出来
2. 再把这些段按顺序接起来
3. 生成一个最终输出音频 `outa`

机器名词翻译：

- `concat`：拼接。
- `v=0:a=1`：这里说明只拼音频，不拼视频。

## 第三段：真正导出音轨的主函数

```ts
export function renderSourceDirectAudioTrack(
  sourceVideoPath: string,
  timingMap: TimingMap,
  outputPath: string
): string {
```

白话翻译：

这就是外部真正调用的入口。

给它：

- 原视频路径
- timing map
- 输出 wav 路径

它就去生成一条新的音轨。

### 先做最基础的保护

```ts
  if (timingMap.mode !== "source_direct") {
    throw new Error("source_direct ... 需要 source_direct timing_map");
  }

  if (timingMap.clips.length === 0) {
    throw new Error("source_direct timing_map 缺少 clips");
  }
```

白话翻译：

如果：

- 模式不对
- 或者根本没有 clips

那就不应该继续执行 ffmpeg。

## 第四段：真正调用 ffmpeg

```ts
  const filterGraph = buildConcatFilter(timingMap);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      sourceVideoPath,
      "-filter_complex",
      filterGraph,
      "-map",
      "[outa]",
      "-c:a",
      "pcm_s16le",
      "-ar",
      "48000",
      outputPath,
    ],
```

白话翻译：

这就是把前面拼好的 ffmpeg 过滤器真正跑起来。

每个参数大致意思是：

- `-y`
  如果输出文件已存在，直接覆盖
- `-v error`
  只输出错误级日志，少一点噪音
- `-i sourceVideoPath`
  输入原视频
- `-filter_complex filterGraph`
  使用刚刚拼好的复杂滤镜图
- `-map [outa]`
  选择最终输出那条音频流
- `-c:a pcm_s16le`
  输出成无压缩 wav 常见格式
- `-ar 48000`
  采样率设为 48000

机器名词翻译：

- `sample rate / 采样率`
  你可以先理解成“声音每秒采样多少次”。
- `pcm_s16le`
  一种常见的 wav 音频编码方式。

真实例子：

如果 `timingMap.clips` 有三段：

1. 原视频 10-12 秒
2. 原视频 18-20 秒
3. 原视频 31-34 秒

那 ffmpeg 最终会把这三段音频依次拼成一条：

- 成片 0-2 秒
- 成片 2-4 秒
- 成片 4-7 秒

## 第五段：返回输出路径

```ts
  return outputPath;
}
```

白话翻译：

函数最后把生成好的音轨路径返回出去，  
方便 `final-video.ts` 后面继续拿去渲染。

## 这个文件在整条链路里的作用

一句话：

`src/renderer/source-direct-audio.ts` 是 `source_direct` 模式里负责“把分散原片音频拼成连续成片音轨”的专用工人。  
没有它，画面能排好，但声音没法自然连起来。
