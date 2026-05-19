# E2E VU Pipeline 待办清单

目标：把当前“技术上端到端能跑”的临时链路，改成“使用已验证 VU cutter prompt + family-specific motion prompt + 可替换素材接口”的生产链路。

当前最大问题不是 Remotion，而是流程缺了两个关键语义层：

1. 跳过 Step2 后，进度条/导航没有正式的 LLM 提炼来源，只能从 `blueprint` 和 `logic_segment.items` 里机械猜。
2. VU 切分没有使用已验证的 `Visual Unit Cutter Prompt`，而是临时用 `build-from-blueprint.ts` 按 logic block 拼 VU，导致 VU 太碎、没有镜头空间。
3. 画面规划只有一个通用 prompt，没有针对不同 `presentation_family` 写镜头脚本 prompt，输出自然变成“逐句卡片”。

---

## 2026-04-30 执行状态

已完成：

- `run-batch.ps1` 默认主链路已切到 `DeepSeek v4 Pro VU Cutter -> VU Render Jobs -> DeepSeek v4 Pro VU Planner -> Remotion Family Renderer -> Jianying draft`。
- ASR 顺序保持为 `Qwen ASR + docx hotwords -> Claude review -> Qwen ForcedAlign`，并在批处理日志里打印 ASR Python、Step2 模式、VU cutter/planner 模型。
- `src/vu/cut-with-deepseek.ts` 已接入 `docs/visual-unit-cutter-prompt-v1.md`，不重写已验证 cutter prompt。
- `progress_nav_labels.json` 已作为进度条/导航的正式 LLM 标签来源；旧渲染器在 labels 存在时优先使用它。
- `src/vu/deepseek-plan.ts` 已接入 family-specific prompt，并从 `docs/vu-family-demo-patterns.md` 反推 demo pattern。
- 医生口播型 VU 已走 `skip_llm`，不调用 DeepSeek planner。
- KP19 已跑通：27 个 logic block -> 7 个 VU；4 个讲解型 VU 调 DeepSeek planner；6 个 VU overlay clip；剪映草稿生成成功。

本轮保留的疑问/风险：

- DeepSeek v4 Pro 很慢，KP19 的 VU cutter 约 6 分钟，4 个 VU planner 约 21 分钟；后续需要考虑缓存、并发或按 family 降级策略。
- Generic renderer 已有动效，但仍不是 SVU05 手工 demo 的质感；下一轮重点是把 `motion_script` 真正映射到 MagicMove/Fold/StackReveal，而不是只消费 beats/elements。
- 素材接口已经有 `asset_slots/asset_requests`，但尚未接入 RAG 素材检索与真实素材替换。

---

## P0: 先把正确创作链路接起来

### 1. 明确新主流程

目标流程：

```text
source video + docx
-> Qwen ASR + docx hotwords
-> Claude Review
-> Qwen ForcedAlign
-> Claude Step1 atom/scene/logic 初切
-> Claude Take Pass
-> DeepSeek v4 Pro VU Cutter
-> VU Render Jobs
-> DeepSeek VU Family Planner
-> Remotion Family Renderer
-> old pipeline progress/nav/subtitle/source video
-> Jianying draft
```

需要改动：

- [ ] 更新 `run-batch.ps1`，把 `vu:from-blueprint` 替换成真正的 `vu:cut`
- [ ] 保持 ASR 顺序为：`Qwen ASR + hotwords -> Claude review -> Qwen ForcedAlign`
- [ ] 保留 `--UseLegacyStep2` 兼容旧流程，但默认走 VU cutter
- [ ] 保留 `src/vu/build-from-blueprint.ts` 作为 fallback/debug，不再作为主路径
- [ ] 在批处理日志里明确打印：
  - ASR Python
  - Step1 model
  - Take Pass model
  - VU Cutter model
  - VU Planner model
  - 是否跳过 Step2
  - 是否使用 fallback VU builder

验收：

- [ ] 跑 KP19 时不再出现大量 `0.3s / 0.5s` VU
- [ ] VU 数量应明显少于 logic block 数量
- [ ] 每个讲解型 VU 通常有 `2-5` 个 internal beats

---

## P0: 接入已验证 VU Cutter Prompt

### 2. 新增 VU Cutter 脚本

新增文件：

- [ ] `src/vu/cut-with-deepseek.ts`

输入：

- [ ] `blueprint.json`
- [ ] `timing_map.json`
- [ ] 可选 `visual_plan.json`
- [ ] 可选 `source metadata`

输出：

- [ ] `visual_units.json`
- [ ] `vu_cut_report.json`
- [ ] `progress_nav_labels.json`

命令：

```bash
npm run vu:cut -- \
  --blueprint out/blueprint.json \
  --timing-map out/timing_map.json \
  --output out/visual_units.json \
  --labels-output out/progress_nav_labels.json \
  --model deepseek-v4-pro
```

需要改 `package.json`：

- [ ] 新增 `"vu:cut": "npx tsx src/vu/cut-with-deepseek.ts"`

模型：

- [ ] 默认 `DEEPSEEK_VU_CUTTER_MODEL=deepseek-v4-pro`
- [ ] `run-batch.ps1` 增加参数 `-VuCutterModel`
- [ ] `.env` 支持：
  - `DEEPSEEK_VU_CUTTER_MODEL`
  - `DEEPSEEK_VU_PLANNER_MODEL`

验收：

- [ ] dry-run 能输出完整 prompt
- [ ] 正式运行能生成合法 JSON
- [ ] schema 校验失败时自动 retry 一次
- [ ] 失败时保存 raw response 到 debug 文件

### 3. 整理 VU Cutter Prompt

现有文档：

- `docs/visual-unit-cutter-prompt-v1.md`

需要做：

- [ ] 先完整阅读现有 VU cutter prompt，不重写、不擅自新增切分原则
- [ ] 把文档里的 System Prompt / User Prompt Template 抽成代码可读取模板
- [ ] 新增 `src/vu/prompts/visual-unit-cutter.ts`
- [ ] 不要在脚本里硬编码大段 prompt
- [ ] prompt 输入使用压缩后的 `BLUEPRINT_SUMMARY_JSON`
- [ ] 输出 schema 以已验证 prompt 为准，代码适配 prompt，而不是让代码临时改 prompt

`BLUEPRINT_SUMMARY_JSON` 必须包含：

- [ ] `title`
- [ ] `scenes`
- [ ] 每个 scene:
  - [ ] `id`
  - [ ] `title`
  - [ ] `start`
  - [ ] `end`
  - [ ] `logic_blocks`
- [ ] 每个 logic block:
  - [ ] `id`
  - [ ] `start`
  - [ ] `end`
  - [ ] `text`
  - [ ] `atom_ids`
  - [ ] `items`
  - [ ] `template`
- [ ] 不要把完整 `words` 全塞进去，避免 prompt 爆长

输出 JSON schema 原则：

- [ ] 以已验证 VU cutter prompt 的原始输出为准
- [ ] 必须包含 `visual_units`
- [ ] 如果现有 prompt 已包含 `progress_label` / `nav_label`，直接使用
- [ ] 如果现有 prompt 不包含进度条/导航标签，不要擅自改 cutter 主 prompt；新增独立 `vu:labels` 提炼步骤
- [ ] `diagnostics` 可以由代码侧生成，不强行要求 LLM 输出

每个 `visual_unit` 字段以现有 prompt 为准；代码侧至少需要能映射出：

- [ ] `id`
- [ ] `start`
- [ ] `end`
- [ ] `duration`
- [ ] `covers`
- [ ] `audience_state_from`
- [ ] `audience_state_to`
- [ ] `communicative_goal`
- [ ] `attention_owner`
- [ ] `presentation_family`
- [ ] `render_strategy`
- [ ] `one_screen_message`
- [ ] `internal_beats`
- [ ] `asset_intent`
- [ ] `progress_label`
- [ ] `nav_label`
- [ ] `merge_basis`
- [ ] `split_after`

每个 `internal_beat` 字段：

- [ ] `id`
- [ ] `start_ratio`
- [ ] `end_ratio`
- [ ] `covers`
- [ ] `large_text`
- [ ] `visual_goal`
- [ ] `attention_owner`
- [ ] `must_show`
- [ ] `may_fold`

---

## P0: 进度条和导航改用 LLM 标签

### 4. 新增标签来源文件

新增输出：

- [ ] `out/progress_nav_labels.json`

建议 schema：

```json
{
  "tier1": [
    {
      "id": "scene_or_vu_group_id",
      "label": "乱吃药",
      "start": 0.0,
      "end": 18.2,
      "covers_vu": ["SVU02", "SVU03"]
    }
  ],
  "tier2": [
    {
      "id": "logic_block_or_vu_beat_id",
      "parent_id": "scene_or_vu_group_id",
      "label": "止痛药",
      "start": 4.1,
      "end": 8.6,
      "covers": ["S2-L3"]
    }
  ],
  "navigation": [
    {
      "id": "nav_1",
      "label": "乱吃药",
      "start": 0.0,
      "end": 18.2
    }
  ]
}
```

需要改动：

- [ ] `scripts/render_progress_bar.py` 支持 `progress_nav_labels.json`
- [ ] `scripts/render_navigation.py` 支持 `progress_nav_labels.json`
- [ ] 如果 labels 文件存在，优先使用 labels
- [ ] 如果 labels 文件不存在，再 fallback 到 `visual_plan.json`

验收：

- [ ] 进度条一级不再显示 `口播片段`
- [ ] 进度条一级不显示完整句子
- [ ] 进度条一级是 scene/VU group 级标签，比如：
  - `开场`
  - `乱吃药`
  - `控盐`
  - `睡眠`
  - `饮水`
  - `偏方`
  - `运动`
  - `总结`
- [ ] 二级是 logic block / beat 短标签，比如：
  - `止痛药`
  - `来路不明`
  - `布洛芬`
  - `肾血流`
  - `遵医嘱`
- [ ] 场景多时一级继续横向流动，不压成密集格子
- [ ] 导航页使用同一套 `navigation.label`

---

## P0: VU 切分规则以已验证 prompt 为准

### 5. 不要新增硬编码时长规则

原则：

- [ ] 不把 `1.8s` 之类的时长下限写进 VU cutter prompt
- [ ] 不用程序规则替代已验证 prompt 的切分判断
- [ ] VU 长短、合并、拆分、是否 doctor_talk，由现有 VU cutter prompt 决定
- [ ] 代码侧只做非阻断 diagnostics，例如提示“这个 VU 很短，建议人工看一下”
- [ ] 如果切分结果明显异常，优先调整/回滚到已验证 prompt，而不是加硬规则

验收：

- [ ] KP19 的 VU 切分结果接近已验证 prompt 的历史表现
- [ ] 不因为代码硬规则强行合并/拆分 VU
- [ ] `doctor_talk` VU 不进入 DeepSeek planner
- [ ] `vu_render_jobs.json` 里 deepseek calls 数量明显少于 VU 总数

---

## P0: Family-specific 画面规划 Prompt

当前状态：只有 `src/vu/deepseek-plan.ts` 的通用 prompt。

目标：每个重要 `presentation_family` 都有独立 prompt，DeepSeek 输出的是镜头脚本，不是逐句卡片。

重要原则：

- [ ] family prompt 不能凭空发挥，必须从已经做过、用户认可的 demo 中反推
- [ ] 先读 demo 代码和 motion plan，再写 prompt
- [ ] prompt 要描述 demo 中已经验证过的构图、运镜、折叠、素材位，而不是重新发明画面设计
- [ ] 画面规划阶段先统一使用 `deepseek-v4-pro`
- [ ] 只有当 v4 pro 输出稳定、schema 稳定、视觉稳定后，再评估哪些简单 family 可以切到 flash

新增目录：

- [ ] `src/vu/prompts/families/`

必须先阅读/提炼的 demo 来源：

- [ ] `src/remotion/demos/SVU05Motion.tsx`
- [ ] `src/remotion/demos/svu05-motion-plan.ts`
- [ ] `src/remotion/demos/SVU05PlanDemo.tsx`
- [ ] `src/remotion/demos/SVU07PlanDemo.tsx`
- [ ] `src/remotion/demos/svu07-motion-plan.ts`
- [ ] `src/remotion/demos/SVU08PlanDemo.tsx`
- [ ] `src/remotion/demos/SVU03PlanDemo.tsx`
- [ ] `src/remotion/demos/SVU01PlanDemo.tsx`
- [ ] `src/remotion/demos/SVU14PlanDemo.tsx`
- [ ] `src/remotion/demos/motion-primitives.tsx`

需要新增 demo pattern 文档：

- [ ] `docs/vu-family-demo-patterns.md`

该文档逐个 family 总结：

- [ ] demo 源文件
- [ ] 适用场景
- [ ] 画面分区
- [ ] 核心元素
- [ ] 运镜原语
- [ ] 折叠规则
- [ ] 素材替换槽位
- [ ] 失败样式禁忌

### 6. 通用 planner prompt 框架

新增：

- [ ] `src/vu/prompts/family-planner-base.ts`

基础规则包括：

- [ ] 先引用对应 family 的 demo pattern，不允许脱离 demo pattern 自由发挥
- [ ] 右侧 `940px+` 留给平台 UI
- [ ] 底部字幕区保留
- [ ] 不画主播占位
- [ ] 不画平台 UI 占位
- [ ] 不画免责声明，旧管线处理
- [ ] 每个 beat 只能有一个主视觉 owner
- [ ] 元素过多必须 fold，而不是堆叠
- [ ] 主元素必须跨 beat 持续，不能每 beat 重画一页
- [ ] 输出必须包含 motion intent：
  - `enter`
  - `hold`
  - `transform`
  - `fold`
  - `exit`

### 7. 必须先写的 family prompts

#### 7.1 `closed_loop_board`

必须参考：

- [ ] `SVU05Motion.tsx`
- [ ] `SVU05PlanDemo.tsx`

适用：

- 解释一个因果闭环
- “行为 -> 肾脏负担 -> 结果”
- “正常人没事 -> 肾病患者危险”

Prompt 文件：

- [ ] `src/vu/prompts/families/closed-loop-board.ts`

必须输出：

- [ ] `board_title`
- [ ] `loop_nodes`
- [ ] `active_node_by_beat`
- [ ] `main_subject`
- [ ] `fold_rules`
- [ ] `motion_script`

必须支持动效：

- [ ] Stack Reveal
- [ ] Magic Move
- [ ] active node highlight
- [ ] previous nodes fold
- [ ] arrow/path drawing

验收：

- [ ] 不再是左侧几张卡片 + 右侧 emoji
- [ ] 至少有一个元素跨 beat 持续移动或折叠
- [ ] 能表达“闭环”

#### 7.2 `mechanism_warning`

必须参考：

- [ ] 鱼油 demo 中“房颤 +10% / Nucleus 视频 / 风险警示”的处理
- [ ] `SVU07PlanDemo.tsx`
- [ ] `svu07-motion-plan.ts`

适用：

- 风险机制
- 肾小管损伤
- 肾血流减少
- 肾功能下降

Prompt 文件：

- [ ] `src/vu/prompts/families/mechanism-warning.ts`

必须输出：

- [ ] `risk_subject`
- [ ] `mechanism_steps`
- [ ] `warning_claim`
- [ ] `evidence_or_source`
- [ ] `asset_slots`
- [ ] `motion_script`

必须支持动效：

- [ ] warning pulse
- [ ] red slash draw
- [ ] mechanism path drawing
- [ ] damage highlight
- [ ] evidence panel slide-in

验收：

- [ ] 不能只是一张红框警告卡
- [ ] 必须有机制路径或因果箭头
- [ ] 必须留出真实素材替换槽位

#### 7.3 `action_path`

必须参考：

- [ ] `SVU08PlanDemo.tsx` 的决策/路径分支方式
- [ ] 后续 KP19 六件事路径 demo 样例

适用：

- “第一/第二/第三”
- 行动建议
- 做法路径

Prompt 文件：

- [ ] `src/vu/prompts/families/action-path.ts`

必须输出：

- [ ] `path_steps`
- [ ] `active_step_by_beat`
- [ ] `recommended_action`
- [ ] `motion_script`

必须支持动效：

- [ ] path drawing
- [ ] step node pop-in
- [ ] active step advance
- [ ] completed step shrink/green

验收：

- [ ] 不能把“第二呢/第三呢”单独切 VU
- [ ] 序号必须作为路径节点，不作为一级标题

#### 7.4 `kinetic_title`

必须参考：

- [ ] `SVU03PlanDemo.tsx`

适用：

- 开场标题
- 大承诺
- 章节开头

Prompt 文件：

- [ ] `src/vu/prompts/families/kinetic-title.ts`

必须输出：

- [ ] `title_lines`
- [ ] `emphasis_words`
- [ ] `supporting_props`
- [ ] `motion_script`

必须支持动效：

- [ ] title burst
- [ ] underline sweep
- [ ] prop cards fly-in
- [ ] final lock

验收：

- [ ] 类似 demo 的“标题揭示”，不是白卡片标题

#### 7.5 `data_pop`

必须参考：

- [ ] `SVU05Motion.tsx` 里的 `+10%` 数字爆出、CountUp、source slide-in

适用：

- 数字、百分比、风险变化
- 指标值

Prompt 文件：

- [ ] `src/vu/prompts/families/data-pop.ts`

必须输出：

- [ ] `number`
- [ ] `unit`
- [ ] `context_top`
- [ ] `context_bottom`
- [ ] `comparison_baseline`
- [ ] `source_note`
- [ ] `motion_script`

必须支持动效：

- [ ] CountUp
- [ ] Pop-in
- [ ] number settle
- [ ] source slide-in

验收：

- [ ] 数字是主角
- [ ] 其他元素必须折叠让位

#### 7.6 `decision_tree`

必须参考：

- [ ] `SVU08PlanDemo.tsx`

适用：

- “如果...就...”
- 是否需要做某事

Prompt 文件：

- [ ] `src/vu/prompts/families/decision-tree.ts`

必须输出：

- [ ] `root_question`
- [ ] `branches`
- [ ] `recommended_branch`
- [ ] `branch_results`
- [ ] `motion_script`

必须支持动效：

- [ ] root pop-in
- [ ] branch line drawing
- [ ] branch card reveal
- [ ] recommended highlight

#### 7.7 `comparison_split`

必须参考：

- [ ] `SVU01PlanDemo.tsx`

适用：

- 正常人 vs 肾病患者
- 错误做法 vs 正确做法
- 药物 vs 保健品

Prompt 文件：

- [ ] `src/vu/prompts/families/comparison-split.ts`

必须输出：

- [ ] `left_subject`
- [ ] `right_subject`
- [ ] `comparison_axis`
- [ ] `winner_or_warning`
- [ ] `motion_script`

必须支持动效：

- [ ] mirrored slide-in
- [ ] VS connector
- [ ] one side warning pulse
- [ ] conclusion lock

#### 7.8 `concept_balance`

必须参考：

- [ ] `SVU14PlanDemo.tsx`

适用：

- 平衡概念
- 太多/太少
- 稳定区间

Prompt 文件：

- [ ] `src/vu/prompts/families/concept-balance.ts`

必须输出：

- [ ] `left_extreme`
- [ ] `right_extreme`
- [ ] `safe_zone`
- [ ] `needle_motion`
- [ ] `final_message`

必须支持动效：

- [ ] gauge draw
- [ ] needle sweep
- [ ] safe zone glow
- [ ] final settle

### 8. 暂缓的 family prompts

这些可以先 fallback 到通用模板：

- [ ] `doctor_talk`
- [ ] `suspense_talk`
- [ ] `doctor_cta`
- [ ] `myth_flip`
- [ ] `replacement_compare`
- [ ] `value_summary`
- [ ] `case_narrative`
- [ ] `risk_stack`
- [ ] `mechanism_chain`
- [ ] `overview_data`
- [ ] `object_shock_title`
- [ ] `pivot_title`

但每个 fallback 必须满足：

- [ ] 不画占位
- [ ] 不污染右侧平台区
- [ ] 不挡真实字幕
- [ ] 不出现 debug footer

---

## P1: Renderer 要从 Generic 变成 Family Renderer

### 9. 拆分 Remotion renderer

当前：

- `src/remotion/demos/GenericVUClip.tsx`

目标新增：

- [ ] `src/remotion/vu/GenericVUComposition.tsx`
- [ ] `src/remotion/vu/families/ClosedLoopBoard.tsx`
- [ ] `src/remotion/vu/families/MechanismWarning.tsx`
- [ ] `src/remotion/vu/families/ActionPath.tsx`
- [ ] `src/remotion/vu/families/KineticTitle.tsx`
- [ ] `src/remotion/vu/families/DataPop.tsx`
- [ ] `src/remotion/vu/families/DecisionTree.tsx`
- [ ] `src/remotion/vu/families/ComparisonSplit.tsx`
- [ ] `src/remotion/vu/families/ConceptBalance.tsx`
- [ ] `src/remotion/vu/families/FallbackBoard.tsx`

共享组件：

- [ ] `src/remotion/vu/primitives/MagicMove.tsx`
- [ ] `src/remotion/vu/primitives/StackReveal.tsx`
- [ ] `src/remotion/vu/primitives/PathDraw.tsx`
- [ ] `src/remotion/vu/primitives/CountUp.tsx`
- [ ] `src/remotion/vu/primitives/Fold.tsx`
- [ ] `src/remotion/vu/primitives/AssetSlot.tsx`
- [ ] `src/remotion/vu/primitives/TextFit.tsx`

验收：

- [ ] 每个 family 有自己的构图，不共用卡片网格
- [ ] family renderer 消费同一套 `VUPlan`
- [ ] 素材缺失时 fallback 为 icon/emoji，但不破坏布局

---

## P1: 素材替换接口

### 10. Asset slot 标准化

当前已有：

- `asset_slots`
- `asset_requests`

需要增强：

- [ ] 支持 `asset_role`
  - `main_subject`
  - `mechanism_evidence`
  - `background_context`
  - `source_document`
  - `icon_only`
- [ ] 支持 `preferred_motion`
  - `static`
  - `loop_video`
  - `cutout_magic_move`
  - `evidence_panel`
- [ ] 支持 `crop_policy`
  - `contain`
  - `cover`
  - `transparent_png`
  - `safe_center`
- [ ] 支持 `replacement_priority`
  - `required`
  - `nice_to_have`
  - `fallback_ok`

需要新增：

- [ ] `src/vu/assets/resolve-assets.ts`
- [ ] `src/vu/assets/rag-search.ts`
- [ ] `src/vu/assets/asset-manifest.ts`

输出：

- [ ] `out/vu_assets.manifest.json`

RAG 接入点：

- [ ] mechanism 类 VU 可调用现有 RAG 素材系统找医学动画/机制图
- [ ] subject 类 VU 可找产品/药物/器官 cutout
- [ ] 找不到真实素材时，继续用 fallback icon/emoji

验收：

- [ ] 替换鱼油/药物/肾脏素材时不需要改 renderer
- [ ] 素材路径只进入 manifest，不写死在 prompt 里

---

## P1: 剪映草稿集成

当前脚本：

- `scripts/generate-vu-overlay-jianying-draft.py`

需要确认/改动：

- [ ] 保留真实原视频轨
- [ ] 保留旧字幕轨
- [ ] 保留旧进度条轨
- [ ] 保留旧导航轨
- [ ] VU overlay 只替换原 overlay 层
- [ ] `doctor_talk` / `skip_llm` VU 不生成 overlay clip
- [ ] VU overlay clip 起止时间严格使用 `visual_units[].time`
- [ ] 支持重新生成草稿时覆盖旧 draft
- [ ] 支持复制到剪映默认草稿目录

验收：

- [ ] 草稿里可以单独删除/调整某一个 VU overlay
- [ ] 不出现主播占位、平台 UI 占位、debug footer
- [ ] 右侧和底部平台区没有被主要信息占用

---

## P1: 配置和命令整理

### 11. `run-batch.ps1` 参数

需要新增/整理：

- [ ] `-VuCutterModel`
- [ ] `-VuPlannerModel`
- [ ] `-SkipVuCut`
- [ ] `-SkipVuPlan`
- [ ] `-SkipVuRender`
- [ ] `-OnlyVu`
- [ ] `-OnlyDraft`
- [ ] `-AsrPythonPath`
- [ ] `-UseFallbackVuBuilder`

`.env` 支持：

- [ ] `ASR_PYTHON_PATH=C:\Python310\python.exe`
- [ ] `DEEPSEEK_VU_CUTTER_MODEL=deepseek-v4-pro`
- [ ] `DEEPSEEK_VU_PLANNER_MODEL=deepseek-v4-pro`
- [ ] `DEEPSEEK_BASE_URL=https://api.deepseek.com/v1`
- [ ] `DEEPSEEK_API_KEY=...`

建议默认：

- [ ] VU cutter: `deepseek-v4-pro`
- [ ] VU planner: `deepseek-v4-pro`
- [ ] flash 只作为后续降本实验，不作为当前默认

---

## P1: 验证和回归测试

### 12. 单元测试/快照测试

新增：

- [ ] `tests/vu/cutter-schema.test.ts`
- [ ] `tests/vu/progress-labels.test.ts`
- [ ] `tests/vu/family-plan-schema.test.ts`
- [ ] `tests/vu/render-job-builder.test.ts`

测试内容：

- [ ] VU cutter 输出 schema 校验
- [ ] VU 不低于最小时长
- [ ] doctor_talk 不进 DeepSeek planner
- [ ] progress/nav labels 不包含：
  - [ ] `口播片段`
  - [ ] `第二呢`
  - [ ] `第三呢`
  - [ ] 超长完整句子
- [ ] family plan 必须包含 motion script

### 13. 视觉验证脚本

新增：

- [ ] `scripts/extract-vu-review-frames.py`
- [ ] `scripts/build-vu-review-contact-sheet.py`

输出：

- [ ] `out/_review/contact_sheet.png`
- [ ] `out/_review/progress_check.mp4`
- [ ] `out/_review/sample_vu_*.mp4`

验收：

- [ ] 每次跑完自动抽：
  - [ ] 进度条 3 帧
  - [ ] 每种 family 1 个 VU 样片
  - [ ] 草稿路径

---

## P2: Prompt 质量迭代

### 14. VU cutter few-shot 样例

需要补到 prompt 里：

- [ ] 鱼油 demo 的 SVU05 样例
- [ ] KP19 “乱吃止痛药”样例
- [ ] KP19 “高盐饮食”样例
- [ ] KP19 “保健品/偏方”样例
- [ ] KP19 “过度运动”样例

每个样例要包含：

- [ ] 输入 logic blocks
- [ ] 输出 visual unit
- [ ] 为什么合并
- [ ] 为什么切分
- [ ] progress/nav label
- [ ] internal beats

### 15. Family planner few-shot 样例

每个重点 family 至少 1 个 few-shot：

- [ ] `closed_loop_board`: 鱼油 + KP19 高盐
- [ ] `mechanism_warning`: 房颤 + KP19 肾小管损伤
- [ ] `action_path`: KP19 六件事路径
- [ ] `kinetic_title`: KP19 开场
- [ ] `data_pop`: 鱼油 +10%
- [ ] `decision_tree`: 是否需要补充类内容
- [ ] `comparison_split`: 正常人 vs 肾病患者
- [ ] `concept_balance`: 免疫力平衡

few-shot 来源要求：

- [ ] 优先从已经做过且视觉效果通过的 Remotion demo 抽取
- [ ] 不用临时想象的画面方案做 few-shot
- [ ] 每个 few-shot 要对应一个 demo 源文件或审核通过的视频样片
- [ ] prompt 中明确写出“遵循该 demo pattern，而不是重新设计版式”

---

## P2: 清理临时代码

这些不是立刻删，但要归位：

- [ ] `src/remotion/demos/GenericVUClip.tsx` 迁移到 `src/remotion/vu/`
- [ ] `src/remotion/demos/plan-shared.tsx` 中可复用部分迁移到 `src/remotion/vu/`
- [ ] `src/vu/build-from-blueprint.ts` 标注为 fallback/debug
- [ ] 删除或归档 `vu_overlays_check`
- [ ] 清理临时 `_review` 命名规则
- [ ] 文档补充正式运行命令

---

## 推荐实施顺序

### 第 1 步

- [ ] 实现 `vu:cut`
- [ ] 接入 `docs/visual-unit-cutter-prompt-v1.md`
- [ ] 用 `deepseek-v4-pro`
- [ ] 输出 `visual_units.json + progress_nav_labels.json`

### 第 2 步

- [ ] 进度条/导航改读 `progress_nav_labels.json`
- [ ] 删除当前靠规则猜标签的主路径，只保留 fallback

### 第 3 步

- [ ] 先从现有 demo 反推 `closed_loop_board` 和 `mechanism_warning` 的 pattern 文档
- [ ] 再基于 demo pattern 写两个 family prompt
- [ ] 画面规划模型使用 `deepseek-v4-pro`
- [ ] 先只重做 KP19 的 2-3 个重点 VU

### 第 4 步

- [ ] 拆分 Remotion family renderer
- [ ] 把 demo 里的 Magic Move / Fold / PathDraw / CountUp 原语迁进去

### 第 5 步

- [ ] 接 RAG 素材 manifest
- [ ] 验证真实素材替换不影响布局

### 第 6 步

- [ ] KP19 全量重跑
- [ ] 输出剪映草稿
- [ ] 与鱼油 demo 对照评估

---

## 当前结论

当前端到端链路证明了：

- [x] ASR 可以跑
- [x] forced align 可以跑
- [x] 老字幕/导航/进度条/原视频可以保留
- [x] Remotion VU overlay 可以塞进剪映草稿
- [x] DeepSeek API 可以调用

但还没有证明：

- [ ] VU 自动切分质量可靠
- [ ] 进度条/导航语义可靠
- [ ] family 画面规划达到 demo 级别
- [ ] 素材替换接口真正可用

所以下一阶段的核心不是“继续做更多 VU 模板”，而是先把 `VU Cutter -> Labels -> Family Planner` 这三层补齐。
