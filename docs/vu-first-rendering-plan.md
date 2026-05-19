# VU-First Rendering Plan

目标：取消现有 Step2 的“每个 logic block 选模板”路线，改成先组合 Visual Unit，再按 VU 决定是否调用 DeepSeek。

核心判断：

- 不是每个 VU 都需要 LLM。
- 医生口播型 VU 基本不需要自动 overlay，最终输出剪映草稿后，剪辑师加花字最便宜、最快。
- 只有解释型、结构型、机制型、决策型 VU 才需要 DeepSeek 做画面规划。
- 所有素材必须通过可替换接口进入，不把鱼油、心脏、药瓶等资产写死在模板里。

---

## 1. 新 Pipeline

```text
Transcript / Script
  ↓
Review + Force Align
  ↓
Step1 / Take-pass
  ↓
Scene + Logic Blocks + Atoms + Timing
  ↓
VU Cutter
  ↓
VU Router
  ├─ skip_llm        → 剪映草稿占位 + 字幕 + editor notes
  ├─ template_only   → 固定 family 模板 + 默认元素
  └─ deepseek_plan   → 每个 VU 调一次 DeepSeek，输出结构化 VUPlan
       ↓
Asset Resolver
  ├─ RAG 素材库检索
  ├─ 用户/团队真实图片
  ├─ Nucleus/医学动画片段
  └─ 临时 placeholder
       ↓
Family Renderer
       ↓
Remotion overlay mp4 / PNG sequence
       ↓
Jianying draft
```

关键变化：

- Step2 不再按 logic block 输出 `template/items`。
- VU Cutter 负责合并 logic blocks，保证观众状态转移完整。
- DeepSeek 不直接写 React，不直接写 Remotion 代码，只输出结构化 `VUPlan`。
- Renderer 是稳定代码，DeepSeek 只是填数据。

---

## 2. 三类 LLM 策略

### A. `skip_llm`

适用：

- `attention_owner = doctor`
- 主播口播、情绪承接、悬念、CTA
- 没有必须解释的结构关系

输出：

- 不生成 Remotion overlay，或只生成最轻量的字幕/marker。
- 剪映草稿里保留源视频、真实字幕、VU marker、剪辑师备注。

例子：

- SVU02：吃错真的会出事
- SVU04：听完再决定买不买
- SVU20：转给长辈，别再被忽悠

这类不要为了“自动化完整”强行上图。医生的信任感就是画面主体。

### B. `template_only`

适用：

- 极短转折标题
- 简单对象登场
- 简单对比，结构固定
- 用固定模板就足够，不需要 DeepSeek 推理

输出：

- 使用确定性模板，由规则填默认元素。
- 可以允许剪辑师在剪映里替换或加强花字。

例子：

- SVU03：掀开三大保健品底牌
- SVU10：灵芝孢子粉：智商税靠前
- SVU15：三件小事就够了
- SVU01：药嫌贵，保健品不手软，如果只做固定双栏对比，可以不调 DeepSeek

### C. `deepseek_plan`

适用：

- 需要解释、结构推进、素材选择、元素折叠、因果链、风险叠加、决策树。
- VU 内部有多个 beats。
- 需要判断“哪些素材进画面、哪些素材折叠、哪个元素是主角”。

例子：

- SVU05：鱼油总览 + 房颤 10%
- SVU06：心脏不好乱补鱼油的反讽案例
- SVU07：药物叠加 + 出血风险
- SVU08：吃鱼与否的决策树
- SVU09：牛初乳卖点、错配、替代闭环
- SVU11：几丁质外壳消化不了
- SVU12：破壁也氧化
- SVU13：灵芝粉不如鸡蛋
- SVU14：免疫力平衡模型
- SVU16：晒太阳 / 晒不到 / 补剂路径
- SVU17：每周 150 分钟 + 强度判定
- SVU18：睡觉是免疫修复期
- SVU19：省钱买真实食物

---

## 3. VU Router

Router 是一个可解释的规则层，先不要让 LLM 决定自己是否需要 LLM。

```ts
type LlmPolicy = "skip_llm" | "template_only" | "deepseek_plan";

function routeVisualUnit(vu: VisualUnit): LlmPolicy {
  if (
    vu.attention_owner === "doctor" &&
    !vu.internal_beats?.length &&
    !requiresVisualExplanation(vu)
  ) {
    return "skip_llm";
  }

  if (
    vu.duration <= 6.5 &&
    ["标题", "登场", "转折", "CTA", "口播"].some((cue) =>
      vu.presentation_strategy.includes(cue)
    ) &&
    !requiresVisualExplanation(vu)
  ) {
    return "template_only";
  }

  return "deepseek_plan";
}
```

`requiresVisualExplanation(vu)` 可以先用规则判断：

- `attention_owner` 是 `board`、`diagram`、`mixed`
- `presentation_strategy` 包含：总览、机制、决策树、路径、风险、数字披露、替代、因果链、误区翻转
- `internal_beats.length >= 2`
- `one_screen_message` 里有数字、条件、风险、机制词

---

## 4. DeepSeek 输出什么

DeepSeek 输出 VUPlan JSON，不输出代码。

```ts
interface VUPlan {
  vu_id: string;
  llm_policy: "deepseek_plan";
  presentation_family:
    | "overview_data"
    | "risk_stack"
    | "decision_tree"
    | "closed_loop_board"
    | "case_narrative"
    | "mechanism_chain"
    | "myth_flip"
    | "replacement_compare"
    | "concept_balance"
    | "action_path"
    | "data_pop"
    | "mechanism_warning"
    | "value_summary";
  render_strategy:
    | "remotion_structural"
    | "structured_hybrid"
    | "image_first_hybrid"
    | "source_video_overlay";
  beats: VUBeatPlan[];
  elements: VUElement[];
  asset_requests: AssetRequest[];
  layout_contract: LayoutContract;
  editor_notes?: string[];
}
```

DeepSeek 的职责：

- 判断 VU 内哪些元素是主角。
- 为每个 beat 分配元素出现、折叠、淡出。
- 给素材需求写 `asset_requests`。
- 给出 family 和 render strategy。
- 遵守平台安全区。

DeepSeek 不做：

- 不写 React。
- 不写 CSS 绝对坐标。
- 不生成最终中文排版图。
- 不决定是否保留/删除原视频时间轴。

---

## 5. Element Budget

每个 VU 必须有元素预算，否则画面会挤。

```ts
interface VUElement {
  id: string;
  role:
    | "subject"
    | "claim"
    | "structure"
    | "evidence"
    | "data"
    | "mechanism"
    | "annotation"
    | "subtitle";
  priority: "critical" | "high" | "medium" | "low";
  asset_slot?: string;
  text?: string;
  visible_beats: string[];
  enter_anim?: "pop" | "slide" | "fade" | "draw" | "count_up" | "magic_move";
  fold_rule?: {
    beat_id: string;
    scale: number;
    opacity: number;
    reason: string;
  };
}
```

原则：

- `critical` 最多 1-2 个。
- 同一 beat 同屏主读元素最多 3 个。
- 下半屏元素右边界必须小于 920px，避免短视频平台右栏。
- 底部只放真实字幕和免责声明，不放主信息。
- 如果元素超过预算，低优先级元素必须折叠、淡出或转为小标注。

---

## 6. 素材替换接口

模板不能写死 emoji。每个视觉对象都走 `asset_slot`。

```ts
interface AssetSlot {
  slot_id: string;          // "fish_oil_capsule"
  semantic_label: string;   // "鱼油胶囊"
  accepted_types: ("image" | "video" | "icon" | "emoji")[];
  fallback: {
    type: "emoji" | "icon";
    value: string;
  };
  placement_hint?: "left" | "right" | "center" | "background" | "evidence_panel";
}
```

示例：

```json
{
  "slot_id": "fish_oil_capsule",
  "semantic_label": "鱼油胶囊",
  "accepted_types": ["image", "icon", "emoji"],
  "fallback": { "type": "emoji", "value": "🐟" },
  "placement_hint": "subject"
}
```

以后替换真实图片时，不改 renderer，只改 asset binding：

```json
{
  "slot_id": "fish_oil_capsule",
  "asset_id": "team_asset_fishoil_png_001",
  "type": "image",
  "path": "P:/.../fish_oil_capsule.png",
  "fit": "contain",
  "background_removed": true
}
```

---

## 7. RAG 素材接口

机制讲解优先走 RAG 系统找真实素材。

```ts
interface AssetRequest {
  request_id: string;
  slot_id: string;
  query_zh: string;
  query_en?: string;
  intent:
    | "medical_animation"
    | "product_photo"
    | "object_cutout"
    | "case_scene"
    | "background"
    | "icon";
  required: boolean;
  usage:
    | "main_evidence"
    | "background_context"
    | "subject_icon"
    | "mechanism_insert";
  min_duration_sec?: number;
  preferred_aspect?: "16:9" | "1:1" | "9:16" | "transparent_png";
}
```

RAG 返回候选：

```ts
interface AssetCandidate {
  asset_id: string;
  source: "rag" | "team_library" | "generated" | "manual";
  path: string;
  type: "image" | "video" | "icon";
  score: number;
  tags: string[];
  sub_scene?: string;
  license_note?: string;
}
```

Renderer 只吃最终绑定：

```ts
interface ResolvedAssetBinding {
  slot_id: string;
  candidate: AssetCandidate | null;
  fallback_used: boolean;
}
```

这样 SVU05 里现在的鱼油 emoji、心脏 emoji，将来可以替换为：

- 鱼油透明 PNG
- 药瓶产品照片
- Nucleus 房颤动画
- RAG 检索到的真实医学机制素材

而不需要改 VUPlan 的结构。

---

## 8. 剪映草稿输出策略

最终不是只输出 mp4，而是输出剪映草稿，所以每种 LLM 策略进入草稿的方式不同。

### `skip_llm`

轨道：

- source video
- real subtitles
- VU marker / editor note

剪辑师处理：

- 加花字
- 加贴纸
- 加轻量强调

### `template_only`

轨道：

- source video
- subtitles
- deterministic overlay mp4 或 text layers
- editor note

剪辑师处理：

- 替换风格
- 加强花字

### `deepseek_plan`

轨道：

- source video
- subtitles
- Remotion overlay mp4
- resolved asset media
- editor note
- debug VU marker

剪辑师处理：

- 替换真实素材
- 调整局部节奏
- 改文字风格

---

## 9. 对 mianyili_03 的反推结果

| VU | 策略 | 原因 |
|---|---|---|
| SVU01 | `template_only` | 开场反差，固定双栏对比可解决 |
| SVU02 | `skip_llm` | 医生警示口播 |
| SVU03 | `template_only` | 标题揭示 |
| SVU04 | `skip_llm` | 医生悬念口播 |
| SVU05 | `deepseek_plan` | 鱼油总览、风险数字、素材折叠 |
| SVU06 | `deepseek_plan` | 案例叙事，需要场景/心电图/鱼油关系 |
| SVU07 | `deepseek_plan` | 药物叠加风险 |
| SVU08 | `deepseek_plan` | 决策树 |
| SVU09 | `deepseek_plan` | 牛初乳卖点-错配-替代闭环 |
| SVU10 | `template_only` | 对象登场 + 定性 |
| SVU11 | `deepseek_plan` | 机制因果链 |
| SVU12 | `deepseek_plan` | 误区翻转 |
| SVU13 | `deepseek_plan` | 替代对比，可接真实素材 |
| SVU14 | `deepseek_plan` | 免疫平衡概念模型 |
| SVU15 | `template_only` | 极短行动标题 |
| SVU16 | `deepseek_plan` | 行动路径 + 条件分支 |
| SVU17 | `deepseek_plan` | 数字披露 + 强度判定 |
| SVU18 | `deepseek_plan` | 睡眠修复机制 |
| SVU19 | `deepseek_plan` | 总结价值替换，素材可丰富 |
| SVU20 | `skip_llm` | 医生 CTA 口播 |

这一轮 20 个 demo 里，真正应该调 DeepSeek 的大约 13 个，不是 20 个。

---

## 10. MVP 实现顺序

1. 新增 VU schema：`VisualUnit`、`VUPlan`、`AssetSlot`、`AssetRequest`。
2. 实现 `routeVisualUnit(vu)`，输出三类策略。
3. 把 `mianyili_03.visual_units.state_v4.manual.json` 跑一遍 router，生成 `vu_render_jobs.json`。
4. 对 `skip_llm` 生成剪映草稿 marker，不调 DeepSeek。
5. 对 `template_only` 走固定模板。
6. 对 `deepseek_plan` 写 DeepSeek prompt，只要求 JSON。
7. 实现 `AssetResolver`：先接 RAG 候选，找不到用 fallback。
8. 把当前 20 个 demo 反向整理成 family renderer registry。

最重要的验收标准：

- DeepSeek 调用次数明显减少。
- 解释型 VU 的画面连续性比 Step2 强。
- 医生口播段不再生成多余 overlay。
- 素材替换不需要改代码。
- 剪映草稿可让剪辑师继续调。
