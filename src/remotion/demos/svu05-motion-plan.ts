export type SlotName =
  | "topProgress"
  | "centerHero"
  | "leftStructure"
  | "rightEvidence"
  | "presenterLeftBottom"
  | "sourceNote"
  | "subtitleBand"
  | "platformTitle"
  | "rightRail";

export interface SlotRect {
  x: number;
  y: number;
  w: number;
  h: number;
  description: string;
}

export interface MotionElement {
  id: string;
  role: "subject" | "claim" | "structure" | "evidence" | "data_bomb" | "source" | "subtitle";
  priority: "low" | "medium" | "high" | "critical";
  slot: SlotName;
  visibleBeats: string[];
  behavior: "persist" | "fold" | "enter_exit" | "replace";
  neverOverlapSlots?: SlotName[];
  notes: string;
}

export interface MotionBeat {
  id: string;
  start: number;
  end: number;
  goal: string;
  activeElements: string[];
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  highlight: string;
}

export const svu05MotionPlan = {
  id: "SVU05",
  title: "鱼油不是护心神药：房颤 +10%",
  durationFrames: 558,
  fps: 30,
  platformLayout: "douyin_9x16_safe",
  rules: [
    "rightRail is reserved for platform actions; no semantic element may enter it.",
    "subtitleBand is reserved for real subtitles; charts, cards, and evidence cannot enter it.",
    "platformTitle is disposable; only legal/disclaimer text may be placed there.",
    "presenterLeftBottom must stay below the main stage and must not consume evidence space.",
    "when a new critical element enters, previous structure elements fold or exit.",
  ],
  slots: {
    topProgress: {
      x: 36,
      y: 34,
      w: 860,
      h: 114,
      description: "compact scene progress; does not explain content",
    },
    centerHero: {
      x: 80,
      y: 360,
      w: 920,
      h: 720,
      description: "beat-1 only: hero question + subject emoji + cross-out animation",
    },
    leftStructure: {
      x: 44,
      y: 190,
      w: 420,
      h: 890,
      description: "left-to-right reading start: problem board and +10%",
    },
    rightEvidence: {
      x: 500,
      y: 190,
      w: 420,
      h: 890,
      description: "evidence material only; Nucleus video gets an unobstructed window",
    },
    presenterLeftBottom: {
      x: 36,
      y: 1138,
      w: 340,
      h: 430,
      description: "doctor half-body/keyed video placeholder",
    },
    sourceNote: {
      x: 430,
      y: 1180,
      w: 462,
      h: 180,
      description: "small evidence/source note above subtitles",
    },
    subtitleBand: {
      x: 44,
      y: 1490,
      w: 850,
      h: 130,
      description: "real spoken subtitles; far enough from platformTitle to remain readable",
    },
    platformTitle: {
      x: 0,
      y: 1788,
      w: 1080,
      h: 132,
      description: "platform title/comment overlay; only tiny disclaimer is allowed",
    },
    rightRail: {
      x: 930,
      y: 180,
      w: 150,
      h: 1360,
      description: "like/comment/favorite/share rail",
    },
  } satisfies Record<SlotName, SlotRect>,
  beats: [
    {
      id: "beat1_claim",
      start: 0,
      end: 138,
      goal: "make the audience recognize the public claim: fish oil is treated as heart-protective",
      activeElements: ["fish_oil_icon", "claim_card"],
    },
    {
      id: "beat2_flag",
      start: 138,
      end: 294,
      goal: "replace the claim with a structured warning: fish oil has two problems",
      activeElements: ["fish_oil_icon", "problem_board"],
    },
    {
      id: "beat3_evidence",
      start: 294,
      end: 558,
      goal: "turn the first problem into evidence: each extra 1g is associated with +10% atrial fibrillation risk",
      activeElements: ["problem_board", "ten_percent", "afib_video", "source_note"],
    },
  ] satisfies MotionBeat[],
  elements: [
    {
      id: "fish_oil_icon",
      role: "subject",
      priority: "high",
      slot: "rightEvidence",
      visibleBeats: ["beat1_claim", "beat2_flag", "beat3_evidence"],
      behavior: "persist",
      neverOverlapSlots: ["rightRail", "subtitleBand"],
      notes: "MagicMove across beats; folds to a small context marker when evidence takes over.",
    },
    {
      id: "claim_card",
      role: "claim",
      priority: "high",
      slot: "centerHero",
      visibleBeats: ["beat1_claim"],
      behavior: "enter_exit",
      neverOverlapSlots: ["subtitleBand"],
      notes: "Beat-1 hero question card; centered with fish-oil icon, then crossed out at end of beat.",
    },
    {
      id: "cross_mark",
      role: "claim",
      priority: "high",
      slot: "centerHero",
      visibleBeats: ["beat1_claim"],
      behavior: "enter_exit",
      neverOverlapSlots: ["subtitleBand"],
      notes: "Big red X drawn over the hero card in the last 1.5s of beat-1, killing the myth.",
    },
    {
      id: "problem_board",
      role: "structure",
      priority: "high",
      slot: "leftStructure",
      visibleBeats: ["beat2_flag", "beat3_evidence"],
      behavior: "fold",
      neverOverlapSlots: ["rightEvidence", "subtitleBand"],
      notes: "Full-size in beat2, folded at beat3 to leave space for the +10% data bomb.",
    },
    {
      id: "ten_percent",
      role: "data_bomb",
      priority: "critical",
      slot: "leftStructure",
      visibleBeats: ["beat3_evidence"],
      behavior: "replace",
      neverOverlapSlots: ["rightEvidence", "subtitleBand"],
      notes: "Critical data element, never shares its slot with the evidence video.",
    },
    {
      id: "afib_video",
      role: "evidence",
      priority: "critical",
      slot: "rightEvidence",
      visibleBeats: ["beat3_evidence"],
      behavior: "replace",
      neverOverlapSlots: ["leftStructure", "subtitleBand", "rightRail"],
      notes: "Nucleus atrial-fibrillation video, unobstructed; no text overlays on top.",
    },
    {
      id: "source_note",
      role: "source",
      priority: "low",
      slot: "sourceNote",
      visibleBeats: ["beat3_evidence"],
      behavior: "enter_exit",
      neverOverlapSlots: ["subtitleBand"],
      notes: "Small provenance note; it must not compete with subtitles.",
    },
  ] satisfies MotionElement[],
  subtitles: [
    { start: 0, end: 92, text: "鱼油在很多人心目中，\n简直就是护心神药。", highlight: "护心神药" },
    { start: 92, end: 174, text: "作为医生，我得讲清楚，\n鱼油天生有两个问题。", highlight: "两个问题" },
    { start: 174, end: 306, text: "第一个，可能增加\n房颤风险。", highlight: "房颤风险" },
    { start: 306, end: 432, text: "有研究数据显示，\n每多吃一克鱼油，", highlight: "每多吃一克" },
    { start: 432, end: 558, text: "房颤风险\n增加百分之十。", highlight: "百分之十" },
  ] satisfies SubtitleCue[],
} as const;
