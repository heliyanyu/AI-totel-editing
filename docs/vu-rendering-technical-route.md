# Visual Unit Rendering Technical Route

核心结论：不要在 `Mermaid/Remotion` 和 `GPT 生图` 之间二选一。正确路线是混合渲染：

> GPT image 负责高天花板的视觉质感和场景资产；Remotion 负责中文文字、红框、高亮、时间节奏、字幕和可控动画。

中文可读信息、医学关系、红框高亮、路径选择，尽量不要让生图模型直接画死在图里。生图适合做“画面底座”，Remotion 适合做“语义层”。

---

## 1. 按时长决定主路线

| VU 时长 | 推荐路线 | 原因 |
|---:|---|---|
| 0-4s | `source_video_overlay` 或 `remotion_text` | 强情绪/转场/一句话重锤，靠医生和大字，没必要生复杂图。 |
| 4-8s | `image_first_hybrid` | 一张高质量静态设计图 + 大字/红框动效，性价比最高，冲击力强。 |
| 8-20s | `structured_hybrid` | 信息开始需要分步读，结构用 Remotion，图片/插图用 GPT 或素材库。 |
| 20s+ | `remotion_structural` | 静态图会疲劳。需要知识板/流程图/高亮区域按 beat 推进。 |

---

## 2. Mermaid vs Remotion vs GPT Image

### Mermaid

适合：

- 快速草图
- 内部预览
- 简单流程/决策结构的初版布局

不适合作为最终成片主路线：

- 视觉太像工程文档
- 中文换行和字号难精修
- 手机 9:16 小屏可读性不可控
- 节点位置、线条弧度、局部高亮不够灵活
- 很难做出短视频里“有设计感”的冲击力

结论：

> Mermaid 可以做 draft，不建议做 final renderer。最终应该是自定义 React/SVG/HTML layout in Remotion，必要时参考 Mermaid 的布局思想。

### Remotion / SVG / HTML

适合：

- 中文文字
- 大字标题
- 红框/箭头/高亮
- 知识板
- 决策树
- 风险堆叠
- 数字披露
- 时间线
- 多 beat 动画

缺点：

- 如果完全靠手写 CSS/SVG，画面容易像 PPT
- 缺少真实场景、复杂插画、医学质感

结论：

> Remotion 是语义层和时间轴，不应该独自承担所有视觉质感。

### GPT Image

适合：

- 高冲击静态海报
- 生活场景
- 医学插画底图
- 产品/物品/人物情境
- 短 VU 的“震撼感”
- 不需要严格逐字可读的小字背景

不适合直接承担：

- 准确中文文字
- 可编辑结构图
- 需要逐步高亮的节点
- 医学因果箭头和条件分支的精确布局

结论：

> GPT Image 不要直接生成最终带中文信息的成片图。更好的用法是生成无文字或少文字的视觉底图，再由 Remotion 加中文语义层。

---

## 3. 决策树应该怎么做？

问题：决策树用 Mermaid+Remotion，还是 GPT 生图然后加红框？

推荐答案：

> 最终成片用 `custom React/SVG decision tree + GPT visual assets`，不要直接用 Mermaid，也不要让 GPT 把整棵树画死。

原因：

- 决策树的核心价值是“条件是否清楚、路径是否可读、当前走哪条是否高亮”
- 这些都需要精确控制和时间同步
- GPT 画出来的树可能漂亮，但中文、路径、节点间距、红框位置都不可控
- Mermaid 稳但太工程化，不够短视频

推荐结构：

```json
{
  "render_strategy": "structured_hybrid",
  "family": "decision_tree",
  "generated_assets": [
    "background_style_image",
    "optional_character_or_object_illustration"
  ],
  "remotion_layers": [
    "question_node",
    "branch_nodes",
    "connectors",
    "large_text",
    "active_path_highlight",
    "red_frame"
  ]
}
```

决策树画面示例：

- GPT 生成干净医疗科普风背景、鱼/药/人物小插图
- Remotion 画真正的节点、文字、箭头、红框
- beat 1：问题节点出现
- beat 2：左路径点亮
- beat 3：右路径点亮
- beat 4：最终建议大字落下

---

## 4. 各 Presentation Family 的推荐技术路线

| Family | 主路线 | GPT Image 角色 | Remotion 角色 |
|---|---|---|---|
| `doctor_talk` | source_video_overlay | 基本不用，最多贴纸/情绪符号 | 字幕、关键词、警示闪动 |
| `shock_text` | remotion_text 或 image_first_hybrid | 背景冲击图/质感 | 超大中文、描边、震动、闪白 |
| `knowledge_board` | remotion_structural | 可做纸张/板书背景和装饰 | 节点、标题、当前高亮、分步推进 |
| `mechanism_diagram` | structured_hybrid | 器官/药物/场景插画底图 | 箭头、标签、红框、风险数字 |
| `risk_stack` | remotion_structural | 药物图标/包装插图 | 堆叠、风险条、逐项入栈动画 |
| `decision_tree` | custom SVG/React | 背景/图标/人物 | 节点、路径、文字、当前路径高亮 |
| `contrast_screen` | structured_hybrid | 产品/食物/生活照片 | 价格、标签、VS、结论大字 |
| `number_reveal` | remotion_text/chart | 一般不用 | 数字、计数、图表、单位 |
| `case_scene` | image_first_hybrid | 主场景图，人物/生活代入 | 字幕、箭头、红框、结论大字 |
| `action_checklist` | remotion_structural | 图标/背景插画 | 清单、逐项点亮、勾选 |
| `timeline_path` | remotion_structural | 少量图标 | 时间轴、节点、高亮 |
| `emotional_cta` | source_video_overlay | 基本不用 | 分享按钮、关注提示、情绪大字 |

---

## 5. 生图的正确用法

### 原则一：文本剥离

尽量不要让 GPT Image 生成中文正文。

好的 prompt：

> 生成一张 9:16 医疗科普风格插画：一位中年人坐在桌前，旁边有鱼油胶囊和心电图异常的视觉隐喻。画面留出底部字幕空间，不要任何文字。

坏的 prompt：

> 生成一张图，上面写“心脏不好别乱补鱼油，房颤更频繁”。

### 原则二：底图和语义层分离

生成图负责：

- 场景
- 质感
- 氛围
- 物体
- 人物
- 医学插画

Remotion 负责：

- 中文
- 数字
- 红框
- 箭头
- 高亮
- 进度
- 逐 beat 出现

### 原则三：短 VU 可以更依赖生图

如果 VU 只有 4-8 秒，并且目标是震撼、代入、情绪感染，一张高质量静态图加少量 Remotion 动效通常比纯代码强。

---

## 6. 推荐 Pipeline

```text
Visual Unit
  ↓
Presentation Family Classifier
  ↓
Render Strategy Classifier
  ↓
┌─────────────────────────────┬─────────────────────────────┐
│ remotion_structural          │ image_first_hybrid           │
│ - board/tree/chart/text      │ - GPT Image background       │
│ - all text in Remotion       │ - text/highlight in Remotion │
└─────────────────────────────┴─────────────────────────────┘
  ↓
Asset Cache / GPT Image Cache
  ↓
Remotion final composition
```

每个 VU 输出建议新增字段：

```json
{
  "presentation_family": "decision_tree",
  "render_strategy": "structured_hybrid",
  "image_generation_policy": "background_or_icons_only",
  "text_policy": "all_text_in_remotion",
  "beat_count": 4,
  "asset_queries": [
    "clean medical infographic background",
    "fish oil capsule illustration"
  ]
}
```

---

## 7. 当前建议

第一版不要接 Mermaid 做 final。

优先实现三条路线：

1. `source_video_overlay`
   - 医生口播、CTA、情绪段

2. `remotion_structural`
   - knowledge board、decision tree、risk stack、number reveal、timeline

3. `image_first_hybrid`
   - shock text、case scene、短促高冲击 VU

这样能覆盖大部分 VU，而且不会把系统锁死在“纯代码 PPT”或“不可控生图”两种极端里。
