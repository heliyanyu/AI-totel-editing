# VU 端到端工作总结

日期：2026-05-09  
项目目录：`F:\AI total editing\editing V1`

## 1. 总结范围

这份文档只总结我这一轮做过的工作，尤其是目前代码里的“最终工作流”是怎么跑的。

结论先写清楚：

- 手工 demo 路线验证过，效果明显更好。
- 当前端到端版本已经能跑通，但最终画面质量不好，和 demo 不是一个水平。
- 当前问题不是“Remotion 做不了”，而是“端到端数据驱动渲染层没有真正复刻 demo 的动画设计能力”。

## 2. 我完成过的主要工作

### 2.1 手工 demo 阶段

核心文件：

- `src/remotion/demos/SVU05Motion.tsx`
- `src/remotion/demos/motion-primitives.tsx`

当时做出的 SVU05 demo 使用了以下动画原语：

- `MagicMove`：元素跨 beat 持续移动，比如鱼油从大图移动到结构位置。
- `StackReveal`：列表逐项出现。
- `PopIn`：数字、标签弹出。
- `CountUp`：`+10%` 数字滚动。
- `PathDraw`：心电图路径绘制。

这个 demo 后续修过：

- 主播从右侧移到左下，避开短视频右侧互动栏。
- 底部留真实字幕位置。
- 去掉无用占位框。
- 去掉右侧平台 UI 占位图形。
- 修复鱼油抖动问题。
- 修复问题板缩小时一顿一顿的问题。

这个阶段的特点是：坐标、节奏、素材角色、折叠关系都是手工设计的，所以动效质量高。

### 2.2 多 family demo 阶段

我后来扩展了一批 Remotion demo 组件，用来探索不同 VU 类型：

- `SVU01PlanDemo.tsx`
- `SVU03PlanDemo.tsx`
- `SVU05PlanDemo.tsx`
- `SVU07PlanDemo.tsx`
- `SVU08PlanDemo.tsx`
- `SVU14PlanDemo.tsx`
- 以及后续一批 `SVU02` 到 `SVU20` 的实验组件

共享组件：

- `src/remotion/demos/plan-shared.tsx`

这些 demo 主要沉淀了：

- 平台安全区意识。
- 顶部进度条位置。
- 底部字幕位置。
- 左结构、右素材的阅读习惯。
- 主播类 VU 不需要复杂 overlay。
- 需要讲解的 VU 才进入 DeepSeek 画面规划。

但这一批里面有些组件已经偏向“PPT 页”，没有完全继承最早 SVU05 demo 的运镜质量。

### 2.3 端到端工作流改造

核心入口：

- `run-batch.ps1`

目标是：以后跑 `run-batch.ps1` 可以从原视频到剪映草稿完整跑通。

我在这个入口里接入了新的 VU 工作流：

- Qwen ASR 检测和调用。
- DeepSeek VU 切分。
- 进度条 / 导航标签生成。
- DeepSeek VU 画面规划。
- Remotion 渲染每个 VU overlay。
- 生成剪映草稿，把新 VU overlay 替代旧 overlay。

## 3. 当前最终工作流

当前 `run-batch.ps1` 的主流程大致如下。

### 3.1 加载环境

脚本会读取 `.env`。

会查找 Qwen ASR Python：

- 优先使用环境变量 `ASR_PYTHON_PATH`
- 否则尝试 `C:\Python310\python.exe`
- 检查方式是测试能否导入 `qwen_asr`

### 3.2 ASR 和文本对齐

当前预期链路是：

1. Qwen ASR + hotwords
2. Claude review
3. Qwen ForcedAlign
4. 后续进入分析和 VU 切分

在代码上，我没有重写 `analyze` 内部逻辑，而是通过 `run-batch.ps1` 调用现有分析入口：

```powershell
npm run analyze -- --audio <input-video> -o blueprint.json ...
```

如果 Qwen 可用，会传入：

```text
--transcribe-qwen
--transcribe-python <QwenPython>
--force-align-qwen
--force-align-python <QwenPython>
```

如果存在 docx 脚本，也会传入：

```text
--script <docx>
```

默认会跳过旧 Step2：

```text
--skip-step2
```

除非显式传：

```powershell
-UseLegacyStep2
```

### 3.3 生成 timing map

调用：

```powershell
npm run timing:direct -- --input <video> -b blueprint.json -o timing_map.json
```

输出：

- `timing_map.json`

### 3.4 旧基础 overlay 渲染

仍然调用旧渲染入口：

```powershell
npm run render -- -b blueprint.json -t timing_map.json --source-video <video> -o overlay.mp4
```

这一步保留旧管线里的基础产物。

### 3.5 字幕导出

调用：

```powershell
npx tsx src/renderer/export-srt.ts -b blueprint.json -t timing_map.json -o subtitles.srt
```

输出：

- `subtitles.srt`

### 3.6 新 VU 切分

默认调用 DeepSeek VU cutter：

```powershell
npm run vu:cut -- `
  -b blueprint.json `
  -t timing_map.json `
  -o visual_units.auto.json `
  --labels-output progress_nav_labels.json `
  --report vu_cut_report.json `
  --source <caseDir> `
  --model deepseek-v4-pro
```

核心文件：

- `src/vu/cut-with-deepseek.ts`
- `src/vu/prompts/visual-unit-cutter.ts`
- `docs/visual-unit-cutter-prompt-v1.md`

输出：

- `visual_units.auto.json`
- `progress_nav_labels.json`
- `vu_cut_report.json`

说明：

- VU 切分现在使用 `docs/visual-unit-cutter-prompt-v1.md` 里的已验证提示词。
- 默认模型是 `deepseek-v4-pro`。
- 这里同时会生成进度条和导航需要的压缩标签。

### 3.7 进度条渲染

调用：

```powershell
python scripts/render_progress_bar.py <out-dir> -o overlay_progress_bar_full.mp4
```

然后裁剪成：

- `overlay_progress_bar.mp4`

核心文件：

- `scripts/render_progress_bar.py`

当前逻辑：

- 优先读取 `progress_nav_labels.json`
- 一级：scene 级斑块
- 二级：logic block 提炼标签
- 保留随时间流动变色的形式

当前曾出现的问题：

- 文字过密。
- 场景多时显示成“口口口”的错误效果。
- 这说明进度条显示层还没有完全稳住，需要继续修。

### 3.8 导航渲染

调用：

```powershell
python scripts/render_navigation.py <out-dir>
```

核心文件：

- `scripts/render_navigation.py`

当前逻辑：

- 同样读取 `progress_nav_labels.json`
- 不再依赖旧 Step2 的完整句子

### 3.9 构建 VU render jobs

调用：

```powershell
npm run vu:jobs -- --input visual_units.auto.json --output vu_render_jobs.json
```

核心文件：

- `src/vu/build-render-jobs.ts`
- `src/vu/router.ts`

输出：

- `vu_render_jobs.json`

router 当前做了几类分流：

- `skip_llm`：纯医生口播类，不生成复杂 overlay。
- `template_only`：标题、简单对比类，用模板。
- `deepseek_plan`：机制讲解、结构解释、因果链、证据图解等，调用 DeepSeek 做画面规划。

### 3.10 DeepSeek 画面规划

调用：

```powershell
npm run vu:plan -- `
  --input vu_render_jobs.json `
  --output vu_plans.deepseek.json `
  --model deepseek-v4-pro
```

核心文件：

- `src/vu/deepseek-plan.ts`
- `src/vu/prompts/family-planner-base.ts`
- `src/vu/prompts/families/index.ts`

输出：

- `vu_plans.deepseek.json`

当前状态：

- 已经能调用 DeepSeek。
- 已加入 schema 修复和字段归一化。
- 会保留 raw response。
- 对一些 DeepSeek 输出的同义词做了兼容，比如 `must_have`、`supporting`、`StackReveal` 等。

关键问题：

- family-specific prompt 目前还不够强。
- 它没有真正复刻最早 demo 的画面设计能力。
- 它输出了 `motion_script`，但渲染器没有完整执行这个 motion script。

### 3.11 Remotion 渲染 VU overlay

调用：

```powershell
npm run vu:render -- `
  --jobs vu_render_jobs.json `
  --plans vu_plans.deepseek.json `
  --output-dir vu_overlays
```

核心文件：

- `src/vu/render-overlays.ts`
- `src/remotion/demos/GenericVUClip.tsx`

输出目录：

- `vu_overlays`

当前状态：

- 可以按 VU 渲染出独立 overlay 视频。
- `skip_llm` 类型默认不渲染。
- 最终画面质量不好，主要问题集中在 `GenericVUClip.tsx`。

我后来对 `GenericVUClip.tsx` 做过补救：

- 增加医学矢量图形。
- 增加机制讲解区域。
- 增加主题素材区。
- 调整 closed loop board 的左右布局。
- 尝试让 kinetic title 增加更多图形元素。

但这些补救仍然没有达到 SVU05 手工 demo 的质量。

### 3.12 生成剪映草稿

调用：

```powershell
python scripts/generate-vu-overlay-jianying-draft.py `
  --case-out <out-dir> `
  --vu-file visual_units.auto.json `
  --vu-video-dir vu_overlays `
  --target <out-dir> `
  --draft-name <case-name>_draft
```

核心文件：

- `scripts/generate-vu-overlay-jianying-draft.py`

这个脚本的目标是：

- 保留真实原视频。
- 保留旧管线的进度条。
- 保留旧管线的导航。
- 保留字幕。
- 用新的 VU overlay 替代以前的 overlay 层。

我修过的问题：

- 支持 `VUxx` / `SVUxx` 文件名匹配。
- 跳过缺失的医生口播 VU overlay。
- 不再把医生口播类 VU 缺 overlay 当成错误。

## 4. 当前新增或重点修改的代码

### 4.1 npm scripts

`package.json` 里新增或使用了：

```json
{
  "vu:cut": "...",
  "vu:from-blueprint": "...",
  "vu:jobs": "...",
  "vu:plan": "...",
  "vu:render": "..."
}
```

### 4.2 VU 切分

- `src/vu/cut-with-deepseek.ts`
- `src/vu/prompts/visual-unit-cutter.ts`
- `docs/visual-unit-cutter-prompt-v1.md`

### 4.3 VU 路由

- `src/vu/router.ts`
- `src/vu/build-render-jobs.ts`

### 4.4 VU 画面规划

- `src/vu/deepseek-plan.ts`
- `src/vu/prompts/family-planner-base.ts`
- `src/vu/prompts/families/index.ts`

### 4.5 VU 渲染

- `src/vu/render-overlays.ts`
- `src/remotion/demos/GenericVUClip.tsx`

### 4.6 进度条和导航

- `scripts/render_progress_bar.py`
- `scripts/render_navigation.py`

### 4.7 剪映草稿

- `scripts/generate-vu-overlay-jianying-draft.py`

### 4.8 文档

- `docs/vu-family-demo-patterns.md`
- `docs/vu-e2e-todo.md`
- `docs/vu-e2e-work-summary-2026-05-09.md`

## 5. KP19 测试情况

测试素材：

```text
P:\团队空间\公司通用\AIkaifa\AI total editing\260430\guojie\wangli\KP19 得了肾病不能干的六件事
```

输出目录：

```text
P:\团队空间\公司通用\AIkaifa\AI total editing\260430\guojie\wangli\KP19 得了肾病不能干的六件事\out
```

这次端到端测试中，DeepSeek VU cutter 输出：

- 27 个 logic blocks
- 切成 7 个 VU
- coverage 没有漏块或重复块

输出文件包括：

- `blueprint.json`
- `timing_map.json`
- `visual_units.auto.json`
- `progress_nav_labels.json`
- `vu_cut_report.json`
- `vu_render_jobs.json`
- `vu_plans.deepseek.json`
- `vu_overlays`
- `subtitles.srt`
- 剪映草稿目录

生成过的草稿包括：

```text
out\KP19 得了肾病不能干的六件事_draft
out\KP19 得了肾病不能干的六件事_VU_v2_motion_fix
out\KP19 得了肾病不能干的六件事_VU_v3_motion_stage
```

也复制过到本机剪映草稿目录，例如：

```text
C:\Users\heliy\AppData\Local\JianyingPro\User Data\Projects\com.lveditor.draft\KP19_VU_v3_motion_stage
```

但用户反馈是：这个最终版仍然不可用，基本都是字，动效和 demo 完全不是一个档次。

## 6. 当前最终工作流的真实问题

### 6.1 Demo 和最终版不是同一种生产方式

SVU05 demo 是手工动画设计：

- 手工决定元素。
- 手工决定每个元素在哪一帧移动。
- 手工决定折叠。
- 手工决定左右空间分配。
- 手工使用 MagicMove / StackReveal / PopIn / CountUp / PathDraw。

当前最终版是数据驱动：

- DeepSeek 输出规划。
- `GenericVUClip` 根据规划粗略渲染。
- 大量视觉决策由通用 renderer 猜。

所以最终版更像“自动排版 PPT”，而不是“精心设计过的短视频运镜”。

### 6.2 DeepSeek planner 输出没有被充分执行

`vu_plans.deepseek.json` 里已经有 `motion_script` 之类的信息。

但 `GenericVUClip.tsx` 当前没有真正把这些 motion instructions 当成时间轴执行。

结果是：

- DeepSeek 可能规划了动效。
- renderer 最后只做了简单卡片、文字、淡入。
- 实际画面动效严重降级。

### 6.3 family prompt 还没有达到 demo 级别

我创建了 family planner prompt 结构，但目前它更像“让模型说明怎么排版”，而不是严格约束模型输出可执行的动画 DSL。

这导致：

- planner 输出不稳定。
- renderer 很难复现具体运镜。
- family 之间差异不够明显。

### 6.4 素材接口有雏形，但真实素材替换没有接通

`router.ts` 和 jobs 里已经有 asset slots 的思路。

比如：

- 鱼油可以换真实图片。
- 机制讲解可以接 RAG 素材。
- 肾病主题可以接真实医学图 / 图标 / 动画素材。

但当前真实素材检索和替换没有真正接进端到端流程。

所以最终版仍然大量使用：

- 文字
- emoji
- 简单矢量
- 通用图形占位

### 6.5 进度条和导航已经不依赖 Step2，但显示层还不稳

取消 Step2 后：

- 进度条和导航内容来自 `progress_nav_labels.json`
- 这个文件由 VU cutter / label generation 生成

逻辑上是对的。

但显示上出现过：

- 标签太密。
- 斑块太多。
- 文字显示成方框。
- 和预期“流动的两级进度条”不完全一致。

说明进度条 renderer 需要继续修，而不是 VU 切分本身的问题。

## 7. 当前 run-batch 的默认命令

理论上现在可以这样跑：

```powershell
powershell -ExecutionPolicy Bypass -File .\run-batch.ps1 `
  -RootPath "P:\团队空间\公司通用\AIkaifa\AI total editing\260430\guojie\wangli\KP19 得了肾病不能干的六件事" `
  -SkipDistribute
```

强制重跑：

```powershell
powershell -ExecutionPolicy Bypass -File .\run-batch.ps1 `
  -RootPath "P:\团队空间\公司通用\AIkaifa\AI total editing\260430\guojie\wangli\KP19 得了肾病不能干的六件事" `
  -Force `
  -SkipDistribute
```

如果要用旧 Step2：

```powershell
powershell -ExecutionPolicy Bypass -File .\run-batch.ps1 `
  -RootPath "<case-path>" `
  -UseLegacyStep2
```

默认模型：

- VU 切分：`deepseek-v4-pro`
- VU 画面规划：`deepseek-v4-pro`
- 标签生成：可走 `DEEPSEEK_LABEL_MODEL`，否则走默认配置

## 8. 我对当前状态的判断

当前端到端状态：

- 能跑通。
- 能生成剪映草稿。
- 能把新 VU overlay 放进草稿。
- 能保留原视频、字幕、进度条、导航。
- VU 切分逻辑基本成立。
- 医生口播类跳过 LLM 的方向成立。

但当前最终版不可用，原因集中在：

- `GenericVUClip` 不是 demo 级 renderer。
- planner prompt 没有真正沉淀成可执行动画设计。
- `motion_script` 没有被完整执行。
- 真实素材 / RAG 素材替换没有接入。
- 进度条显示层还有 bug。

最核心的一句话：

> 我把“端到端管道”接起来了，但还没有把“demo 级动画设计能力”接进这个管道。

## 9. 我过程中留下的疑点

这些不是新的建议，只是我在工作中发现但没有完全解决的地方：

1. DeepSeek family planner prompt 应该直接从成功 demo 反推，而不是抽象描述 family。
2. `motion_script` 应该变成 renderer 可执行的 DSL，否则 DeepSeek 规划不会真正落地。
3. `GenericVUClip` 可能不应该是一个大而全组件，而应该按 family 调不同的强模板。
4. 真实素材接口需要接 RAG / 素材库，否则最终版永远偏文字。
5. 进度条和导航的标签来源现在是 VU cutter，但显示策略需要单独稳定。
6. 当前 `run-batch.ps1` 默认仍输出到 `vu_overlays`，我后来手动测试的 `vu_overlays_v2/v3` 不一定已经完全纳入默认稳定流程。

