# `src/schemas/blueprint.ts` 近乎逐行讲解

原文件：`src/schemas/blueprint.ts`

这个文件是整个项目最基础的“数据宪法”。

几乎所有核心文件都会依赖它，因为大家都得先约定好：

- `transcript.json` 长什么样
- `blueprint.json` 长什么样
- `timing_map.json` 长什么样
- 一个 atom / segment / scene / clip 到底有哪些字段

如果把项目比作盖房子，这个文件不是砌墙的人，而是“施工图纸的格式标准”。

## 第一段：文件开头在先讲概念

```ts
/**
 * Blueprint Schema — 三级语义结构
 *
 * 三级结构: Blueprint → BlueprintScene → LogicSegment → BlueprintAtom
 * - BlueprintScene: 话题场景（意图变化处分割），控制 overlay/graphics 模式
 * - LogicSegment:   逻辑段（角度转变处分割），携带模板和渲染条目
 * - BlueprintAtom:  原子语义块（最小不可中断单元），携带时间戳和 keep/discard 状态
 */
```

白话翻译：

这里先告诉你，这个项目不是把整段视频当成一坨处理，而是拆成三级。

- `Scene`：大话题层
- `LogicSegment`：话题里的一个逻辑角度
- `Atom`：最小的一小句内容

真实例子：

假设医生在说这段口播：

“高血压不是只看一次血压值。第一，要看连续监测。第二，要看有没有头晕胸闷。”

它可能会被拆成：

- 一个 `Scene`：高血压判断
- 两个 `LogicSegment`
  - 为什么不能只看一次
  - 应该看哪些指标
- 若干个 `Atom`
  - “高血压不是只看一次血压值”
  - “第一，要看连续监测”
  - “第二，要看有没有头晕胸闷”

机器名词翻译：

- `Schema`：数据格式规则。
- `Atom`：这里不是化学，是“最小播放单元”。

## 第二段：引入 Zod

```ts
import { z } from "zod";
```

白话翻译：

`zod` 是这份文件最重要的外部工具。  
它专门用来描述“一个数据必须长成什么样”，同时还能在运行时帮你验货。

真实例子：

如果某个地方本来应该给：

```json
{ "start": 1.2, "end": 2.6 }
```

结果你不小心写成：

```json
{ "start": "1.2", "end": "2.6" }
```

`zod` 有机会帮你发现：这里本来应该是数字，不应该是字符串。

## 第三段：模板类型

```ts
export const TemplateId = z.enum([
  "hero_text",
  "number_center",
  "warning_alert",
  "term_card",
  "image_overlay",
  "list_fade",
  "color_grid",
  "body_annotate",
  "step_arrow",
  "branch_path",
  "brick_stack",
  "split_column",
  "myth_buster",
  "category_table",
  "vertical_timeline",
]);
export type TemplateId = z.infer<typeof TemplateId>;
```

白话翻译：

这段代码是在规定：项目允许使用的模板名字只有这 15 种，不能随便写别的。

如果 Step 2 大模型输出了一个不存在的模板名，比如 `"cool_super_card"`，那后面渲染层就容易接不住。

机器名词翻译：

- `enum`：你可以理解成“只能从这几个选项里选”。
- `infer`：从上面的规则自动推导 TypeScript 类型，避免写两遍。

真实例子：

如果某个逻辑段适合“警示卡片”，那它的模板可能就是：

```json
"template": "warning_alert"
```

## 第四段：Word 和 Transcript

```ts
export const Word = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  source_word_indices: z.array(z.number()).optional(),
  source_start: z.number().optional(),
  source_end: z.number().optional(),
  synthetic: z.boolean().optional(),
});
export type Word = z.infer<typeof Word>;

export const Transcript = z.object({
  duration: z.number(),
  words: z.array(Word),
});
```

白话翻译：

这里定义了“一个词”和“整份转录稿”长什么样。

`Word` 里最关键的是：

- `text`：这个词本身
- `start`：它开始说出的时间
- `end`：它结束说出的时间

`Transcript` 就是：

- 整段视频总时长
- 一大串带时间的词

真实例子：

```json
{
  "text": "高血压",
  "start": 12.48,
  "end": 12.93
}
```

它的意思不是“第 12 行第 93 个字”，而是：

- 这几个字在视频第 12.48 秒开始
- 在第 12.93 秒结束

这些时间就是后面做字幕、做切点、做音频拼接的基础。

## 第五段：TimeRange 和 ViewMode

```ts
export const TimeRange = z.object({
  start: z.number(),
  end: z.number(),
});

export const ViewMode = z.enum(["overlay", "graphics"]);
```

白话翻译：

`TimeRange` 是一个非常常见的小盒子，意思是“一段时间范围”。

`ViewMode` 则是在规定：画面模式只能是两种之一。

- `overlay`：通常理解成真人画面叠加信息
- `graphics`：更偏纯图形信息画面

真实例子：

某段内容可能语义时间是：

```json
{ "start": 15.2, "end": 18.9 }
```

表示它在原始语义上覆盖了这 3.7 秒。

## 第六段：BlueprintItem

```ts
export const BlueprintItem = z.object({
  text: z.string(),
  emoji: z.string().optional(),
});
```

白话翻译：

这个类型不是一句完整口播，而是“给画面模板展示的小条目”。

真实例子：

如果模板是列表型，里面可能有：

```json
[
  { "text": "连续监测" },
  { "text": "看伴随症状", "emoji": "⚠" }
]
```

也就是说，模板组件渲染时，并不是直接把全部口播原文照搬上屏，而是使用这些更适合视觉展示的小条目。

## 第七段：KeepAtom 和 DiscardAtom

```ts
export const KeepAtom = z.object({
  id: z.number(),
  text: z.string(),
  time: TimeRange,
  status: z.literal("keep"),
  audio_span_id: z.string().optional(),
  words: z.array(Word).optional().default([]),
  subtitle_text: z.string().optional(),
  alignment_mode: z
    .enum(["reviewed_exact", "reviewed_projected", "static_fallback"])
    .optional(),
  alignment_confidence: z.number().optional(),
  media_range: TimeRange.optional(),
  media_mode: z
    .enum(["words_exact", "words_projected", "fallback_time"])
    .optional(),
  media_confidence: z.number().optional(),
  media_occurrence: z
    .enum(["last_complete", "last_window", "fallback_time"])
    .optional(),
});
```

白话翻译：

这就是项目里最重要的数据类型之一：保留下来的 atom。

前几项容易懂：

- `id`：每个 atom 的编号
- `text`：这句 atom 的文本
- `time`：它在语义层大概对应的时间范围
- `status: "keep"`：说明这句最后要保留

后面几项是项目的精华：

- `words`：真正对齐到的字级时间
- `subtitle_text`：字幕要显示什么文字
- `alignment_mode`：字幕对齐是怎么对上的
- `media_range`：最后真正要去原视频里取哪一段
- `media_mode`：这个媒体区间是精确对齐来的，还是退化方案

机器名词翻译：

- `literal("keep")`：只能是 `keep`，不能填别的。
- `alignment`：对齐。意思是“把清洗后的文字重新挂回原视频时间轴”。
- `fallback`：兜底退路。意思是“理想方法不够可靠时，就用次优但更稳的方法”。

真实例子：

有时 atom 文本是“高血压不能只看一次”，  
但转录原文可能是“高血压不是说只看一次就行”。

这时候：

- `text` 是清洗后的表达
- `words` 是尽量对回原始 ASR 时间
- `media_range` 是最终真的去原视频里拿的片段

```ts
export const DiscardAtom = z.object({
  id: z.number(),
  text: z.string(),
  time: TimeRange,
  status: z.literal("discard"),
  reason: z.string(),
});
```

白话翻译：

`DiscardAtom` 就是被淘汰掉的 atom。

它也保留文本和时间，因为：

- 后面做调试时要知道到底删了什么
- 对齐时还可能拿它来约束搜索窗口

真实例子：

如果医生口误说了：

“这个药一天吃三次，不对，一天吃两次。”

那前面的错误版本就很可能变成一个 `discard atom`。

## 第八段：把 keep 和 discard 合成 BlueprintAtom

```ts
export const BlueprintAtom = z.discriminatedUnion("status", [
  KeepAtom,
  DiscardAtom,
]);
```

白话翻译：

这句的意思是：

“一个 atom 要么是 keep，要么是 discard，由 `status` 字段来区分。”

机器名词翻译：

- `discriminatedUnion`：可以理解成“同一个盒子家族，但用某个字段区分具体是哪一类”。

## 第九段：LogicSegment、BlueprintScene、Blueprint

```ts
export const LogicSegment = z.object({
  id: z.string(),
  transition_type: z.string(),
  template: TemplateId,
  items: z.array(BlueprintItem),
  atoms: z.array(BlueprintAtom),
  template_props: z.record(z.unknown()).optional().default({}),
});

export const BlueprintScene = z.object({
  id: z.string(),
  title: z.string(),
  view: ViewMode,
  logic_segments: z.array(LogicSegment),
});

export const Blueprint = z.object({
  title: z.string(),
  scenes: z.array(BlueprintScene),
});
```

白话翻译：

这三段就是整个蓝图的真正骨架。

从小到大看：

- `atoms` 组成一个 `LogicSegment`
- 多个 `LogicSegment` 组成一个 `Scene`
- 多个 `Scene` 组成整个 `Blueprint`

其中：

- `transition_type`：这段逻辑是“定义”“对比”“步骤”“误区提醒”之类的哪种转折
- `template`：用哪个视觉模板渲染
- `items`：模板要展示的小条目
- `template_props`：模板的额外参数

真实例子：

一个场景可能长这样：

```json
{
  "id": "S1",
  "title": "高血压判断",
  "view": "graphics",
  "logic_segments": [...]
}
```

意思就是：第一大场景叫“高血压判断”，这段偏图形表达，里面还会继续拆逻辑段。

## 第十段：Timing Map 相关类型

```ts
export const TimingSegment = z.object({
  atom_id: z.number(),
  original: TimeRange,
  output: TimeRange,
});

export const TimingClip = z.object({
  id: z.string(),
  source: TimeRange,
  content: TimeRange,
  output: TimeRange,
  atom_ids: z.array(z.number()),
});

export const TimingMap = z.object({
  mode: TimingMode.optional().default("cut_video"),
  segments: z.array(TimingSegment),
  clips: z.array(TimingClip).optional().default([]),
  totalDuration: z.number(),
});
```

白话翻译：

上面是蓝图，下面是时间执行表。

区别非常重要：

- `Blueprint` 说的是“内容结构”
- `TimingMap` 说的是“最终怎么在时间轴上播放”

`TimingSegment` 更像 atom 级的对照表：

- 原来它在原视频哪段时间
- 到了成片里变成哪段时间

`TimingClip` 更像真实会去播放的一整段素材片段。

真实例子：

原视频里：

- 10 秒到 14 秒说了第一段
- 20 秒到 24 秒说了第二段

最后成片可能会连续播放成：

- 成片 0 秒到 4 秒播放原视频 10 到 14 秒
- 成片 4 秒到 8 秒播放原视频 20 到 24 秒

这就是 `TimingMap` 在负责记录的事。

## 第十一段：辅助遍历函数

```ts
export function allAtoms(bp: Blueprint): BlueprintAtom[] {
  const result: BlueprintAtom[] = [];
  for (const scene of bp.scenes) {
    for (const seg of scene.logic_segments) {
      result.push(...seg.atoms);
    }
  }
  return result;
}
```

白话翻译：

这不是在改数据，只是在“把三层结构摊平”。

本来 atom 藏在：

- 场景里
- 逻辑段里

这个函数把它们全部拉成一条列表，方便后面统一处理。

类似的还有：

```ts
export function keepAtoms(bp: Blueprint): KeepAtom[] {
  return allAtoms(bp).filter((a): a is KeepAtom => a.status === "keep");
}

export function discardAtoms(bp: Blueprint): DiscardAtom[] {
  return allAtoms(bp).filter((a): a is DiscardAtom => a.status === "discard");
}
```

白话翻译：

- `keepAtoms`：把所有保留句子挑出来
- `discardAtoms`：把所有淘汰句子挑出来

真实例子：

后面如果要统计“这次视频一共保留了多少 atom”，就没必要一层层手动钻进去翻，直接用这些辅助函数。

## 第十二段：Remotion 渲染层类型

```ts
export interface RenderScene {
  id: string;
  topic_id: string;
  variant_id: VariantId;
  title?: string;
  timeline: SceneTimeline;
  items: RenderItem[];
  template_props?: TemplateProps;
  transition_type?: TransitionType;
}
```

白话翻译：

这部分已经不是给分析链用了，而是给渲染层准备的。

也就是说：

- 上面那些 `BlueprintScene` / `LogicSegment`
- 最后还要转换成 Remotion 更爱吃的 `RenderScene`

机器名词翻译：

- `interface`：可以理解成“这类对象的说明书”。
- `props`：组件的输入参数。

真实例子：

一个逻辑段本来是“医生提醒不要只看一次血压值”，  
到渲染层里，它会变成一个 `RenderScene`，里面带着：

- 标题
- 条目
- 模板名
- 时间线
- 转场方式

然后模板组件才知道怎么画出来。

## 这个文件在整条链路里的作用

一句话概括：

`blueprint.ts` 不负责“做决定”，它负责“规定所有决定最后长什么样”。  
没有这份文件，分析、对齐、时间规划、渲染就会各说各话。
