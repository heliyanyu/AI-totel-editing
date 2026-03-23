# `src/analyze/index.ts` 近乎逐行讲解

原文件：`src/analyze/index.ts`

这是当前项目最核心的总指挥文件之一。

如果说 `blueprint.ts` 是“施工图纸格式”，那这个文件就是“真的去组织施工的人”。

它做的事情可以用一句话概括：

把 `transcript.json` 一步步加工成 `blueprint.json`。

## 第一段：开头的大注释，其实已经把全流程说出来了

```ts
/**
 * 通道 1：review / 文本清洗
 * 通道 2：Step1 / 语义结构
 * 通道 3：take-pass / 音频选块
 * 通道 4：Step2 / 结构编排
 * 通道 5：post-process / 渲染前补齐
 */
```

白话翻译：

这不是一个“一次问模型，全做完”的文件。  
它是把任务拆成 5 条连续工序。

1. `review`
   把转录稿纠错、清洗、尽量和 source words 对齐
2. `Step1`
   只做语义拆解，把内容拆成 scene / logic / atom
3. `take-pass`
   决定哪些 atom 最终留，哪些删
4. `Step2`
   给保留后的结构分模板、分 view、生成 items
5. `post-process`
   最后补齐字幕对齐、媒体区间这些执行信息

真实例子：

医生原话可能很乱：

“这个药一般饭后吃，不对，更准确地说，建议饭后半小时吃。”

这 5 步会分别做：

- `review`：纠错、清理文本
- `Step1`：拆成语义小块
- `take-pass`：把口误版本丢掉
- `Step2`：决定这句适合做哪种画面模板
- `post-process`：把清洗后的句子重新挂回原视频时间

## 第二段：它依赖很多子模块

```ts
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve, join } from "path";
```

白话翻译：

这几行表示：

- 要跟大模型通信
- 要读写文件
- 要处理路径

后面还有一长串 import：

```ts
import {
  SYSTEM_PROMPT_STEP1,
  buildUserPromptStep1,
  SYSTEM_PROMPT_STEP2,
  buildUserPromptStep2,
  mergeStep2WithAtoms,
} from "./semantic/index.js";
```

白话翻译：

这些不是“马上执行”的代码，而是先把别处准备好的工具拿进来。

你可以把它理解成：总指挥先把各个小组的工人叫过来。

真实例子：

- `buildUserPromptStep1`：帮忙拼出发给模型的提问词
- `mergeStep2WithAtoms`：帮忙把 Step 2 的结果和 Step 1 的 atom 合并起来

## 第三段：一些全局常量

```ts
const DEFAULT_MODEL = DEFAULT_ANTHROPIC_MODEL;
const MAX_RETRIES = 2;
const MAX_TOKENS_REVIEW = 8192;
const MAX_TOKENS_STEP1 = 16384;
const MAX_TOKENS_TAKE_PASS = 8192;
const MAX_TOKENS_STEP2 = 8192;
```

白话翻译：

这里是在定规则：

- 默认用哪个模型
- 每个阶段失败后最多重试几次
- 每一步最多让模型输出多少 token

机器名词翻译：

- `token`：你可以先粗略理解成“模型处理文字的基本颗粒度”，不等于“字数”，但可以先把它当成长度额度。
- `retry`：重试。

真实例子：

如果 Step 1 模型偶尔返回坏 JSON，这里允许它最多再试 2 次，不会一次失败就全盘崩掉。

## 第四段：类型定义是在给参数做说明书

```ts
export type LLMProvider = "anthropic" | "openai";

interface StageModelConfig {
  provider: LLMProvider;
  model: string;
}
```

白话翻译：

这段是在说：

- 模型提供方目前只允许 `anthropic` 或 `openai`
- 每个阶段都要知道“用哪家”和“具体用哪个模型”

再往下：

```ts
interface AnalyzeModelOptions {
  provider?: LLMProvider;
  model?: string;
  reviewProvider?: LLMProvider;
  reviewModel?: string;
  step1Provider?: LLMProvider;
  step1Model?: string;
  takePassProvider?: LLMProvider;
  takePassModel?: string;
  step2Provider?: LLMProvider;
  step2Model?: string;
}
```

白话翻译：

这就是在允许你：

- 全部阶段都用同一个模型
- 或者每个阶段单独指定

真实例子：

你可以让：

- `review` 用更擅长纠错的模型
- `step1` 用更擅长结构拆解的模型
- `take-pass` 用更擅长判断口误和可播性的模型

## 第五段：客户端池子 `ClientPool`

```ts
interface ClientPool {
  anthropic?: Anthropic;
  openai?: OpenAI;
}
```

白话翻译：

这不是内容数据，而是“已经连上的模型客户端存放处”。

它的作用是：

- 不要每调用一次模型都重新创建一个连接对象
- 创建一次后，后面阶段可以复用

机器名词翻译：

- `client`：客户端。这里可以理解成“和模型通信的遥控器实例”。
- `pool`：池子。就是一个集中存放、反复复用的地方。

## 第六段：拿 OpenAI 客户端

```ts
function getOpenAIClient(options: {
  clients: ClientPool;
  apiKey?: string;
  baseUrl?: string;
}): OpenAI {
  if (options.clients.openai) {
    return options.clients.openai;
  }
```

白话翻译：

这段先做一件很朴素的事：

- 如果之前已经建过 OpenAI 客户端，直接拿来用
- 不要重复创建

接着：

```ts
  const apiKey =
    options.apiKey ??
    process.env.ARK_API_KEY ??
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "缺少 OpenAI-compatible API Key。请设置 ARK_API_KEY 或 OPENAI_API_KEY。"
    );
  }
```

白话翻译：

这里是在找钥匙。

优先顺序是：

1. 你这次显式传进来的 key
2. 环境变量里的 `ARK_API_KEY`
3. 环境变量里的 `OPENAI_API_KEY`

找不到就直接报错，不再往下装糊涂。

真实例子：

如果你忘了配置 key，项目不会假装还能继续做分析，它会明确告诉你“没钥匙，连不上模型”。

## 第七段：拿 Anthropic 客户端

```ts
function getAnthropicClient(options: {
  clients: ClientPool;
  apiKey?: string;
}): Anthropic {
  if (options.clients.anthropic) {
    return options.clients.anthropic;
  }
```

白话翻译：

这和 OpenAI 那段是同样的套路，只不过是另一家模型。

重点不是记语法，而是记住：

这个文件故意把“连模型的细节”包成小函数，这样主流程读起来不会太乱。

## 第八段：把 OpenAI 返回的内容抽成纯文本

```ts
function extractOpenAITextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }
```

白话翻译：

有些模型接口返回的内容不是一整块纯字符串，可能是一堆片段。

这个函数的任务是：

- 不管原始返回长什么样
- 最后尽量整理出一段纯文本

真实例子：

因为后面项目想做的事是“从模型回复里提 JSON”，所以首先得把回复文本整理平整。

## 第九段：`callLLM` 是全文件最重要的基础工人

```ts
async function callLLM(opts: CallLLMOptions): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`  重试 ${attempt}/${opts.maxRetries} ...`);
    }
```

白话翻译：

这个函数负责“真正去调用模型”，而且还带重试。

可以把它理解成一个通用客服：

- review 要找它
- Step1 要找它
- take-pass 要找它
- Step2 也要找它

它做的事情包括：

- 选 provider
- 发 system prompt 和 user prompt
- 接收返回结果
- 保存调试文件
- 解析 JSON
- 失败时重试

### 它怎么区分用哪家模型

```ts
      if (opts.provider === "anthropic") {
        const client = getAnthropicClient(...)
        ...
      } else {
        const client = getOpenAIClient(...)
        ...
      }
```

白话翻译：

同一个 `callLLM`，根据 `provider` 分岔。

- 如果是 `anthropic`，走 Anthropic 那套接口
- 否则走 OpenAI 兼容接口

这样主流程不用写两套重复代码。

### 它还会把原始回复和解析后的 JSON 存下来

```ts
      if (opts.debugDir) {
        writeFileSync(
          join(opts.debugDir, `llm-${opts.debugPrefix}-raw-${attempt}.txt`),
          rawText,
          "utf-8"
        );
      }

      const rawJson = extractJson(rawText);
```

白话翻译：

这里做了两件非常实用的事：

1. 把模型原话保存下来
2. 再从里面抽出 JSON

真实例子：

如果 Step 2 输出崩了，你之后去看 `debugDir` 里的文件，就能知道：

- 是模型原本就答歪了
- 还是 JSON 提取出了问题

这对排查很关键。

## 第十段：`resolveStageConfig` 决定每一步用什么模型

```ts
function resolveStageConfig(
  stage: "review" | "step1" | "takePass" | "step2",
  options?: AnalyzeModelOptions
): StageModelConfig {
```

白话翻译：

这个函数是“模型分配器”。

它的逻辑是：

- 先看你有没有给某个阶段单独指定 provider / model
- 如果没有，就回退到全局默认值

真实例子：

如果你只指定了：

```txt
--step1-provider openai --step1-model xxx
```

那就代表：

- Step1 用你单独指定的
- review / take-pass / step2 还是走默认配置

## 第十一段：四个阶段各自的调用函数

### `callTranscriptReview`

```ts
async function callTranscriptReview(
  transcriptWords: Word[],
  scriptText: string,
  stage: StageModelConfig,
  ...
): Promise<TranscriptReview> {
```

白话翻译：

这一步专门做“转录纠错”。

它会：

- 把 transcript words 拼成全文
- 把 docx 文案也拿来
- 一起发给模型
- 再把模型结果规范化成 `TranscriptReview`

真实例子：

如果 docx 里写的是“饭后半小时”，  
ASR 错听成了“饭后三小时”，  
review 阶段就是最早有机会把它纠正过来的地方。

### `callStep1`

```ts
async function callStep1(
  words: Word[],
  step1Hints: Step1Hints | null,
  ...
): Promise<any> {
```

白话翻译：

Step1 的目标不是最终删改，而是“把内容切开”。

所以它关心的是：

- atom 怎么切
- scene 怎么分
- logic 怎么分

### 这里有一个很关键的强制回正

```ts
  for (const atom of result.atoms) {
    atom.status = "keep";
    delete atom.reason;
  }
```

白话翻译：

这段非常重要。

它是在故意告诉系统：

- Step1 不负责最终 discard
- 就算模型在这一步顺手给了 discard，也先全部回正成 keep
- 真正的取舍，要交给后面的 take-pass

这能避免“语义拆解”和“音频可播取舍”混在一起。

### `callTakePass`

```ts
async function callTakePass(
  atoms: Array<{
    id: number;
    text: string;
    time: { s: number; e: number };
    ...
  }>,
  words: Word[],
  ...
): Promise<TakePassResult> {
```

白话翻译：

这里开始做“最终保留还是丢弃”的决定。

这一步更像音频剪辑助手，而不是语义结构设计师。

真实例子：

如果有两句意思差不多，但前一句是口误修正前的版本，  
take-pass 更可能把错误版本打成 discard。

### `callStep2`

```ts
async function callStep2(
  step1Result: any,
  words: Word[],
  ...
): Promise<any> {
```

白话翻译：

Step2 不再决定删不删，而是做“画面编排”：

- 场景标题
- view 模式
- 模板
- items

你可以把它理解成“内容结构已经定了，现在开始做视觉施工安排”。

## 第十二段：真正的大总流程 `analyzeTranscript`

```ts
export async function analyzeTranscript(
  transcript: Transcript,
  options?: AnalyzeModelOptions & {
    apiKey?: string;
    ...
  }
): Promise<Blueprint> {
```

白话翻译：

这是整个文件最重要的对外入口。  
别的地方如果想“把 transcript 变成 blueprint”，基本就是调用它。

### 先准备调试目录、认证、模型配置

```ts
  const maxRetries = options?.maxRetries ?? MAX_RETRIES;
  const debugDir = options?.outputDir ?? "";
  if (debugDir) {
    mkdirSync(debugDir, { recursive: true });
  }
```

白话翻译：

如果你给了输出目录，它会顺手把目录建好。  
后面所有中间文件都会往这里落。

### 通道 1：review

```ts
  if (options?.scriptPath) {
    const scriptText = await extractScriptText(options.scriptPath);
    ...
    const review = await callTranscriptReview(...)
    const { reviewedTranscript, report } = applyTranscriptReview(transcript, review);
    step1Transcript = reviewedTranscript;
  }
```

白话翻译：

如果你提供了参考文案 `scriptPath`，系统就会先做全文纠错。

结果不是直接改原文件，而是生成一份新的 `reviewedTranscript`。

真实例子：

原 transcript 可能是未经人工校对的 ASR。  
`reviewedTranscript` 则更像“修正后的可分析版本”。

### 通道 2：Step1

```ts
  const step1Hints = await buildStep1Hints(step1Transcript.words);
  const step1Result = await callStep1(
    step1Transcript.words,
    step1Hints,
    ...
  );
```

白话翻译：

系统先从文本里提一些提示线索，再交给 Step1 拆结构。

这些 `hints` 可以理解成“先给模型画重点”。

### 通道 3：take-pass

```ts
  const takePass = await callTakePass(
    step1Cleaned.atoms,
    step1Transcript.words,
    ...
  );
  const takeStats = applyTakePass(step1Taken, takePass);
```

白话翻译：

这里分两步：

1. 让模型返回 take-pass 判断结果
2. 把这些判断真正应用到 Step1 结果上

`applyTakePass` 的意思很朴素：把 keep / discard 状态真的写回去。

### 通道 4：Step2

```ts
  const step2Result = await callStep2(
    step1Taken,
    step1Transcript.words,
    ...
  );
```

白话翻译：

到了这一步，结构和取舍已经定了，才开始问：

- 这一段用什么模板
- items 怎么写
- 场景标题叫什么

### 合并 Step1 和 Step2

```ts
  const merged = mergeStep2WithAtoms(step1Taken, step2Result);
```

白话翻译：

你可以把这句理解成：

- Step1/Take-pass 手里有“内容骨架和保留结果”
- Step2 手里有“视觉编排”
- 现在把两边缝成一份完整蓝图

### 自动修补和校验

```ts
  const repaired = autoRepairBlueprint(merged);
  const validation = validateBlueprint(repaired, transcript.duration, spokenDuration);
```

白话翻译：

这一步是在出厂前自检。

- `autoRepairBlueprint`：自动补一些明显的小问题
- `validateBlueprint`：认真检查结构合法性和逻辑合理性

如果校验没过，就直接抛错，不继续往后渲染。

### 通道 5：渲染前补齐

```ts
  postProcessBlueprint(
    bp,
    transcript,
    step1Transcript,
    debugDir ? { debugPath: join(debugDir, "atom_alignment_debug.json") } : undefined
  );
```

白话翻译：

这是从“抽象蓝图”迈向“可执行蓝图”的关键一步。

它会帮每个 keep atom 补齐：

- `words`
- `alignment_mode`
- `media_range`

也就是让它真正能落到原视频时间上。

## 第十三段：CLI 入口 `main`

```ts
async function main() {
  const args = process.argv.slice(2);
  let transcriptPath = "";
  let outputPath = "";
  let model = DEFAULT_MODEL;
  let scriptPath = "";
```

白话翻译：

这段是给命令行使用的入口。

也就是说，当你执行：

```bash
npx tsx src/analyze/index.ts --transcript xxx.json -o blueprint.json
```

就是这里在接参数。

### 它会一项项解析命令行参数

```ts
    switch (args[i]) {
      case "--transcript":
      case "-t":
        transcriptPath = args[++i];
        break;
```

白话翻译：

`--transcript` 和 `-t` 是同义写法。  
后面紧跟的内容，会被当成 transcript 文件路径。

### 最后真正启动分析

```ts
  const blueprint = await analyzeTranscript(transcript, {
    model,
    step1Provider,
    step1Model: step1Model || undefined,
    takePassProvider,
    takePassModel: takePassModel || undefined,
    openaiBaseUrl: openaiBaseUrl || undefined,
    outputDir: dirname(outputPath),
    scriptPath: scriptPath ? resolve(scriptPath) : undefined,
  });
```

白话翻译：

前面一大堆准备，最终就是为了调用 `analyzeTranscript` 这个总入口。

然后：

```ts
  writeFileSync(outputPath, JSON.stringify(blueprint, null, 2), "utf-8");
```

把结果保存成 `blueprint.json`。

## 第十四段：只在直接运行这个文件时才触发 main

```ts
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("analyze/index.ts") ||
    process.argv[1].endsWith("analyze\\index.ts"));
if (isMainModule) {
  main().catch((err) => {
    console.error("错误:", err.message);
    process.exit(1);
  });
}
```

白话翻译：

这段是在分两种情况：

1. 你直接运行这个文件  
   那就启动 `main()`
2. 别的文件只是把这里的函数 import 过去  
   那就不要自动开跑

这能避免“刚导入就误执行整条分析链”。

## 这个文件在整条链路里的作用

一句话：

`src/analyze/index.ts` 就是“把原始 transcript 加工成可渲染 blueprint 的总装配线控制器”。

你如果总觉得项目里文件很多、很散，先抓住这一个核心认知：

- 它不是自己做所有细节
- 它负责按顺序叫起各个子模块
- 然后把中间结果存下来，最后交出 `blueprint.json`
