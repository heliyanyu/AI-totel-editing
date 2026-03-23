# `src/timing/build-direct-timing-map.ts` 近乎逐行讲解

原文件：`src/timing/build-direct-timing-map.ts`

这个文件的任务非常明确：

把 `blueprint` 变成 `timing_map`。

如果说 `blueprint` 是“内容施工图”，  
那 `timing_map` 就是“播放执行排班表”。

它会回答：

- 每个 atom 在成片里从几秒播到几秒
- 每个 clip 去原视频里取哪一段
- 最终整片总时长是多少

## 第一段：它依赖的不是模型，而是时间规划工具

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import type { Blueprint, Transcript } from "../schemas/blueprint.js";
import type { PlanningStrategy } from "../schemas/workflow.js";
```

白话翻译：

一眼就能看出，这个文件已经不碰大模型了。

它关心的是：

- 读蓝图文件
- 读 transcript 文件
- 写时间规划结果

后面关键 import 是：

```ts
import {
  validateTimingPlan,
  hasBlockingTimingIssues,
  formatTimingValidationFailures,
  writeTimingValidationReport,
} from "./validate-timing-map.js";
import {
  buildTimingMapFromBlueprint,
  buildTimingSegments,
  getVideoDuration,
} from "./planner.js";
import { reanchorBlueprintOccurrences } from "./reanchor-occurrences.js";
import { refineSourceDirectClipsWithAcousticTails } from "./acoustic-tail.js";
```

白话翻译：

这说明它的工作流程是：

1. 先生成初版 timing map
2. 再修 clip 尾部
3. 再做校验
4. 最后写文件

## 第二段：核心入口 `buildDirectTimingMap`

```ts
export async function buildDirectTimingMap(
  inputPath: string,
  blueprint: Blueprint,
  outputTarget: string,
  strategy: PlanningStrategy = "media_range_v2",
  transcript?: Transcript
) {
```

白话翻译：

这个函数是对外主入口。

你给它：

- 原视频路径
- 蓝图
- 输出目录或输出 json 路径
- 规划策略
- 可选 transcript

它就会给你生成 timing map。

机器名词翻译：

- `strategy`：策略。意思是“同样是做时间规划，但允许有不同算法路线”。

## 第三段：先把路径整理清楚

```ts
  const resolvedInput = resolve(inputPath);
  const resolvedOutputTarget = resolve(outputTarget);
  const isJsonTarget = resolvedOutputTarget.toLowerCase().endsWith(".json");
  const resolvedOutputDir = isJsonTarget ? dirname(resolvedOutputTarget) : resolvedOutputTarget;
  mkdirSync(resolvedOutputDir, { recursive: true });
```

白话翻译：

这里先在处理“写到哪里”的问题。

- 如果你传进来的是一个 `.json` 文件路径
  就把它当成目标 json 文件
- 否则就把它当成输出目录

然后无论哪种情况，都先保证目录存在。

真实例子：

你传的是：

`F:\AI total editing\output\case03`

那系统会默认在这个目录里写：

- `timing_map.json`
- `timing_clips_debug.json`
- 校验报告

## 第四段：按策略决定是否先做“重定位”

```ts
  const effectiveBlueprint =
    strategy === "occurrence_reanchor_v1" && transcript
      ? reanchorBlueprintOccurrences(blueprint, transcript, {
          debugDir: resolvedOutputDir,
        })
      : blueprint;
```

白话翻译：

这段的意思是：

- 默认直接用当前 blueprint
- 但如果你选了 `occurrence_reanchor_v1`，而且手头有 transcript
- 那就在做 timing 之前，先重新锚定 atom 出现位置

机器名词翻译：

- `reanchor`：重新锚定。可以理解成“重新认一次这句到底落在哪次出现上”。

真实例子：

有些句子在原视频里可能有多次相似出现，  
这个策略就是想在正式排时间前，再更稳地确认一次“该认哪一次”。

## 第五段：先拿视频总时长，再生成 timing map 初稿

```ts
  const totalDuration = getVideoDuration(resolvedInput);
  const timingMap = buildTimingMapFromBlueprint(
    effectiveBlueprint,
    totalDuration,
    "source_direct",
    strategy,
    transcript
  );
```

白话翻译：

这里做了两件基础工作：

1. 读原视频到底有多长
2. 根据蓝图和策略，生成一版 timing map 初稿

注意这句里模式写死成了：

```ts
"source_direct"
```

这代表当前这条链主打的是 `source_direct` 路线。

机器名词翻译：

- `source_direct`：不是先物理剪出一个新视频再播，而是直接按时间表去原视频里取片段。

## 第六段：修 clip 尾音

```ts
  timingMap.clips = refineSourceDirectClipsWithAcousticTails(
    resolvedInput,
    effectiveBlueprint,
    timingMap.clips
  );
```

白话翻译：

生成初稿之后，这里还会再修一次 clips。

重点是“声学尾巴”。

真实例子：

如果一句话听上去结束在 12.40 秒，  
但实际最后一个字的尾音拖到了 12.47 秒，  
这里可能就会帮你把 clip 稍微延长一点，避免听起来像被硬砍掉。

## 第七段：把 clips 再换算成 segments

```ts
  timingMap.segments = buildTimingSegments(
    effectiveBlueprint,
    timingMap.clips,
    strategy
  );
```

白话翻译：

前面更像先算“有哪些连续播放 clip”。  
这里则进一步把 atom 级别的时间对照表也建出来。

也就是：

- `clips`：偏真实播放片段
- `segments`：偏 atom 粒度对照

## 第八段：重新计算总时长

```ts
  timingMap.totalDuration =
    timingMap.clips.length > 0
      ? timingMap.clips[timingMap.clips.length - 1].output.end
      : 0;
```

白话翻译：

总时长不是随便猜的。  
这里直接拿最后一个 clip 的成片结束时间，作为整片总时长。

真实例子：

如果最后一个 clip 在成片里的 `output.end` 是 `46.83`，  
那整片总时长就按 `46.83s` 算。

## 第九段：决定文件输出路径

```ts
  const timingMapPath = isJsonTarget ? resolvedOutputTarget : join(resolvedOutputDir, "timing_map.json");
  const debugPath = join(resolvedOutputDir, "timing_clips_debug.json");
```

白话翻译：

这里是在约定：

- 主结果文件默认叫 `timing_map.json`
- clip 调试文件默认叫 `timing_clips_debug.json`

后者对排查很有帮助，因为你能直接看到每个 clip 切到了哪里。

## 第十段：做 timing 校验

```ts
  const timingValidation = validateTimingPlan(effectiveBlueprint, timingMap);
  const timingValidationPath = writeTimingValidationReport(resolvedOutputDir, timingValidation);
```

白话翻译：

这里不是立刻相信刚生成的时间表，而是先验一次。

它会检查很多问题，比如：

- 有没有 atom 找不到 timing
- 时间有没有倒流
- clip / segment 是否不一致

然后顺手把校验报告写到磁盘。

## 第十一段：先写文件，再决定要不要报错

```ts
  writeFileSync(timingMapPath, JSON.stringify(timingMap, null, 2), "utf-8");
  writeFileSync(debugPath, JSON.stringify(timingMap.clips, null, 2), "utf-8");
```

白话翻译：

这一步先把结果保存下来。  
哪怕后面校验失败，你手头也还有现场材料可查。

再往下：

```ts
  if (hasBlockingTimingIssues(timingValidation)) {
    throw new Error(
      `timing_map 校验失败:\n${formatTimingValidationFailures(timingValidation)}`
    );
  }
```

白话翻译：

如果发现的是“阻塞级问题”，就不允许继续假装成功。

这很重要，因为后面渲染极度依赖 timing map。  
时间表坏了，整片就会乱。

## 第十二段：CLI 入口 `main`

```ts
async function main() {
  const args = process.argv.slice(2);
  let inputPath = "";
  let blueprintPath = "";
  let outputPath = "";
  let transcriptPath = "";
  let strategy: PlanningStrategy = "media_range_v2";
```

白话翻译：

这又是一个命令行入口。

你在终端里运行：

```bash
npx tsx src/timing/build-direct-timing-map.ts --input doctor.mp4 --blueprint blueprint.json
```

就是这里在接参数。

### 它会一个个解析参数

```ts
      case "--input":
      case "-i":
        inputPath = args[++i];
        break;
```

白话翻译：

`--input` 和 `-i` 是同义词，后面跟原视频路径。

同理：

- `--blueprint`
- `--output`
- `--transcript`
- `--strategy`

也都在这里解析。

### 如果输入不完整，就直接告诉你正确用法

```ts
  if (!inputPath || !blueprintPath) {
    console.error(
      "用法: npx tsx src/timing/build-direct-timing-map.ts --input doctor.mp4 --blueprint blueprint.json ..."
    );
    process.exit(1);
  }
```

白话翻译：

这就是最基础的参数保护。  
没有原视频或 blueprint，就没法做 timing。

### 读文件并启动主函数

```ts
  const blueprint: Blueprint = JSON.parse(
    readFileSync(resolvedBlueprintPath, "utf-8")
  );
```

白话翻译：

先把 `blueprint.json` 读进内存，再调用刚才那个核心入口：

```ts
  const { timingMapPath, timingMap, timingValidationPath } = await buildDirectTimingMap(
    inputPath,
    blueprint,
    outputTarget,
    strategy,
    transcript
  );
```

### 最后打印总结

```ts
  console.log(`模式: ${timingMap.mode}`);
  console.log(`策略: ${strategy}`);
  console.log(`clips: ${timingMap.clips.length}`);
  console.log(`segments: ${timingMap.segments.length}`);
  console.log(`总时长: ${timingMap.totalDuration.toFixed(2)}s`);
```

白话翻译：

这就是让你跑完后一眼知道：

- 用的什么模式
- 用的什么策略
- 一共切成几个 clip
- 一共有多少 atom 级 segment
- 最终多长

## 这个文件在整条链路里的作用

一句话：

`src/timing/build-direct-timing-map.ts` 把“语义蓝图”翻译成“真正的时间执行表”。  
后面的字幕帧规划、音频拼接、最终渲染，都是在吃这份 `timing_map.json`。
