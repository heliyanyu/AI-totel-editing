// SVU07 motion plan — presentation_family: multi_factor_stack
//
// V4 cut spec:
//   id: SVU07
//   time: 56.96-70.32s (13.36s, 401 frames @ 30fps)
//   attention_owner: diagram
//   presentation_strategy: 多因素累积屏
//   one_screen_message: "抗凝药再叠鱼油，出血风险升"
//   internal_beats:
//     1. "正在吃这些药？" — 阿司匹林、氯吡格雷、利伐沙班依次入栈
//     2. "再加鱼油" — 鱼油叠到药物堆上
//     3. "胃出血/脑出血风险上升" — 风险条变红上升

export type Svu07SlotName =
  | "topProgress"
  | "stackHeader"
  | "pillStack"
  | "riskZone"
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
  role:
    | "subject"
    | "claim"
    | "structure"
    | "evidence"
    | "data_bomb"
    | "source"
    | "subtitle";
  priority: "low" | "medium" | "high" | "critical";
  slot: Svu07SlotName;
  visibleBeats: string[];
  behavior: "persist" | "fold" | "enter_exit" | "replace";
  neverOverlapSlots?: Svu07SlotName[];
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

export const svu07MotionPlan = {
  id: "SVU07",
  title: "抗凝药再叠鱼油，出血风险升",
  presentationFamily: "multi_factor_stack",
  durationFrames: 401,
  fps: 30,
  platformLayout: "douyin_9x16_safe",
  rules: [
    "rightRail occupies only the bottom-right where Douyin places like/comment buttons; top-right is content-safe.",
    "subtitleBand is reserved for real spoken subtitles; charts and stack rows cannot enter.",
    "stack items appear sequentially with stagger; never simultaneously.",
    "risk bars enter only after all stack items + fish oil are visible (beat 3).",
    "presenter stays small at left-bottom; never compete with stack/risk visuals.",
    "platformTitle is disposable; only legal/disclaimer text may be placed there.",
  ],
  slots: {
    topProgress: {
      x: 28,
      y: 28,
      w: 1024,
      h: 114,
      description: "full-width top progress strip; no longer reserves right side",
    },
    stackHeader: {
      x: 60,
      y: 180,
      w: 960,
      h: 80,
      description: "above-stack callout: '正在吃这些药？' + '再加鱼油' beat caption",
    },
    pillStack: {
      x: 90,
      y: 280,
      w: 740,
      h: 800,
      description: "vertical stack of pill cards (3 drugs + fish oil added on top)",
    },
    riskZone: {
      x: 60,
      y: 1090,
      w: 830,
      h: 280,
      description: "two risk bars (gastric / brain bleed) entering only in beat 3",
    },
    presenterLeftBottom: {
      x: 30,
      y: 1370,
      w: 280,
      h: 340,
      description: "smaller presenter avatar — diagram-class VU lets the chart dominate",
    },
    sourceNote: {
      x: 350,
      y: 1370,
      w: 540,
      h: 130,
      description: "tiny mechanism note: 凝血/血小板路径",
    },
    subtitleBand: {
      x: 44,
      y: 1490,
      w: 850,
      h: 130,
      description: "real spoken subtitles; far enough from platformTitle",
    },
    platformTitle: {
      x: 0,
      y: 1788,
      w: 1080,
      h: 132,
      description: "platform title overlay; only tiny disclaimer allowed",
    },
    rightRail: {
      x: 940,
      y: 1100,
      w: 140,
      h: 600,
      description: "bottom-right rail only: like/comment/favorite/share. Top-right is free.",
    },
  } satisfies Record<Svu07SlotName, SlotRect>,
  beats: [
    {
      id: "beat1_drugs",
      start: 0,
      end: 130,
      goal: "build the cumulative drug context: 3 anticoagulant/antiplatelet pills enter the stack",
      activeElements: [
        "drug_question",
        "pill_aspirin",
        "pill_clopidogrel",
        "pill_rivaroxaban",
      ],
    },
    {
      id: "beat2_addfish",
      start: 130,
      end: 220,
      goal: "highlight the moment of adding fish oil — pulse + color shift to amber-warning",
      activeElements: [
        "pill_aspirin",
        "pill_clopidogrel",
        "pill_rivaroxaban",
        "fish_oil_added",
        "stack_glow",
      ],
    },
    {
      id: "beat3_risk",
      start: 220,
      end: 401,
      goal: "reveal cumulative bleeding risk rising: gastric & brain bleed bars climb",
      activeElements: [
        "pill_aspirin",
        "pill_clopidogrel",
        "pill_rivaroxaban",
        "fish_oil_added",
        "risk_bar_gastric",
        "risk_bar_brain",
        "risk_arrow",
        "source_note",
      ],
    },
  ] satisfies MotionBeat[],
  elements: [
    {
      id: "drug_question",
      role: "claim",
      priority: "high",
      slot: "stackHeader",
      visibleBeats: ["beat1_drugs", "beat2_addfish"],
      behavior: "replace",
      neverOverlapSlots: ["pillStack", "subtitleBand"],
      notes:
        "Beat 1: '正在吃这些药？' as header question. Beat 2 morphs to '再加鱼油' (highlighted).",
    },
    {
      id: "pill_aspirin",
      role: "subject",
      priority: "high",
      slot: "pillStack",
      visibleBeats: ["beat1_drugs", "beat2_addfish", "beat3_risk"],
      behavior: "persist",
      neverOverlapSlots: ["riskZone", "subtitleBand", "rightRail"],
      notes: "Bottom of stack. Enters first at frame ~10 with slide-up + spring.",
    },
    {
      id: "pill_clopidogrel",
      role: "subject",
      priority: "high",
      slot: "pillStack",
      visibleBeats: ["beat1_drugs", "beat2_addfish", "beat3_risk"],
      behavior: "persist",
      neverOverlapSlots: ["riskZone", "subtitleBand", "rightRail"],
      notes: "Second pill, enters at frame ~50 (40 frame stagger from aspirin).",
    },
    {
      id: "pill_rivaroxaban",
      role: "subject",
      priority: "high",
      slot: "pillStack",
      visibleBeats: ["beat1_drugs", "beat2_addfish", "beat3_risk"],
      behavior: "persist",
      neverOverlapSlots: ["riskZone", "subtitleBand", "rightRail"],
      notes: "Third pill, enters at frame ~90 (40 frame stagger from clopidogrel).",
    },
    {
      id: "fish_oil_added",
      role: "data_bomb",
      priority: "critical",
      slot: "pillStack",
      visibleBeats: ["beat2_addfish", "beat3_risk"],
      behavior: "persist",
      neverOverlapSlots: ["riskZone", "subtitleBand", "rightRail"],
      notes:
        "Fish oil card lands on top of the stack at frame 144 with PopIn + amber glow ring; remains highlighted through beat 3.",
    },
    {
      id: "stack_glow",
      role: "claim",
      priority: "medium",
      slot: "pillStack",
      visibleBeats: ["beat2_addfish"],
      behavior: "enter_exit",
      neverOverlapSlots: ["subtitleBand"],
      notes: "Soft amber pulse around the entire stack, signalling 'compounding'.",
    },
    {
      id: "risk_bar_gastric",
      role: "data_bomb",
      priority: "critical",
      slot: "riskZone",
      visibleBeats: ["beat3_risk"],
      behavior: "enter_exit",
      neverOverlapSlots: ["pillStack", "subtitleBand", "rightRail"],
      notes:
        "Gastric bleed bar fills from 0 → 0.78 with red gradient over frames 240-300.",
    },
    {
      id: "risk_bar_brain",
      role: "data_bomb",
      priority: "high",
      slot: "riskZone",
      visibleBeats: ["beat3_risk"],
      behavior: "enter_exit",
      neverOverlapSlots: ["pillStack", "subtitleBand", "rightRail"],
      notes:
        "Brain bleed bar fills from 0 → 0.55 with red gradient over frames 260-320 (slight stagger after gastric).",
    },
    {
      id: "risk_arrow",
      role: "structure",
      priority: "medium",
      slot: "riskZone",
      visibleBeats: ["beat3_risk"],
      behavior: "enter_exit",
      notes:
        "An upward arrow from the stack pointing to the risk bars at frame 240, with PathDraw.",
    },
    {
      id: "source_note",
      role: "source",
      priority: "low",
      slot: "sourceNote",
      visibleBeats: ["beat3_risk"],
      behavior: "enter_exit",
      neverOverlapSlots: ["subtitleBand", "presenterLeftBottom"],
      notes:
        "Small mechanism note: '叠加抑制凝血/血小板' or similar — provenance not data.",
    },
  ] satisfies MotionElement[],
  subtitles: [
    {
      start: 0,
      end: 76,
      text: "如果你正在吃\n阿司匹林、氯吡格雷",
      highlight: "阿司匹林",
    },
    {
      start: 76,
      end: 134,
      text: "或者吃利伐沙班\n这类抗凝药",
      highlight: "抗凝药",
    },
    {
      start: 134,
      end: 220,
      text: "再叠加鱼油\n一起吃",
      highlight: "鱼油",
    },
    {
      start: 220,
      end: 320,
      text: "胃出血、脑出血\n风险都会上升",
      highlight: "胃出血",
    },
    {
      start: 320,
      end: 401,
      text: "风险都会\n往上走",
      highlight: "往上走",
    },
  ] satisfies SubtitleCue[],
} as const;
