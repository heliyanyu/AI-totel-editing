# 多视频语义验收清单

更新日期：2026-03-14

## 目的

这份清单用于当前项目的“语义链路验收”，不是最终成片验收。

当前阶段的目标是先把这条链跑稳：

`MP4 -> transcript -> Step1 hints/拆分 -> Step2 结构编排 -> blueprint`

当前阶段暂时不把下面这些作为主目标：

- 素材库
- preferences 飞轮
- 最终画面美术质量
- 成片级体验优化

原则：

- 先逐步验收，不先跑端到端
- 某一步不通过，就停在该步修，不继续往后推进
- 重点看“有没有丢语义、串语义、误删语义”

---

## 适用范围

适用于当前仓库这条真实工作流：

1. `src/transcribe/index.py`
2. `src/analyze/step1-hints.ts`
3. `src/analyze/index.ts`
4. `src/align/post-process.ts`
5. `src/analyze/prompt-3level.ts` 中的 merge
6. `editor/` 中的中间确认

不建议当前阶段用“最终 `result.mp4` 好不好看”来反推语义是否正确。

---

## 样本选择

建议第一轮至少测 `8` 条视频。

### 样本结构

1. `2` 条干净样本
   - 基本按稿说
   - 收音好
   - 改口少

2. `2` 条轻微偏稿样本
   - 医生会口语化改写
   - 但不大改结构

3. `2` 条改口/重复较多样本
   - 有明显的“不是，准确说”
   - 有重复起头、重复结尾

4. `1` 条快语速/信息密度高样本
   - 看 Step1 是否拆太碎或合太大

5. `1` 条收音一般/噪声较多样本
   - 看转录和清洗的脆弱点

### 每条样本记录这些元信息

- `video_id`
- 视频路径
- 文案路径
- 时长
- 医生说稿风格：按稿 / 轻微偏稿 / 改口多 / 噪声大 / 语速快

---

## 推荐工作目录

每条视频单独建一个工作目录，不混用产物。

```text
output/qa/<video_id>/
  transcript.json
  step1_hints.json
  step1_result.json
  step1_cleaned.json
  step2_result.json
  blueprint_merged.json
  blueprint.json
  timing_map.json
  cut_video.mp4
  result.mp4
```

当前阶段建议优先检查到 `blueprint.json` 为止。

---

## 推荐执行方式

不要先跑整条 pipeline。

建议按下面顺序分步执行。

### 1. 只跑转录

```powershell
python src/transcribe/index.py "<video>.mp4" -o "output/qa/<video_id>/transcript.json"
```

### 2. 只跑语义分析

```powershell
npx tsx src/analyze/index.ts --transcript "output/qa/<video_id>/transcript.json" --script "<video>.docx" -o "output/qa/<video_id>/blueprint.json"
```

说明：

- 这一步会同时生成 `step1_hints.json`
- 也会生成 `step1_result.json / step1_cleaned.json / step2_result.json / blueprint_merged.json`

### 3. 只有语义通过后，再跑切割

```powershell
npx tsx src/cut/index.ts --input "<video>.mp4" --blueprint "output/qa/<video_id>/blueprint.json" -o "output/qa/<video_id>"
```

### 4. 只有切割通过后，再开编辑器

```powershell
npx tsx editor/server.ts "F:\AI total editing\output\qa\<video_id>"
```

---

## 分步验收标准

下面是当前阶段最核心的部分。

---

## Step 1：转录验收

### 输入

- 原始 `MP4`

### 输出

- `transcript.json`

### 重点检查

1. `correctionCandidates` 是否只落在局部术语/漏字纠错上
2. `repairCues` 是否主要命中明确改口线索
3. `ambiguousSpans` 是否主要覆盖容易误删、短残句、改口附近
4. 有没有把大段完整实义句误标成需要谨慎处理的“歧义片段”
5. 没有把整份文案原文重新塞回 Step1 提示

### 通过标准

- 局部提示数量不离谱
- repair cue 主要落在口误/重说附近
- correction candidate 主要是局部术语修正，不是全文改写

### 不通过的典型现象

- correction candidate 开始大面积把文案原句回写到口播
- repair cue 指向完整实义句
- ambiguous span 覆盖范围过大，几乎整段都被标红

### 不通过时怎么处理

- 记录为 `H-1 Step1 提示问题`
- 不继续判断 Step1 的 discard 是否正确
- 优先修局部纠错候选、repair cue 规则和歧义片段规则

---

## Step 3：Step1 原始语义拆解验收

### 输入

- `transcript.json`
- `step1_hints.json`

### 输出

- `step1_result.json`

### 重点检查

1. atoms 是否覆盖了主要口播内容
2. atom 粒度是否基本合理
3. `discard` 是否只在废料上
4. `scene` / `logic` boundary 是否自然
5. 是否出现以下错误：
   - 一段完整内容被整体打成 discard
   - 同一句拆成很多无意义碎片
   - 几个本该分开的逻辑块粘在一起

### 通过标准

- keep + discard 合起来能基本还原原始口播
- discard 主要是口误、重复、修正中间态
- scene / logic 边界大体说得通

### 不通过的典型现象

- 实义句被大段标 discard
- 明显重复句保留了两遍
- 从“现象 -> 解释 -> 结论”完全没切开
- 边界太多或太少

### 不通过时怎么处理

- 记录为 `S1-1 原始拆解问题`
- 不继续看 Step2
- 优先修 Step1 prompt 或前置清洗上下文

---

## Step 4：Step1 清洗后验收

### 输入

- `step1_result.json`

### 输出

- `step1_cleaned.json`

### 重点检查

1. 重复改口是否被收敛
2. 误删内容是否被恢复
3. keep 串起来是否仍然通顺
4. 和原始 `step1_result` 相比，是不是“更干净但没丢义”

### 通过标准

- 保留下来的 keep 主线通顺
- 重复/中间态减少
- 没有新增大段语义缺失

### 不通过的典型现象

- “去重”把正文删掉
- “恢复误删”又把真正废料救回来
- keep 文本断裂，像被硬掐掉一截

### 不通过时怎么处理

- 记录为 `S1-2 规则清洗问题`
- 不进入 Step2
- 优先修 `applyStep1SemanticCleanup` / `recoverFalseDiscardedAtoms`

---

## Step 5：Step2 结构编排验收

### 输入

- `step1_cleaned.json`

### 输出

- `step2_result.json`

### 重点检查

1. 场景数是否和 Step1 分组一致
2. 每个场景内 logic segment 数是否一致
3. 模板选择是否基本合理
4. `items` 是否只来自当前 logic block
5. 有没有出现“把后面段落内容写进前面段落”

### 通过标准

- 数量严格对齐
- 不跨块挪内容
- `transition_type` 和 `items` 大体符合当前块

### 不通过的典型现象

- 少返回 scene 或 logic segment
- 把两个 logic block 合成一个
- 当前块还没讲到“血栓脱落”，items 已经出现“肺栓塞”

### 不通过时怎么处理

- 记录为 `S2-1 结构编排问题`
- 不进入 cut
- 优先修 Step2 prompt 和 merge 保护逻辑

---

## Step 6：合并后 blueprint 验收

### 输入

- `step1_cleaned.json`
- `step2_result.json`

### 输出

- `blueprint_merged.json`
- `blueprint.json`

### 重点检查

1. Step1 的 atom 是否全部还在
2. 有没有 atom 在 merge 时丢失
3. 每个 segment 挂载的 atoms 是否和 Step1 分组一致
4. discard atoms 是否仍然跟在正确上下文里
5. keep atoms 是否都补上了 `words`

### 通过标准

- 没有丢 atom
- 没有跨 scene / 跨 logic block 乱挂
- `blueprint.json` 和 Step1/Step2 语义范围一致

### 不通过的典型现象

- Scene2 原来有 5 个 logic block，merge 后只剩 2 个
- 后面逻辑块的 atom 根本没进 blueprint
- discard 被丢到错误 segment

### 不通过时怎么处理

- 记录为 `M-1 merge 问题`
- 不进入 cut
- 优先修 merge，而不是继续修模板或编辑器

---

## Step 7：切割验收

说明：这一步不是语义主验收，只在前面通过后才检查。

### 输入

- `blueprint.json`
- 原始 `MP4`

### 输出

- `timing_map.json`
- `cut_video.mp4`

### 重点检查

1. `timing_map` 是否覆盖所有 keep atom
2. `cut_video` 是否漏切 keep 内容
3. 音频前后是否被切坏
4. 相邻 keep 段拼接是否自然

### 通过标准

- 没有 keep 内容消失
- 没有明显的剪切断裂
- `cut_video` 能作为编辑器人工确认底稿

### 不通过的典型现象

- 保留文案里有，`cut_video` 里没声音
- 句首/句尾被切掉
- 大停顿处理后句子接得很怪

### 不通过时怎么处理

- 记录为 `CUT-1 切割问题`
- 不用回头怀疑 Step1/Step2，先看 cut buffer 和 timing_map

---

## Step 8：编辑器验收

说明：这一步是“人工确认入口验收”，不是“画面美术验收”。

### 输入

- `blueprint.json`
- `timing_map.json`
- `transcript.json`
- `cut_video.mp4`

### 重点检查

1. 编辑器里看到的 segment 是否完整
2. 文本上下文 / cut video / still 是否互相对应
3. discard 是否能恢复
4. 修改是否能保存回 blueprint
5. still 预览是否真的响应当前编辑状态

### 通过标准

- 人工能看懂问题出在哪一层
- 人工能完成最小修正
- 保存后内容不丢

### 不通过的典型现象

- blueprint 明明有 atom，编辑器不显示
- 改了 items 但 still 不更新
- discard 恢复后时间线或上下文不一致

### 不通过时怎么处理

- 记录为 `ED-1 编辑器问题`
- 不把它误归因到语义模型

---

## 问题分级

### P0：当前视频不可继续

- 大段实义内容丢失
- logic block 串段
- merge 丢 atom
- 编辑器看不到真实问题

### P1：需要人工较大修正

- 重复改口没清干净
- discard 误删但能恢复
- 模板/transition_type 明显不合理

### P2：可接受但需要记账

- items 表达一般
- 边界略粗或略碎
- 个别术语需要人工微调

---

## 单视频验收记录模板

每条视频建议填一份。

```md
# Video <video_id>

- 视频路径：
- 文案路径：
- 时长：
- 样本类型：按稿 / 轻微偏稿 / 改口多 / 噪声大 / 快语速

## Step 1 转录
- 结果：通过 / 不通过
- 主要问题：

## Step 2 清洗上下文
- 结果：通过 / 不通过
- 主要问题：

## Step 3 Step1 原始拆解
- 结果：通过 / 不通过
- 主要问题：

## Step 4 Step1 清洗后
- 结果：通过 / 不通过
- 主要问题：

## Step 5 Step2 结构编排
- 结果：通过 / 不通过
- 主要问题：

## Step 6 blueprint 合并
- 结果：通过 / 不通过
- 主要问题：

## Step 7 切割
- 结果：通过 / 不通过 / 未检查
- 主要问题：

## Step 8 编辑器
- 结果：通过 / 不通过 / 未检查
- 主要问题：

## Bug 列表
- [P0]
- [P1]
- [P2]

## 是否允许进入下一步
- 允许 / 不允许
```

---

## 多视频汇总表

建议至少汇总到这个粒度：

```md
| video_id | 类型 | 转录 | 清洗上下文 | Step1 | Step1清洗后 | Step2 | merge | cut | editor | 是否可继续 |
|----------|------|------|------------|-------|-------------|-------|-------|-----|--------|------------|
| V01 | 干净按稿 | 过 | 过 | 过 | 过 | 过 | 过 | 过 | 过 | 是 |
| V02 | 改口多 | 过 | 过 | 不过 | - | - | - | - | - | 否 |
```

---

## 当前阶段的放行标准

在你决定“进入下一阶段”之前，我建议至少满足：

1. `8` 条视频都走完 Step1 到 Step6
2. `0` 个 P0 的 merge 丢块问题
3. `0` 个 P0 的跨 logic block 串段问题
4. 大多数视频的 Step1 清洗后 keep 串读通顺
5. 编辑器能把剩余问题暴露出来并完成人工兜底

只要这些还没满足，就不要把精力转到：

- 素材库
- preferences
- 上传系统
- atom 级素材替换

---

## 当前阶段最重要的判断标准

不是“最终视频好不好看”，而是下面这句：

**语义内容有没有被完整、正确、可编辑地传到 blueprint。**

只要这句还不能稳定成立，后面的功能都会放大 bug。


