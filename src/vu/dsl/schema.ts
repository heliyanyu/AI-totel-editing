import { z } from "zod";

export const TimeRefSchema = z.string().regex(/^b\d+[+-]\d+(?:\.\d+)?s$/);
export type TimeRef = z.infer<typeof TimeRefSchema>;

export const ToneSchema = z.enum([
  "neutral",
  "brand",
  "danger",
  "positive",
  "warning",
  "info",
]);
export type Tone = z.infer<typeof ToneSchema>;

const ElementBase = z.object({ id: z.string() });

export const EmojiElementSchema = ElementBase.extend({
  type: z.literal("emoji"),
  content: z.string(),
  base_scale: z.number().optional(),
});
export type EmojiElement = z.infer<typeof EmojiElementSchema>;

export const TextCardElementSchema = ElementBase.extend({
  type: z.literal("text_card"),
  text: z.string(),
  tone: ToneSchema.optional(),
});
export type TextCardElement = z.infer<typeof TextCardElementSchema>;

export const NumberedListItemSchema = z.object({
  label: z.string(),
  highlight_at: TimeRefSchema.optional(),
});
export type NumberedListItem = z.infer<typeof NumberedListItemSchema>;

export const NumberedListElementSchema = ElementBase.extend({
  type: z.literal("numbered_list"),
  items: z.array(NumberedListItemSchema),
  prefix_word: z.string().optional(),
});
export type NumberedListElement = z.infer<typeof NumberedListElementSchema>;

export const BigNumberElementSchema = ElementBase.extend({
  type: z.literal("big_number"),
  prefix: z.string().optional(),
  value: z.number(),
  suffix: z.string().optional(),
  annotation_above: z.string().optional(),
  annotation_below: z.string().optional(),
  tone: ToneSchema.optional(),
});
export type BigNumberElement = z.infer<typeof BigNumberElementSchema>;

export const VideoPanelElementSchema = ElementBase.extend({
  type: z.literal("video_panel"),
  asset_slot: z.string(),
  label: z.string().optional(),
  fallback_emoji: z.string().optional(),
});
export type VideoPanelElement = z.infer<typeof VideoPanelElementSchema>;

export const SvgPathPresetSchema = z.enum([
  "ecg_chaotic",
  "arrow_right",
  "curve_up",
  "curve_down",
]);
export type SvgPathPreset = z.infer<typeof SvgPathPresetSchema>;

export const SvgPathElementSchema = ElementBase.extend({
  type: z.literal("svg_path"),
  preset: SvgPathPresetSchema.optional(),
  d: z.string().optional(),
  stroke: z.string().optional(),
  stroke_width: z.number().optional(),
});
export type SvgPathElement = z.infer<typeof SvgPathElementSchema>;

export const DataCardElementSchema = ElementBase.extend({
  type: z.literal("data_card"),
  title: z.string(),
  primary: z.string(),
  meta: z.string().optional(),
});
export type DataCardElement = z.infer<typeof DataCardElementSchema>;

export const DSLElementSchema = z.discriminatedUnion("type", [
  EmojiElementSchema,
  TextCardElementSchema,
  NumberedListElementSchema,
  BigNumberElementSchema,
  VideoPanelElementSchema,
  SvgPathElementSchema,
  DataCardElementSchema,
]);
export type DSLElement = z.infer<typeof DSLElementSchema>;

export const DSLBeatSchema = z.object({
  id: z.string(),
  start_s: z.number(),
  end_s: z.number(),
  narrative: z.string().optional(),
});
export type DSLBeat = z.infer<typeof DSLBeatSchema>;

export const VerbSchema = z.enum([
  "PopIn",
  "MagicMove",
  "StackReveal",
  "PathDraw",
  "CountUp",
  "Fade",
  "Strike",
  "Collapse",
  "SetState",
]);
export type Verb = z.infer<typeof VerbSchema>;

export const DSLActionSchema = z.object({
  at: TimeRefSchema,
  do: VerbSchema,
  el: z.string(),
  at_zone: z.string().optional(),
  to_zone: z.string().optional(),
  scale: z.number().optional(),
  to_scale: z.number().optional(),
  to: z.number().optional(),
  from: z.number().optional(),
  duration_s: z.number().optional(),
  stagger_s: z.number().optional(),
});
export type DSLAction = z.infer<typeof DSLActionSchema>;

export const DSLDocSchema = z.object({
  vu_id: z.string(),
  duration_s: z.number(),
  family: z.string(),
  beats: z.array(DSLBeatSchema),
  elements: z.array(DSLElementSchema),
  timeline: z.array(DSLActionSchema),
});
export type DSLDoc = z.infer<typeof DSLDocSchema>;
