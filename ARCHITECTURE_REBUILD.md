# 项目重构后的正式架构说明

## 1. 文档目的

这份文档用于重新定义当前项目的正式架构边界，解决过去一段时间里反复出现的几个问题：

1. 文本清洗、语义切割、音频切块、渲染执行混在一条链里，彼此互相干扰。
2. 字幕看起来是对的，但最终声音仍然是错的。
3. 为了修一种问题，经常会把另一种问题改坏。
4. 同一个字段或同一个中间产物，被多条通道同时赋予不同职责。

本次重构的最高原则只有一句：

**一件事一条通道，通道之间只传明确产物，不共享模糊职责。**

**状态说明**

- `已实现`：已经落到代码主链，当前可直接使用
- `部分实现`：方向已落地，但仍有实验态、兼容态或边界未收紧
- `未实现`：目前主要停留在架构定义，尚未进入稳定实现


## 2. 项目本质定义

这个项目不是单一的“自动剪视频工具”。

它是一个从原始视频中抽取可播放语义内容的系统，包含 4 条主通道：

1. 文本清洗通道
2. 语义结构通道
3. 音频选块通道
4. 渲染执行通道

四条通道按顺序串联，但职责必须严格分开。

同时，这个项目不只有“引擎内核”，还包含完整的工作系统。

因此本文件正式拆成两层理解：

1. **引擎内核层**
   - 关注 transcript、semantic atoms、audio spans、timing_map、render
   - 解决“系统怎么自动处理”
2. **工作系统层**
   - 关注编辑器、模板、素材、偏好学习、人工接力
   - 解决“系统怎么被剪辑师稳定使用”

前 10 节主要定义引擎内核层。
第 11 节开始补充工作系统层，使其与最初的系统蓝图对齐。


## 3. 四条正式通道

### 3.1 文本清洗通道 `[状态：部分实现]`

**目标**

把原始 ASR transcript 从“脏但有时间”，变成“干净且仍然强绑定时间”的 transcript。

**输入**

- 原始 `transcript.json`
- 参考文案 `docx`

**输出**

- `review_spans.json`
- `reviewed_transcript.json`

**必须保证**

1. 输出文本比原始 transcript 更干净
2. 每一段清洗后的文本都能追溯回原始 source words
3. 时间锚点来自原始 transcript，不允许全文重写后再全局猜时间
4. `review_spans` 是 review 通道的**唯一源事实**
5. `reviewed_transcript` 必须由 `review_spans + transcript.words` **确定性生成**

**这条通道负责**

1. 错字纠正
2. 术语纠正
3. 局部漏字补全
4. 保持 speaking order 不变
5. 保持 repetitions / restarts 仍然存在

**这条通道不负责**

1. 去重
2. 丢弃前几遍重说
3. 切 scene / logic / atom
4. 决定最终音频怎么切


### 3.2 语义结构通道 `[状态：部分实现]`

**目标**

把清洗后的 transcript 切成语义结构，供后续字幕、模板、画面替换和内容编排使用。

**输入**

- `reviewed_transcript.json`

**输出**

- `step1_result.json`
- `step1_cleaned.json`
- `blueprint.json`

**核心产物**

- `scene`
- `logic`
- `semantic atom`

**这条通道负责**

1. 切 `scene`
2. 切 `logic`
3. 切 `semantic atom`
4. 给后续画面/模板提供稳定的语义颗粒

**这条通道不负责**

1. 最终 discard 判定
2. 最终音频切块
3. 最终 occurrence 选择
4. 术语纠错

**重要说明**

`semantic atom` 是语义剪辑单元，不是最终音频切割单元。


### 3.3 音频选块通道 `[状态：部分实现]`

**目标**

从原始视频中选择最终可播放的音频块，保证：

1. 不漏内容
2. 不切断自然语流
3. 长静音能被剪掉
4. 局部重复允许保留给人工删

**输入**

- `semantic atoms`
- `reviewed_transcript`
- 原始 source 时间锚点

**输出**

- `take_pass_result.json`
- `step1_taken.json`
- 后续可演进为显式的 `audio_spans.json`

**正式映射约束**

1. 一个 `audio span` 必须对应**连续**的 semantic atom 区间。
2. 一个 kept semantic atom 在同一版本中**必须且只能属于一个** `audio span`。
3. 允许：
   - `1:1`：一个 atom 对应一个 audio span
   - `N:1`：多个相邻 atoms 合成一个 audio span
4. 暂不允许：
   - `1:N`：一个 atom 被拆成多个 audio spans
   - 非连续 atoms 拼成同一个 audio span
5. `audio span` 默认不得跨 `scene` 边界。
6. `audio span` 在当前架构版本中也**不得跨 `logic` 边界**。

**说明**

第 6 条是当前版本的刻意保守约束。

原因不是逻辑上永远不能跨 `logic`，而是当前系统还没有显式的 `hard/soft logic boundary` 定义。
在这个定义补齐之前，允许跨 `logic` 会把最容易混线的地方重新打开。
如果未来确实需要跨 `logic` 保证语流完整，必须先新增明确的数据字段，再放开该约束。

**这条通道负责**

1. 决定哪些语义块最终保留
2. 决定哪些相邻语义块需要合并成可播音频块
3. 决定哪里可以切，哪里不能切

**这条通道不负责**

1. 改文本
2. 改语义结构
3. 改字幕文案

**重要说明**

这条通道当前仍在实验阶段。现在的实现是 `take-pass LLM`，但从正式架构上看，它的职责已经明确：

**它只负责音频可播块选择，不负责文本清洗，也不负责语义切割。**


### 3.4 渲染执行通道 `[状态：已实现]`

**目标**

把上游已经确定好的内容，忠实渲染成视频。

**输入**

- `blueprint.json`
- `timing_map.json`
- 原视频或 cut video

**输出**

- `result.mp4`

**这条通道负责**

1. 时间计划执行
2. 原视频片段播放
3. 字幕叠加
4. 模板渲染

**这条通道不负责**

1. 修文本
2. 修语义
3. 猜音频区间
4. 补救上游错误

#### 3.4.1 Execution layer split [??????]
??????????????????
1. enderer/*
   - ???????
   - ?? Remotion bundle?still render?final video render
2. compose/*
   - ???
   - ??? lueprint + timing_map ??? audio/segment/subtitle sequence plans
3. emotion/*
   - ???????
   - ?????????? Composition ??
???????
- src/renderer/bundle.ts
- src/renderer/still.ts
- src/renderer/final-video.ts
- src/renderer/index.ts
- src/renderer/render.ts??????
- src/compose/pipeline-plan.ts
- src/compose/AudioTrack.tsx
- src/compose/SegmentSequence.tsx
- src/compose/AutoPipeline.tsx
#### 3.4.2 Orchestration boundary [??????]
AutoPipeline ????????? orchestrator?
1. ????????????????
2. ??????
   - audio track plans
   - render segment plans
3. ??????????????????????
?????????????????????
## 4. 正式数据契约

### 4.1 `transcript.words` `[状态：已实现]`

这是唯一的原始时间真值源。

它可能脏，但它的 `start/end` 仍然是后续所有强映射的基础。


### 4.2 `review_spans` `[状态：部分实现]`

这是 review 通道的正式输出单位。

**它是 review 通道的源事实（source of truth）。**

每个 span 必须包含：

1. 原始 source word 范围
2. 原始 source time 范围
3. 原始脏文本
4. 清洗后的文本

这意味着 review 不再是“输出一篇新文章”，而是“对 source spans 做清洗”。

如果 `review_spans` 与任何下游文件不一致，以 `review_spans` 为准。


### 4.3 `reviewed_transcript.words` `[状态：部分实现]`

这是后续 Step1 的正式输入。

**它不是 review 通道的源事实，而是由 `review_spans` 编译出的运行产物。**

要求：

1. 文本更干净
2. 仍然有 `source_word_indices`
3. 仍然有 `source_start/source_end`
4. synthetic 只能局部产生，不能全局漂移

**正式主从关系**

1. `review_spans`：源事实、审计产物、可人工检查
2. `reviewed_transcript`：编译产物、运行时输入、供 Step1 直接消费

如果二者不一致：

1. 先视为 bug
2. 回到 `review_spans + transcript.words` 重新生成 `reviewed_transcript`
3. 不允许人工直接修改 `reviewed_transcript` 来绕过 `review_spans`


### 4.4 `semantic atom` `[状态：部分实现]`

这是语义最小剪辑单元。

它的职责是：

1. 表达语义结构
2. 支撑画面替换
3. 支撑字幕组织

它不是最终音频切割单元。


### 4.5 `take` / `audio span` `[状态：部分实现]`

这是最终音频播放单元。

它的职责是：

1. 组合多个相邻 semantic atoms
2. 保证音频自然完整
3. 尽量保住完整表达
4. 允许局部重复，但不能整段乱切

**额外约束**

1. `audio span` 的主键应该能够反查到其覆盖的 atom id 区间
2. `planner` 以后只能消费 `audio span`，不能直接跨回 `semantic atom` 自己猜切点
3. semantic atoms 仍然用于字幕、模板、画面替换；audio spans 只用于最终声音保留


### 4.6 `timing_map.clips` `[状态：已实现]`

这是最终 render 执行层要读的时间计划。

`planner` 只能把上游已经确定好的音频块变成 render clips，不能自己猜语义和音频边界。

### 4.7 ender sequence plans [??????]
???????????????????????????
?????
1. source-direct audio sequence plans
2. render segment sequence plans
3. subtitle sequence plans
?? plans ? src/compose/pipeline-plan.ts ??????
- lueprint
- 	iming_map
??????
?????
1. ???
2. ?????????
3. ???? Remotion ?????
## 5. 当前代码与正式架构的对应关系

### 5.1 已经基本对齐的部分

1. `Step1` 已经从 discard 主职责中拿出来
2. `take-pass` 已经成为独立的第二个 LLM
3. `review` 已开始从全文纠错转向 source-anchored spans
5. ??????? enderer / compose / remotion
6. AutoPipeline ?????????????? orchestrator

### 5.2 还没有完全对齐的部分

1. `take-pass` 现在仍然是实验态，没有稳定到可以完全承担音频通道
2. `planner` 仍然带有一部分历史兼容逻辑
3. `post-process` 和 `media_range` 仍然夹在字幕与音频之间，边界还不够硬
4. 编辑器仍然更多围绕 `atom.time` 和 `atom.words` 工作，对音频通道的显式可视化还不够

5. compose -> remotion ?????????????????????????
6. ??? still / final render ????????????????????????
## 6. 正式禁止的混线行为

以后不允许再出现以下混线：

### 6.1 review 通道

不允许：

1. 顺手去重
2. 顺手决定 discard
3. 顺手切 logic / atom


### 6.2 Step1 通道

不允许：

1. 顺手做最终 discard
2. 顺手做最终音频切块
3. 顺手纠术语


### 6.3 take / audio-cut 通道

不允许：

1. 顺手改写文本
2. 顺手重建语义结构
3. 顺手修字幕文案


### 6.4 render 通道

不允许：

1. 顺手猜新的边界
?????
4. enderer ??????????/????
5. compose ?????? plan ????? 	iming_map
6. emotion ??????????????????2. 顺手补救上游错误
3. 顺手改文本


## 7. 当前最重要的判断标准

过去我们很容易被中间产物误导。现在正式规定：

### 文本通道判卷标准

看：

- `review_spans.json`
- `reviewed_transcript.json`

判断：

1. 文本是否更干净
2. 是否仍然强绑定 source
3. `reviewed_transcript` 是否能被 `review_spans` 确定性重建


### 语义通道判卷标准

看：

- `step1_result.json`
- `step1_cleaned.json`
- `blueprint.json`

判断：

1. atom 是否切得稳定
2. scene / logic 是否合理


### 音频通道判卷标准

看：

- `take_pass_result.json`
- `step1_taken.json`
- `result_transcript.json`

判断：

1. 最终视频里实际播出来的声音是什么
2. 是否接近目标文本
3. 是否存在明显漏字、乱切、长空白


### 渲染通道判卷标准

看：

- `result.mp4`
- `timing_map.json`

判断：

1. 是否忠实执行了时间计划
2. 是否没有新增执行层问题


## 8. 项目的正式重构方向

从这一刻起，后续重构应始终遵循以下顺序：

1. 先稳住文本清洗通道
2. 再稳住语义结构通道
3. 再稳住音频选块通道
4. 最后才优化 render 和 editor 体验

不能反过来。

原因很简单：

**如果文本还不干净、source 还不强绑定，后面的所有 take / clip / render 优化都会反复打转。**


## 9. 当前阶段的正式结论

### 已确认

1. 原视频音频本身不是根因
2. 问题不在单纯字幕
3. `Step1` 不能继续承担 discard 主责
4. review 必须输出“干净且强绑定时间”的 transcript
5. 音频通道必须独立于语义通道


### 当前主战场

1. review 的强 source 映射
2. take-pass / audio-cut 的稳定性


### 当前不应继续混做的事

1. 不要再让 atom 直接承担音频切割职责
2. 不要再让 review 顺手去重
3. 不要再让 render 顺手补救上游


## 10. 一句话版本

这次重构的正式定义是：

**用四条独立通道替代过去混在一起的一条链。**

其中：

1. review 负责把 transcript 变成“干净且强绑定时间”
2. Step1 负责纯语义切块
3. take / audio-cut 负责最终音频保留
4. render 负责忠实执行

后续所有代码改动，都必须说明自己属于哪一条通道，且不能越权进入其他通道职责。


## 11. 工作系统层补充

本节补充最初系统蓝图中已经明确、但前 10 节尚未完整展开的部分。

这些内容不是“可选附录”，而是正式工作系统的一部分。

### 11.1 系统边界 `[状态：部分实现]`

本系统的正式边界是：

1. 输入：医生录制的原始 MP4
2. 系统内部：完成 transcript 清洗、三级语义结构、音频选块、模板编排、overlay 渲染
3. 输出：**信息图形 overlay 层视频**

本系统当前**不负责**：

1. 医生人物抠像
2. 最终人物与 overlay 的总合成
3. 调色、转场、背景音乐、封面
4. 剪映内的最终人工润色

这些步骤属于剪辑师在外部工具中的工作，不属于本系统的渲染通道职责。


### 11.2 编辑器子系统 `[状态：部分实现]`

编辑器不是附属工具，而是正式工作系统中的**人工确认与微调通道**。

它的职责是：

1. 展示三层语义结构
   - `scene`
   - `logic`
?????
1. still ?????????? src/renderer/still.ts ??
2. ??? server ??????? enderer ???????? Remotion ????
3. ???????????????/????????????????????   - `semantic atom`
2. 展示当前自动选择的模板与素材
3. 允许剪辑师替换素材、改模板、改文案
4. 展示 AI 判为 discard 的内容，并允许恢复
5. 提供 renderStill/静态预览或等价能力
6. 记录 `blueprint_initial` 与 `blueprint_final`

编辑器**不负责**：

1. 重新做 transcript 清洗
2. 重新切 semantic atom
3. 重新决定 audio span

也就是说，编辑器的正式定位是：

**在 AI 产物之上做确认与微调，而不是取代引擎内核。**


### 11.3 模板子系统 `[状态：部分实现]`

模板子系统是工作系统层中的正式一层，而不是 `logic segment` 的附带属性。

它的职责是：

1. 为每个 `logic segment` 选择一个模板
2. 定义模板内部需要哪些 item/node
3. 规定 `semantic atom` 如何映射到模板内部元素

正式映射关系应为：

1. `scene`
   - 决定大的视觉语境
   - 如背景、overlay/graphics 模式、整体情绪
2. `logic segment`
   - 决定模板类型
3. `semantic atom`
   - 决定模板内部的最小内容项
   - 如文字块、emoji、图标、视频素材位

模板子系统不应该反向修改：

1. review 输出
2. semantic atoms 切分
3. audio spans


### 11.4 素材子系统 `[状态：未实现]`

素材子系统需要在正式架构中单独存在。

它的职责是：

1. 管理视频/图片/emoji 等素材
2. 区分 preview 与 final 版本
3. 维护素材索引与检索入口
4. 服务编辑器选择与渲染执行

正式要求：

1. 素材应支持 preview/full 双版本
2. 引擎内核与编辑器都不应直接依赖“裸文件夹遍历”
3. 应存在稳定的素材索引层
   - 如 `asset_index.json` 或等价结构

素材子系统只负责“提供和定位素材”，不负责决定：

1. 这段话语义是什么
2. 这段音频怎么切
3. 文本该怎么改


### 11.5 偏好学习子系统 `[状态：未实现]`

原始蓝图中的 `preferences.json` 与“高频词素材硬替换”，在正式架构中应被视为一个独立子系统。

它的职责是：

1. 累积编辑器中的人工替换偏好
2. 将高频稳定偏好回灌到自动流程中
3. 降低后续编辑成本

正式原则：

1. 偏好学习是**确定性覆盖层**
2. 它发生在语义结构之后、最终编辑之前
3. 它只影响模板/素材选择，不影响：
   - review 文本
   - semantic atoms
   - audio spans

也就是说，偏好学习子系统不能越权进入内核通道。


### 11.6 人工接力与交付边界 `[状态：部分实现]`

完整工作系统必须承认：

1. AI 不负责所有最终制作动作
2. 剪辑师是正式流程中的下游角色
3. 本系统必须把交付边界写清楚

正式 handoff 应为：

1. 系统产出：
   - `blueprint_final`
   - `timing_map`
   - overlay 成片
   - 必要的素材引用关系
2. 剪辑师接力：
   - 人物层叠加
   - 最终包装
   - 个性化调整

这意味着“端到端”在本项目中的正式定义是：

**从原始医生 MP4 到可交给剪辑师直接进入最终合成的 overlay 成果。**

而不是“系统独立输出平台终稿”。


### 11.7 与最初蓝图的关系 `[状态：部分实现]`

最初的系统蓝图里包含两部分：

1. AI 引擎内核
2. 剪辑工作系统

本文件前 10 节主要解决第 1 部分的混线问题；
本节开始正式把第 2 部分纳入架构定义。

因此，从现在起判断“架构是否完整”，必须同时检查：

1. 内核通道是否分离
2. 编辑器/模板/素材/偏好/人工 handoff 是否被正式定义

缺任何一边，都不能算完整架构。
