# `scripts/rebuild-output-from-blueprint.ts` 近乎逐行讲解

原文件：`scripts/rebuild-output-from-blueprint.ts`

这个脚本非常适合你现在这种工作方式：

已经有一个案例目录，里面有中间文件，  
你想从 `blueprint_merged.json` 一路重新补齐 output，必要时再重新渲染。

你可以把它理解成“从中间工件重新搭出完整案例”的一键重建脚本。

## 第一段：它依赖哪些模块

```ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  autoRepairBlueprint,
  validateBlueprint,
} from "../src/analyze/schema.js";
import { buildStep2Diagnostics } from "../src/analyze/step2-diagnostics.js";
import { postProcessBlueprint } from "../src/align/post-process.js";
import { renderFinalVideo } from "../src/renderer/render.js";
import type { Blueprint, Transcript, Word } from "../src/schemas/blueprint.js";
import { buildDirectTimingMap } from "../src/timing/build-direct-timing-map.js";
```

白话翻译：

这段 import 已经暴露出它的整体计划：

1. 读案例目录里的已有文件
2. 修补并校验蓝图
3. 重新做 post-process
4. 重新做 timing map
5. 需要的话重新 render

这就是为什么它特别适合调试。

## 第二段：命令行参数类型

```ts
type Args = {
  sourceDir: string;
  outputDir: string;
  videoPath: string;
  skipRender: boolean;
};
```

白话翻译：

这个脚本最关心 4 件事：

- 从哪个旧案例目录读
- 重新写到哪个新目录
- 原视频在哪
- 这次要不要跳过渲染

真实例子：

你可能会这样跑：

```bash
npx tsx scripts/rebuild-output-from-blueprint.ts --source-dir F:\AI total editing\output\case03 --output-dir F:\AI total editing\output\case03_rebuilt --video F:\AI total editing\素材\doctor.mp4 --skip-render
```

这表示：

- 用 case03 现有中间结果重建
- 输出到新目录
- 先不渲染最终视频，只把 json 都补齐

## 第三段：解析参数

```ts
function parseArgs(): Args {
  const args = process.argv.slice(2);
  let sourceDir = "";
  let outputDir = "";
  let videoPath = "";
  let skipRender = false;
```

白话翻译：

这就是命令行入口常见套路：

- 从终端参数里一项项往外拿
- 没给的先用空值或默认值

继续看：

```ts
      case "--source-dir":
        sourceDir = resolve(args[++index] ?? "");
        break;
      case "--output-dir":
        outputDir = resolve(args[++index] ?? "");
        break;
      case "--video":
        videoPath = resolve(args[++index] ?? "");
        break;
      case "--skip-render":
        skipRender = true;
        break;
```

白话翻译：

这些参数都比较直白：

- `--source-dir`：旧案例目录
- `--output-dir`：新输出目录
- `--video`：原视频
- `--skip-render`：只重建中间文件，不导视频

## 第四段：缺参数就立刻报用法

```ts
  if (!sourceDir || !outputDir || !videoPath) {
    throw new Error(
      "Usage: npx tsx scripts/rebuild-output-from-blueprint.ts --source-dir ... --output-dir ... --video ..."
    );
  }
```

白话翻译：

这意味着这个脚本最少需要这三样：

- 旧案例目录
- 新输出目录
- 原视频

缺一个都没法完整重建。

## 第五段：几个小工具函数

```ts
function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}
```

白话翻译：

这是一个简化小助手：  
以后读 json 不用每次都手写一长串。

再看：

```ts
function ensurePathExists(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}
```

白话翻译：

如果关键文件不存在，就别往下装作没事，直接报错。

还有：

```ts
function maybeCopy(sourceDir: string, outputDir: string, fileName: string): void {
  const sourcePath = join(sourceDir, fileName);
  if (!existsSync(sourcePath)) {
    return;
  }
  copyFileSync(sourcePath, join(outputDir, fileName));
}
```

白话翻译：

这段是“有就复制，没有就跳过”。  
适合那些不是每个案例都一定存在的辅助文件。

## 第六段：主函数开头，先建输出目录

```ts
async function main() {
  const args = parseArgs();
  mkdirSync(args.outputDir, { recursive: true });
```

白话翻译：

重建前先把目标目录准备好。

## 第七段：锁定要读取的关键输入文件

```ts
  const blueprintMergedPath = join(args.sourceDir, "blueprint_merged.json");
  const transcriptPath = join(args.sourceDir, "transcript.json");
  const reviewedTranscriptPath = join(args.sourceDir, "reviewed_transcript.json");
```

白话翻译：

它默认从旧案例目录里拿这几个核心文件。

这里很关键：  
它不是从头重新跑 LLM 分析，而是直接从“已经有的中间结果”接着重建。

继续看：

```ts
  ensurePathExists(blueprintMergedPath, "blueprint_merged");
  ensurePathExists(transcriptPath, "transcript");
  ensurePathExists(reviewedTranscriptPath, "reviewed_transcript");
```

白话翻译：

这三个缺任何一个，都不继续。

## 第八段：读进中间结果

```ts
  const merged = readJsonFile<any>(blueprintMergedPath);
  const transcript = readJsonFile<Transcript>(transcriptPath);
  const reviewedTranscript = readJsonFile<Transcript>(reviewedTranscriptPath);
```

白话翻译：

这里把旧案例里的核心中间数据都读进来了。

- `merged`：Step1/Step2 合并后的蓝图
- `transcript`：原始转录
- `reviewedTranscript`：review 后的转录

## 第九段：重新修补并校验 blueprint

```ts
  const repaired = autoRepairBlueprint(merged);
  const spokenDuration = transcript.words.reduce(
    (sum: number, word: Word) => sum + (word.end - word.start),
    0
  );
  const validation = validateBlueprint(
    repaired,
    transcript.duration,
    spokenDuration
  );
```

白话翻译：

这一步很重要，因为旧案例里的 `blueprint_merged.json` 还不一定是最终安全成品。

所以要：

1. 先修补
2. 再校验

这里的 `spokenDuration` 是把每个词的时长都加起来，算出总说话时长，供校验参考。

### 如果校验失败就直接停

```ts
  if (validation.zodErrors) {
    throw new Error(
      `Blueprint Zod validation failed:\n${validation.zodErrors.join("\n")}`
    );
  }

  if (validation.logicErrors?.length) {
    throw new Error(
      `Blueprint logic validation failed:\n${validation.logicErrors.join("\n")}`
    );
  }
```

白话翻译：

这里分两类错误：

- 结构格式错了
- 逻辑关系错了

不管哪种，只要严重，就不允许继续往后重建。

## 第十段：重新做 post-process

```ts
  const blueprint = validation.data as Blueprint;
  postProcessBlueprint(blueprint, transcript, reviewedTranscript, {
    debugPath: join(args.outputDir, "atom_alignment_debug.json"),
  });
```

白话翻译：

这一步是整个重建脚本的核心价值之一。

它会重新帮每个 keep atom 补齐：

- words
- alignment_mode
- media_range

也就是说，把旧的合并蓝图重新升级成“可执行蓝图”。

## 第十一段：把重建后的核心文件写回新目录

```ts
  writeFileSync(
    join(args.outputDir, "blueprint.json"),
    JSON.stringify(blueprint, null, 2),
    "utf-8"
  );
```

白话翻译：

这句会把“后处理完成后的正式 blueprint”写进新目录。

接着：

```ts
  writeFileSync(
    join(args.outputDir, "blueprint_merged.json"),
    JSON.stringify(merged, null, 2),
    "utf-8"
  );
```

白话翻译：

旧的 `merged` 版本也保留下来。  
这样你既能看修补前的形态，也能看修补后的正式版。

再看：

```ts
  writeFileSync(
    join(args.outputDir, "step2_diagnostics.json"),
    JSON.stringify(buildStep2Diagnostics(blueprint), null, 2),
    "utf-8"
  );
```

白话翻译：

这里还顺手生成一份 Step2 诊断文件，方便看场景/模板结构质量。

## 第十二段：把旧案例里的其它辅助文件也带过去

```ts
  maybeCopy(args.sourceDir, args.outputDir, "transcript.json");
  maybeCopy(args.sourceDir, args.outputDir, "reviewed_transcript.json");
  maybeCopy(args.sourceDir, args.outputDir, "reviewed_transcript.txt");
  maybeCopy(args.sourceDir, args.outputDir, "reviewed_transcript_map.json");
  maybeCopy(args.sourceDir, args.outputDir, "review_spans.json");
  maybeCopy(args.sourceDir, args.outputDir, "step1_result.json");
  maybeCopy(args.sourceDir, args.outputDir, "step1_cleaned.json");
  maybeCopy(args.sourceDir, args.outputDir, "step1_taken.json");
  maybeCopy(args.sourceDir, args.outputDir, "step2_result.json");
  maybeCopy(args.sourceDir, args.outputDir, "take_pass_result.json");
  maybeCopy(args.sourceDir, args.outputDir, "take_pass_annotation.md");
```

白话翻译：

这些不是必须重新算的，但对调试很有价值，所以能带就带过去。

这样新目录不仅有最终产物，还有完整过程痕迹。

## 第十三段：重新生成 timing map

```ts
  const timing = await buildDirectTimingMap(
    args.videoPath,
    blueprint,
    args.outputDir,
    "media_range_v2",
    transcript
  );
```

白话翻译：

到了这里，重建脚本会正式生成新的 `timing_map.json`。

注意它这里写死的是：

`"media_range_v2"`

说明这套重建默认按当前主策略来做 timing。

## 第十四段：可选跳过渲染

```ts
  if (args.skipRender) {
    console.log(
      JSON.stringify(
        {
          outputDir: args.outputDir,
          blueprintPath: join(args.outputDir, "blueprint.json"),
          timingMapPath: timing.timingMapPath,
          skippedRender: true,
        },
        null,
        2
      )
    );
    return;
  }
```

白话翻译：

这段很实用。

如果你现在只想调：

- 对齐
- timing
- 中间 JSON

不想每次都花时间重新导视频，那就加 `--skip-render`。

## 第十五段：如果不跳过，就继续导最终视频

```ts
  const resultPath = join(args.outputDir, "result.mp4");
  await renderFinalVideo({
    blueprintPath: join(args.outputDir, "blueprint.json"),
    timingMapPath: join(args.outputDir, "timing_map.json"),
    sourceVideoPath: args.videoPath,
    outputPath: resultPath,
  });
```

白话翻译：

这一步就把前面重建好的：

- `blueprint.json`
- `timing_map.json`

喂给渲染器，最终输出 `result.mp4`。

也就是说，这个脚本本身就可以闭环跑完：

- 重建中间文件
- 重做 timing
- 导出最终视频

## 第十六段：最后打印结果摘要

```ts
  console.log(
    JSON.stringify(
      {
        outputDir: args.outputDir,
        resultPath,
        blueprintPath: join(args.outputDir, "blueprint.json"),
        timingMapPath: timing.timingMapPath,
      },
      null,
      2
    )
  );
```

白话翻译：

跑完后它会明确告诉你：

- 新 output 在哪
- 最终视频在哪
- blueprint 在哪
- timing_map 在哪

这对批量重建案例很方便。

## 第十七段：错误兜底

```ts
main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
```

白话翻译：

如果主流程中间任何一步抛错，这里会统一把错误打印出来，然后让脚本退出。

## 这个文件在整条链路里的作用

一句话：

`scripts/rebuild-output-from-blueprint.ts` 是“从已有案例中间工件快速重建整套 output”的实战脚本。  
它特别适合调试、回放、验证你修改某一环之后会不会把后面链路带歪。
