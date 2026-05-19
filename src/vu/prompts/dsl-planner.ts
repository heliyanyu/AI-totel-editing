import type { VURenderJob } from "../schema";

/**
 * DSL planner prompt — instructs DeepSeek to output an executable timeline DSL.
 *
 * The DSL is a small, constrained vocabulary that the renderer can execute faithfully.
 * The LLM does NOT pick coordinates or frames — it picks zones (named anchors per
 * family) and times relative to beats.
 */

const FAMILY_SVU05_ZONE_DOC = `
zones (family=svu05) — 1080x1920 canvas, anchor=center, x/y are anchor coordinates:
  stage_center
  hero_left, hero_right, hero_center
  below_hero_left, below_hero_right, below_hero_center
  above_hero_center
  left_top_small, right_top_small
  left_panel, right_panel, right_panel_overlay
  left_number_band, right_number_band
  left_bottom_band, right_bottom_band
  off_stage_bottom, off_stage_top

Zone size hints (approximate occupied area per zone):
  hero_* and stage_center                -> medium element, ~500×400 footprint
  left_panel / right_panel               -> LARGE block, ~500×700 footprint (used by video_panel / numbered_list)
  *_top_small / *_number_band            -> small element, ~400×300 footprint
  *_bottom_band                          -> data_card or citation, ~480×140 footprint
  below_hero_*                           -> small text_card, ~600×140 footprint

ZONE GROUPING — zones in the same vertical column overlap each other:
  LEFT COLUMN  : hero_left, below_hero_left, left_top_small, left_panel, left_number_band, left_bottom_band
  RIGHT COLUMN : hero_right, below_hero_right, right_top_small, right_panel, right_number_band, right_bottom_band
  CENTER COLUMN: hero_center, below_hero_center, above_hero_center, stage_center
`.trim();

const VOCABULARY_DOC = `
Vocabulary — strict, no inventing new verbs/types/zones:

ELEMENT TYPES (pick one per element):
  emoji          { content: "🐟" }
  text_card      { text, tone: "neutral"|"brand"|"danger"|"positive"|"warning"|"info" }
  numbered_list  { prefix_word?: "问题"|"步骤"|..., items: [{label, highlight_at?}, ...] }
  big_number     { prefix?, value: number, suffix?, annotation_above?, annotation_below?, tone? }
  video_panel    { asset_slot, label?, fallback_emoji? }   # only when input asset_slots provides the slot; copy fallback_emoji from input
  svg_path       { preset: "ecg_chaotic"|"arrow_right"|"curve_up"|"curve_down", stroke? }
  data_card      { title, primary, meta? }

VERBS (timeline actions):
  PopIn        { el, at_zone, scale? }            # element enters with overshoot
  MagicMove    { el, to_zone, scale? }            # smooth slide+scale to new position
  StackReveal  { el, at_zone }                    # for numbered_list, items stagger in
  PathDraw     { el, at_zone?, duration_s? }      # for svg_path, stroke draws progressively
  CountUp      { el, from, to, duration_s? }      # for big_number, animate the value
  Fade         { el, to: 0|1, at_zone?, duration_s? }   # opacity tween
  Strike       { el, duration_s? }                # for text_card, line draws across
  Collapse     { el, to_scale, to_zone }          # shrink+reposition to make room
  SetState     { el: "list_id.items[idx]" }       # mark a list item active

TIME REFS (relative to beat boundaries; NEVER write frame numbers):
  "b1+0.0s"  -> start of beat 1
  "b2+1.3s"  -> 1.3s after start of beat 2
  "b3-0.2s"  -> 0.2s before END of beat 3
`.trim();

const DESIGN_PRINCIPLES = `
Design principles (these come from successful demos — apply strictly):

ELEMENT TYPE PICKING:
- big_number is ONLY for data emphasis with a numeric value (e.g. "+10%", "150g", "1/3"). DO NOT use it for chapter ordinals like "第4" or "第三". For ordinals use a text_card with the ordinal as part of normal text, or skip the ordinal entirely.
- numbered_list is for 2-5 parallel sub-points. If the VU has 3+ parallel items (e.g. "三件事", "三个方法"), prefer numbered_list + StackReveal over 3 separate text_cards.
- text_card holds short statements ≤ 16 Chinese chars per line. Use "\\n" inside the string only when you need an explicit line break. Long sentences should be split across multiple beats, not crammed into one card.
- video_panel is only when an asset_slot exists in the input — never invent slot names.
- svg_path with preset is for mechanism visuals (curves, arrows, ECG). PathDraw it for emphasis.

MOTION CHOREOGRAPHY:
- A "claim → debunk" pattern: text_card + Strike + Fade-out.
- A "list reveal" pattern: numbered_list + StackReveal (NOT 3 separate PopIn'd text_cards).
- A "focus" pattern: Collapse old context + PopIn focal element + CountUp/PathDraw on it.
- A subject element should persist across beats via MagicMove rather than Fade-out + new PopIn.
- Use SetState { el: "list_id.items[idx]" } to highlight a list item at a key moment.
- Aim for at least 4 distinct verb types in a >10s VU. Plain PopIn+Fade alone is forbidden — it looks like a PPT.

LAYOUT — STRICT ZONE-COLLISION RULES:
- Max 3 reading elements visible at once. When new info arrives, Collapse or Fade old ones.
- ZONES IN THE SAME COLUMN COLLIDE. Two elements visible at the same time MUST be in different columns (left vs right, or one in center while the other in left/right). NEVER place two simultaneously-visible elements both in the LEFT column or both in the RIGHT column.
- video_panel and numbered_list are LARGE blocks (~500×700). Treat each as occupying the entire column it sits in. Never place a text_card in the same column as a visible video_panel or visible numbered_list during the same beat.
- If a beat has a video_panel at left_panel, its companion text_card / numbered_list / big_number MUST be on the RIGHT column (right_panel, right_number_band, etc.) or in a non-overlapping center band.
- Before Collapse'ing an element out of a column, you may not PopIn a new element in that same column for at least 0.4s — give the collapse time to play.
- Right rail >= 940px is reserved for platform UI — never place primary info in a zone whose x >= 940.
- Bottom 1490-1620 is subtitle band — do not place elements that overlap subtitle area.
- 主播 / 原视频 are NOT part of overlay — do not generate elements for the doctor talking head.
- Citation / data source appears late, small, low priority.

ASSET SLOTS:
- For every video_panel you create, COPY the matching fallback_emoji from the input asset_slots into the element. Example: input has { slot_id: "kidney_anatomy", fallback_emoji: "🫘" } → output element { type: "video_panel", asset_slot: "kidney_anatomy", fallback_emoji: "🫘", label: "肾脏" }.
`.trim();

const SCHEMA_DOC = `
Output JSON shape (no markdown, no prose, no code fences):
{
  "vu_id": "<copy from input>",
  "llm_policy": "deepseek_plan",
  "presentation_family": "<copy from input>",
  "render_strategy": "<copy from input>",
  "dsl": {
    "vu_id": "<same as outer>",
    "duration_s": <number, total VU duration>,
    "family": "svu05",
    "beats": [
      { "id": "b1", "start_s": 0,   "end_s": <number>, "narrative": "<one-line beat purpose>" },
      ...
    ],
    "elements": [
      { "id": "<snake_case>", "type": "<element type>", ...type-specific fields },
      ...
    ],
    "timeline": [
      { "at": "b1+0.0s", "do": "PopIn", "el": "<element_id>", "at_zone": "<zone>", "scale": <optional> },
      ...
    ]
  }
}
`.trim();

const FEW_SHOT_SVU05 = `
EXAMPLE — a claim-debunk + reveal + data + mechanism VU (~18s, 3 beats):

INPUT VU (abbreviated):
  one_screen_message: "鱼油不是护心神药：房颤 +10%"
  presentation_strategy: "机制 + 警示"
  duration: 18.6
  internal_beats:
    - large_text: "鱼油被奉为护心神药"
    - large_text: "医生提醒：两个问题"
    - large_text: "每多 1g 鱼油 → 房颤 +10%"

OUTPUT:
{
  "vu_id": "SVU05",
  "llm_policy": "deepseek_plan",
  "presentation_family": "mechanism_warning",
  "render_strategy": "structured_hybrid",
  "dsl": {
    "vu_id": "SVU05",
    "duration_s": 18.6,
    "family": "svu05",
    "beats": [
      { "id": "b1", "start_s": 0.0,  "end_s": 4.6,  "narrative": "鱼油被奉为护心神药" },
      { "id": "b2", "start_s": 4.6,  "end_s": 9.8,  "narrative": "医生指出两个问题" },
      { "id": "b3", "start_s": 9.8,  "end_s": 18.6, "narrative": "+10% 房颤风险" }
    ],
    "elements": [
      { "id": "fish_oil",   "type": "emoji",     "content": "🐟" },
      { "id": "claim_card", "type": "text_card", "text": "护心神药？", "tone": "brand" },
      { "id": "problems",   "type": "numbered_list",
        "prefix_word": "问题",
        "items": [
          { "label": "房颤风险", "highlight_at": "b3+0.3s" },
          { "label": "出血叠加" }
        ]
      },
      { "id": "pct", "type": "big_number",
        "prefix": "+", "value": 10, "suffix": "%",
        "annotation_above": "每多 1g 鱼油",
        "annotation_below": "房颤风险增量",
        "tone": "danger"
      },
      { "id": "ecg", "type": "svg_path", "preset": "ecg_chaotic", "stroke": "#FFFFFF" },
      { "id": "src", "type": "data_card",
        "title": "DATA SOURCE",
        "primary": "Gencer et al. Circulation 2021",
        "meta": "n=81,210 · meta-analysis"
      }
    ],
    "timeline": [
      { "at": "b1+0.0s", "do": "PopIn",       "el": "fish_oil",   "at_zone": "hero_right", "scale": 2.4 },
      { "at": "b1+1.0s", "do": "PopIn",       "el": "claim_card", "at_zone": "below_hero_right" },
      { "at": "b2+0.0s", "do": "Strike",      "el": "claim_card", "duration_s": 0.6 },
      { "at": "b2+0.5s", "do": "Fade",        "el": "claim_card", "to": 0, "duration_s": 0.7 },
      { "at": "b2+0.8s", "do": "StackReveal", "el": "problems",   "at_zone": "left_panel" },
      { "at": "b2+1.3s", "do": "MagicMove",   "el": "fish_oil",   "to_zone": "right_top_small", "scale": 0.85 },
      { "at": "b3+0.0s", "do": "Fade",        "el": "fish_oil",   "to": 0, "duration_s": 0.4 },
      { "at": "b3+0.8s", "do": "Collapse",    "el": "problems",   "to_scale": 0.62, "to_zone": "left_top_small" },
      { "at": "b3+1.0s", "do": "PathDraw",    "el": "ecg",        "at_zone": "right_panel_overlay", "duration_s": 1.2 },
      { "at": "b3+1.4s", "do": "PopIn",       "el": "pct",        "at_zone": "left_number_band" },
      { "at": "b3+1.5s", "do": "CountUp",     "el": "pct",        "from": 0, "to": 10, "duration_s": 0.9 },
      { "at": "b3+4.5s", "do": "PopIn",       "el": "src",        "at_zone": "right_bottom_band" }
    ]
  }
}
`.trim();

export function buildDslPlannerPrompt(job: VURenderJob): string {
  const jobView = {
    vu_id: job.vu_id,
    presentation_family: job.presentation_family,
    render_strategy: job.render_strategy,
    duration_s: job.source_vu.duration,
    one_screen_message: job.source_vu.one_screen_message,
    presentation_strategy: job.source_vu.presentation_strategy,
    attention_owner: job.source_vu.attention_owner,
    audience_state_from: job.source_vu.audience_state_from,
    audience_state_to: job.source_vu.audience_state_to,
    communicative_goal: job.source_vu.communicative_goal,
    internal_beats: job.source_vu.internal_beats,
    asset_slots: job.asset_slots.map((slot) => ({
      slot_id: slot.slot_id,
      semantic_label: slot.semantic_label,
      fallback_emoji: slot.fallback?.value,
    })),
  };

  return [
    "你是短视频医学科普 VU 镜头脚本规划器。",
    "你只输出严格 JSON，不要解释，不要 markdown 代码块。",
    "你不写 React，不写 CSS。你输出一个可执行的时间线 DSL，渲染器按 DSL 执行。",
    "",
    VOCABULARY_DOC,
    "",
    FAMILY_SVU05_ZONE_DOC,
    "",
    DESIGN_PRINCIPLES,
    "",
    SCHEMA_DOC,
    "",
    FEW_SHOT_SVU05,
    "",
    "现在的 VU 输入：",
    JSON.stringify(jobView, null, 2),
    "",
    "请只输出 JSON object，符合上面的 shape 和词汇表。",
  ].join("\n");
}
