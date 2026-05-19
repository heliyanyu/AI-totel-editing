import { z } from "zod";

import { DSLDocSchema } from "./dsl/schema";

export const VisualUnitTimeSchema = z.object({
  start: z.number(),
  end: z.number(),
});
export type VisualUnitTime = z.infer<typeof VisualUnitTimeSchema>;

export const InternalBeatSchema = z.object({
  covers: z.array(z.string()).optional(),
  large_text: z.string().optional(),
  visual: z.string().optional(),
});
export type InternalBeat = z.infer<typeof InternalBeatSchema>;

export const VisualUnitSchema = z.object({
  id: z.string(),
  time: VisualUnitTimeSchema,
  duration: z.number(),
  covers: z.array(z.string()),
  audience_state_from: z.string(),
  audience_state_to: z.string(),
  communicative_goal: z.string(),
  attention_owner: z.string(),
  presentation_strategy: z.string(),
  one_screen_message: z.string(),
  merge_basis: z.string().optional(),
  split_after: z.string().optional(),
  internal_beats: z.array(InternalBeatSchema).optional(),
});
export type VisualUnit = z.infer<typeof VisualUnitSchema>;

export const LlmPolicySchema = z.enum(["skip_llm", "template_only", "deepseek_plan"]);
export type LlmPolicy = z.infer<typeof LlmPolicySchema>;

export const PresentationFamilySchema = z.enum([
  "doctor_talk",
  "suspense_talk",
  "doctor_cta",
  "comparison_split",
  "kinetic_title",
  "object_shock_title",
  "pivot_title",
  "overview_data",
  "case_narrative",
  "risk_stack",
  "decision_tree",
  "closed_loop_board",
  "mechanism_chain",
  "myth_flip",
  "replacement_compare",
  "concept_balance",
  "action_path",
  "data_pop",
  "mechanism_warning",
  "value_summary",
]);
export type PresentationFamily = z.infer<typeof PresentationFamilySchema>;

export const RenderStrategySchema = z.enum([
  "source_video_overlay",
  "remotion_text",
  "remotion_structural",
  "structured_hybrid",
  "image_first_hybrid",
]);
export type RenderStrategy = z.infer<typeof RenderStrategySchema>;

export const AssetSlotSchema = z.object({
  slot_id: z.string(),
  semantic_label: z.string(),
  accepted_types: z.array(z.enum(["image", "video", "icon", "emoji"])),
  fallback: z.object({
    type: z.enum(["emoji", "icon"]),
    value: z.string(),
  }),
  placement_hint: z
    .enum(["left", "right", "center", "background", "evidence_panel", "subject"])
    .optional(),
});
export type AssetSlot = z.infer<typeof AssetSlotSchema>;

export const AssetRequestSchema = z.object({
  request_id: z.string(),
  slot_id: z.string(),
  query_zh: z.string(),
  query_en: z.string().optional(),
  intent: z.enum([
    "medical_animation",
    "product_photo",
    "object_cutout",
    "case_scene",
    "background",
    "icon",
  ]),
  required: z.boolean(),
  usage: z.enum(["main_evidence", "background_context", "subject_icon", "mechanism_insert"]),
  min_duration_sec: z.number().optional(),
  preferred_aspect: z.enum(["16:9", "1:1", "9:16", "transparent_png"]).optional(),
});
export type AssetRequest = z.infer<typeof AssetRequestSchema>;

export const VUElementSchema = z.object({
  id: z.string(),
  role: z.enum([
    "subject",
    "claim",
    "structure",
    "evidence",
    "data",
    "mechanism",
    "annotation",
    "subtitle",
  ]),
  priority: z.enum(["critical", "high", "medium", "low"]),
  asset_slot: z.string().optional(),
  text: z.string().optional(),
  visible_beats: z.array(z.string()),
  enter_anim: z
    .enum(["pop", "slide", "fade", "draw", "count_up", "magic_move"])
    .optional(),
  fold_rule: z
    .object({
      beat_id: z.string(),
      scale: z.number(),
      opacity: z.number(),
      reason: z.string(),
    })
    .optional(),
});
export type VUElement = z.infer<typeof VUElementSchema>;

export const LayoutContractSchema = z.object({
  right_rail_reserved: z.literal(true),
  subtitle_band_reserved: z.literal(true),
  bottom_disclaimer_only: z.literal(true),
  max_lower_screen_right_x: z.number().default(920),
  primary_info_y_range: z.tuple([z.number(), z.number()]).default([180, 1320]),
  subtitle_y_range: z.tuple([z.number(), z.number()]).default([1490, 1620]),
});
export type LayoutContract = z.infer<typeof LayoutContractSchema>;

export const VURenderJobSchema = z.object({
  vu_id: z.string(),
  llm_policy: LlmPolicySchema,
  presentation_family: PresentationFamilySchema,
  render_strategy: RenderStrategySchema,
  source_vu: VisualUnitSchema,
  asset_slots: z.array(AssetSlotSchema),
  asset_requests: z.array(AssetRequestSchema),
  editor_notes: z.array(z.string()),
});
export type VURenderJob = z.infer<typeof VURenderJobSchema>;

export const VUBeatPlanSchema = z.object({
  id: z.string(),
  source_covers: z.array(z.string()).optional(),
  start_ratio: z.number().min(0).max(1),
  end_ratio: z.number().min(0).max(1),
  large_text: z.string(),
  visual_goal: z.string(),
  active_elements: z.array(z.string()),
});
export type VUBeatPlan = z.infer<typeof VUBeatPlanSchema>;

export const VUPlanSchema = z.object({
  vu_id: z.string(),
  llm_policy: z.literal("deepseek_plan"),
  presentation_family: PresentationFamilySchema,
  render_strategy: RenderStrategySchema,
  beats: z.array(VUBeatPlanSchema).optional().default([]),
  elements: z.array(VUElementSchema).optional().default([]),
  asset_requests: z.array(AssetRequestSchema).optional().default([]),
  layout_contract: LayoutContractSchema.optional(),
  motion_script: z.array(z.unknown()).optional(),
  editor_notes: z.array(z.string()).optional(),
  dsl: DSLDocSchema.optional(),
});
export type VUPlan = z.infer<typeof VUPlanSchema>;

export const VisualUnitFileSchema = z.object({
  source: z.record(z.unknown()).optional(),
  visual_units: z.array(VisualUnitSchema),
});
export type VisualUnitFile = z.infer<typeof VisualUnitFileSchema>;
