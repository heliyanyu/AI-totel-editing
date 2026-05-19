import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import { COLORS, FONTS } from "./plan-shared";
import type {
  AssetSlot,
  PresentationFamily,
  VUElement,
  VUPlan,
  VURenderJob,
} from "../../vu/schema";

type ResolvedAsset = {
  type: "image" | "video";
  src: string;
};

export type GenericVUClipProps = {
  job: VURenderJob;
  plan?: VUPlan | null;
  durationFrames: number;
  resolvedAssets?: Record<string, ResolvedAsset>;
};

const W = 1080;
const H = 1920;
const SAFE_RIGHT_X = 920;
const STAGE = { x: 58, y: 220, w: SAFE_RIGHT_X - 92, h: 1110 };
const TITLE_Y = 245;
const CANVAS_BOTTOM = 1370;

const springConfig = { mass: 0.85, damping: 18, stiffness: 120 } as const;
const popConfig = { mass: 0.65, damping: 11, stiffness: 170 } as const;

const roleColors: Record<VUElement["role"], string> = {
  subject: COLORS.blueDeep,
  claim: COLORS.blue,
  structure: COLORS.slate,
  evidence: COLORS.green,
  data: COLORS.red,
  mechanism: COLORS.purple,
  annotation: COLORS.inkSoft,
  subtitle: COLORS.ink,
};

function fallbackPlan(job: VURenderJob): VUPlan {
  const beats = (job.source_vu.internal_beats?.length
    ? job.source_vu.internal_beats
    : [{ large_text: job.source_vu.one_screen_message }]
  ).map((beat, index, all) => ({
    id: `beat_${index + 1}`,
    source_covers: job.source_vu.covers,
    start_ratio: index / all.length,
    end_ratio: (index + 1) / all.length,
    large_text: beat.large_text || job.source_vu.one_screen_message,
    visual_goal: beat.visual || job.source_vu.presentation_strategy,
    active_elements: ["main_message", ...job.asset_slots.slice(0, 2).map((slot) => slot.slot_id)],
  }));

  const elements: VUElement[] = [
    {
      id: "main_message",
      role: /数字|%|％|\d/.test(job.source_vu.presentation_strategy + job.source_vu.one_screen_message)
        ? "data"
        : "claim",
      priority: "critical",
      text: job.source_vu.one_screen_message,
      visible_beats: beats.map((beat) => beat.id),
      enter_anim: "pop",
    },
    ...job.asset_slots.slice(0, 3).map((slot, index): VUElement => ({
      id: slot.slot_id,
      role: index === 0 ? "subject" : "evidence",
      priority: index === 0 ? "high" : "medium",
      asset_slot: slot.slot_id,
      visible_beats: beats.map((beat) => beat.id),
      enter_anim: "slide",
    })),
  ];

  return {
    vu_id: job.vu_id,
    llm_policy: "deepseek_plan",
    presentation_family: job.presentation_family,
    render_strategy: job.render_strategy,
    beats,
    elements,
    asset_requests: job.asset_requests,
    layout_contract: {
      right_rail_reserved: true,
      subtitle_band_reserved: true,
      bottom_disclaimer_only: true,
      max_lower_screen_right_x: SAFE_RIGHT_X,
      primary_info_y_range: [180, 1320],
      subtitle_y_range: [1490, 1620],
    },
    editor_notes: job.editor_notes,
  };
}

function activeBeat(plan: VUPlan, frame: number, durationFrames: number) {
  const ratio = durationFrames <= 1 ? 0 : frame / (durationFrames - 1);
  return (
    plan.beats.find((beat) => ratio >= beat.start_ratio && ratio < beat.end_ratio) ??
    plan.beats[plan.beats.length - 1]
  );
}

function beatStartFrame(beat: VUPlan["beats"][number], durationFrames: number) {
  return Math.floor(beat.start_ratio * durationFrames);
}

function priorityOrder(priority: VUElement["priority"]) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority];
}

function slotFor(element: VUElement, slots: AssetSlot[]) {
  return element.asset_slot ? slots.find((slot) => slot.slot_id === element.asset_slot) : undefined;
}

function elementText(element: VUElement, slots: AssetSlot[]) {
  if (element.text) return element.text;
  const slot = slotFor(element, slots);
  return slot?.semantic_label ?? element.id;
}

function keywordEmoji(text: string) {
  if (/止痛|消炎|药|布洛芬|成分/.test(text)) return "💊";
  if (/盐|高盐|咸/.test(text)) return "🧂";
  if (/水|喝水|饮水|尿|水肿/.test(text)) return "💧";
  if (/运动|跑|跳|累|休息/.test(text)) return "🚶";
  if (/熬夜|睡|休息/.test(text)) return "🌙";
  if (/感染|发烧|感冒/.test(text)) return "🌡️";
  if (/复查|指标|肌酐|蛋白|尿/.test(text)) return "📋";
  if (/肾|肾病|肾脏/.test(text)) return "🩺";
  if (/不能|不要|风险|危险|警惕|错/.test(text)) return "⚠️";
  if (/钱|贵|买|花/.test(text)) return "💸";
  return "✨";
}

function assetEmoji(element: VUElement, slots: AssetSlot[]) {
  const slot = slotFor(element, slots);
  return slot?.fallback.value ?? keywordEmoji(elementText(element, slots));
}

function cleanText(text: string) {
  return text.replace(/\s+/g, "").replace(/[，。！？、；：,.!?:;\/／]/g, "");
}

function isOrdinalOnly(text: string) {
  return /^第[一二三四五六七八九十]+[呢、]?$/.test(cleanText(text));
}

function displayBeatText(beat: VUPlan["beats"][number], fallback: string, max = 24) {
  const raw = beat.large_text || fallback;
  if (isOrdinalOnly(raw)) {
    return fitText(fallback || beat.visual_goal || raw, max);
  }
  return fitText(raw, max);
}

function compactLabel(text: string, max = 5) {
  const t = cleanText(text)
    .replace(/^第[一二三四五六七八九十]+呢?/, "")
    .replace(/^第[一二三四五六七八九十]+[:：]?/, "")
    .replace(/^不能/, "");
  const rules: Array<[RegExp, string]> = [
    [/止痛|消炎|布洛芬|双氯芬酸/, "止痛药"],
    [/来路不明|不明/, "来路不明"],
    [/腰痛|头痛|滥用/, "滥用场景"],
    [/短期|问题不大/, "短期OK"],
    [/滤过|肾小球/, "滤过下降"],
    [/血流|缺血/, "肾血流"],
    [/肾功能|掉得|恶化/, "肾功能"],
    [/遵医嘱|医嘱/, "遵医嘱"],
    [/憋尿/, "憋尿"],
    [/喝水|饮水|水少/, "饮水"],
    [/补肾|偏方|秘方/, "补肾品"],
    [/成分/, "成分不明"],
    [/肾小管/, "肾小管"],
    [/劳累|过劳/, "过劳"],
    [/剧烈|运动/, "强运动"],
    [/感染|发烧|感冒/, "感染"],
  ];
  for (const [pattern, label] of rules) {
    if (pattern.test(t)) return label;
  }
  return fitText(t, max);
}

function fitText(text: string, max = 18) {
  const cleaned = cleanText(text);
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function splitTitle(text: string) {
  const cleaned = cleanText(text);
  if (cleaned.length <= 10) return [cleaned];
  if (cleaned.length <= 18) return [cleaned.slice(0, Math.ceil(cleaned.length / 2)), cleaned.slice(Math.ceil(cleaned.length / 2))];
  return [cleaned.slice(0, 8), cleaned.slice(8, 16), cleaned.slice(16, 24)];
}

function extractNumber(text: string) {
  const match = cleanText(text).match(/[+\-]?\d+(?:\.\d+)?\s*(?:%|％|倍|克|g|G)?/);
  return match?.[0] ?? "";
}

function activeElements(plan: VUPlan, job: VURenderJob, beat: VUPlan["beats"][number]) {
  const activeIds = new Set(beat.active_elements);
  const visible = plan.elements
    .filter((element) => element.visible_beats.includes(beat.id) || activeIds.has(element.id))
    .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));
  if (visible.length > 0) return visible.slice(0, 5);
  return fallbackPlan(job).elements.slice(0, 4);
}

const Entrance: React.FC<{
  start: number;
  delay?: number;
  from?: "left" | "right" | "up" | "down" | "pop";
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ start, delay = 0, from = "down", children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - start - delay;
  if (local < -4) return null;
  const t = spring({
    frame: Math.max(0, local),
    fps,
    config: from === "pop" ? popConfig : springConfig,
    durationInFrames: 24,
  });
  const opacity = interpolate(local, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dx = from === "left" ? (1 - t) * -70 : from === "right" ? (1 - t) * 70 : 0;
  const dy = from === "up" ? (1 - t) * -48 : from === "down" ? (1 - t) * 48 : 0;
  const scale = from === "pop" ? interpolate(t, [0, 1], [0.64, 1]) : 1;
  return (
    <div
      style={{
        ...style,
        opacity,
        transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
        willChange: "transform, opacity",
      }}
    >
      {children}
    </div>
  );
};

const BackgroundMotion: React.FC<{ family: PresentationFamily }> = () => null;

const MedicalVector: React.FC<{ kind: string; color: string; large?: boolean; progress?: number }> = ({
  kind,
  color,
  large = false,
  progress = 0,
}) => {
  const size = large ? 250 : 132;
  const stroke = color;
  const red = COLORS.red;
  const blue = COLORS.blueDeep;
  const green = COLORS.green;
  const pulse = 1 + Math.sin(progress * Math.PI * 6) * 0.035;

  if (/pill|drug|nsaid|药|止痛|消炎/.test(kind)) {
    return (
      <svg width={size} height={size} viewBox="0 0 260 260" style={{ overflow: "visible" }}>
        <g transform={`scale(${pulse})`} style={{ transformOrigin: "130px 130px" }}>
          <rect x="48" y="85" width="164" height="72" rx="36" fill="#FFFFFF" stroke={red} strokeWidth="10" transform="rotate(-18 130 121)" />
          <path d="M130 54 L130 188" stroke={red} strokeWidth="8" strokeLinecap="round" transform="rotate(-18 130 121)" />
          <rect x="72" y="144" width="118" height="50" rx="25" fill="#FEE2E2" stroke={red} strokeWidth="8" transform="rotate(18 130 169)" />
          <circle cx="196" cy="62" r="18" fill={red} opacity="0.18" />
          <circle cx="45" cy="204" r="14" fill={red} opacity="0.20" />
        </g>
      </svg>
    );
  }

  if (/water|水|尿|droplet/.test(kind)) {
    return (
      <svg width={size} height={size} viewBox="0 0 260 260" style={{ overflow: "visible" }}>
        <path d="M130 26 C92 80 68 113 68 154 C68 198 96 226 130 226 C164 226 192 198 192 154 C192 113 168 80 130 26Z" fill="#E0F2FE" stroke={blue} strokeWidth="10" />
        <path d="M105 177 C117 194 146 194 156 174" stroke={blue} strokeWidth="8" strokeLinecap="round" fill="none" opacity="0.65" />
        <circle cx="102" cy="126" r="11" fill={blue} opacity="0.35" />
      </svg>
    );
  }

  if (/exercise|运动|runner|劳累/.test(kind)) {
    return (
      <svg width={size} height={size} viewBox="0 0 260 260" style={{ overflow: "visible" }}>
        <circle cx="132" cy="50" r="24" fill="#DBEAFE" stroke={blue} strokeWidth="9" />
        <path d="M132 78 L103 126 L151 134 L126 204" stroke={blue} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M113 112 L62 102" stroke={blue} strokeWidth="13" strokeLinecap="round" />
        <path d="M149 134 L194 112" stroke={blue} strokeWidth="13" strokeLinecap="round" />
        <path d="M126 204 L80 224" stroke={blue} strokeWidth="13" strokeLinecap="round" />
        <path d="M132 178 L190 218" stroke={red} strokeWidth="13" strokeLinecap="round" />
        <path d="M46 70 C68 52 89 45 111 45" stroke={green} strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.55" />
      </svg>
    );
  }

  if (/unknown|herbal|toxic|偏方|补肾|成分/.test(kind)) {
    return (
      <svg width={size} height={size} viewBox="0 0 260 260" style={{ overflow: "visible" }}>
        <rect x="88" y="38" width="84" height="36" rx="10" fill="#CBD5E1" stroke={COLORS.slate} strokeWidth="7" />
        <rect x="70" y="68" width="120" height="154" rx="24" fill="#FFF7ED" stroke={COLORS.amber} strokeWidth="10" />
        <rect x="88" y="112" width="84" height="62" rx="12" fill="#FFFFFF" stroke={red} strokeWidth="7" />
        <text x="130" y="157" textAnchor="middle" fontSize="58" fontWeight="900" fill={red}>?</text>
        <path d="M54 202 L206 72" stroke={red} strokeWidth="13" strokeLinecap="round" />
        <path d="M54 72 L206 202" stroke={red} strokeWidth="13" strokeLinecap="round" opacity="0.75" />
      </svg>
    );
  }

  if (/filter|pressure|血流|滤过|肾小球|机制/.test(kind)) {
    const dash = 180 * (1 - Math.min(1, progress));
    return (
      <svg width={size} height={size} viewBox="0 0 260 260" style={{ overflow: "visible" }}>
        <circle cx="130" cy="118" r="64" fill="#EEF2FF" stroke={blue} strokeWidth="10" />
        <path d="M72 118 C104 82 154 154 188 118" stroke={blue} strokeWidth="11" strokeLinecap="round" fill="none" opacity="0.55" />
        <path d="M34 118 H84" stroke={green} strokeWidth="13" strokeLinecap="round" />
        <path d="M176 118 H226" stroke={red} strokeWidth="13" strokeLinecap="round" strokeDasharray="180" strokeDashoffset={dash} />
        <path d="M82 190 C104 218 156 218 178 190" stroke={COLORS.slate} strokeWidth="10" strokeLinecap="round" fill="none" />
        <path d="M58 54 L202 206" stroke={red} strokeWidth="8" strokeLinecap="round" opacity="0.45" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 260 260" style={{ overflow: "visible" }}>
      <path d="M94 40 C54 65 43 127 71 174 C92 209 128 210 136 168 C143 131 130 71 94 40Z" fill="#FEE2E2" stroke={red} strokeWidth="9" />
      <path d="M166 40 C206 65 217 127 189 174 C168 209 132 210 124 168 C117 131 130 71 166 40Z" fill="#FEE2E2" stroke={red} strokeWidth="9" />
      <path d="M128 152 C128 192 112 212 92 228" stroke={blue} strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M132 152 C132 192 148 212 168 228" stroke={blue} strokeWidth="10" strokeLinecap="round" fill="none" />
      <circle cx="130" cy="122" r={large ? 14 + Math.sin(progress * Math.PI * 4) * 3 : 12} fill={blue} opacity="0.7" />
    </svg>
  );
};

const AssetVisual: React.FC<{
  element: VUElement;
  slots: AssetSlot[];
  resolvedAssets?: Record<string, ResolvedAsset>;
  label?: boolean;
  large?: boolean;
}> = ({ element, slots, resolvedAssets, label = true, large = false }) => {
  const frame = useCurrentFrame();
  const resolved = element.asset_slot ? resolvedAssets?.[element.asset_slot] : undefined;
  const text = elementText(element, slots);
  const color = roleColors[element.role] ?? COLORS.blueDeep;
  if (resolved?.type === "image") {
    return (
      <Img
        src={resolved.src}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
      />
    );
  }
  if (resolved?.type === "video") {
    return (
      <OffthreadVideo
        src={resolved.src}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 22 }}
      />
    );
  }
  return (
    <div style={{ textAlign: "center", fontFamily: FONTS.sans }}>
      <div style={{ filter: `drop-shadow(0 16px 30px ${color}2A)` }}>
        <MedicalVector kind={`${element.asset_slot ?? ""} ${text}`} color={color} large={large} progress={frame / 90} />
      </div>
      {label && (
        <div
          style={{
            marginTop: large ? 8 : 4,
            color,
            fontSize: large ? 32 : 23,
            lineHeight: 1.18,
            fontWeight: 950,
          }}
        >
          {compactLabel(text, large ? 6 : 5)}
        </div>
      )}
    </div>
  );
};

const TopHeadline: React.FC<{ text: string; start: number; color?: string }> = ({ text, start, color = COLORS.ink }) => (
  <Entrance start={start} from="up">
    <div
      style={{
        position: "absolute",
        left: 70,
        top: TITLE_Y,
        width: SAFE_RIGHT_X - 140,
        zIndex: 8,
        fontFamily: FONTS.sans,
        color,
        fontSize: cleanText(text).length > 18 ? 48 : 58,
        lineHeight: 1.12,
        fontWeight: 950,
        textAlign: "center",
        textShadow: "0 10px 28px rgba(15,23,42,0.12)",
      }}
    >
      {fitText(text, 24)}
    </div>
  </Entrance>
);

const Chip: React.FC<{ text: string; color?: string; index: number; start: number }> = ({
  text,
  color = COLORS.blueDeep,
  index,
  start,
}) => (
  <Entrance start={start} delay={index * 5} from={index % 2 ? "right" : "left"}>
    <div
      style={{
        minHeight: 76,
        borderRadius: 16,
        background: "rgba(255,255,255,0.9)",
        border: `3px solid ${color}`,
        boxShadow: `0 14px 34px ${color}24`,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "14px 18px",
        fontFamily: FONTS.sans,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: color,
          color: "white",
          display: "grid",
          placeItems: "center",
          fontSize: 24,
          fontWeight: 950,
          flexShrink: 0,
        }}
      >
        {index + 1}
      </div>
      <div style={{ fontSize: 30, lineHeight: 1.16, color: COLORS.ink, fontWeight: 950 }}>
        {fitText(text, 13)}
      </div>
    </div>
  </Entrance>
);

function titlePropSet(text: string) {
  if (/肾|肾病|六件事|止痛|憋尿|补肾|劳累/.test(text)) {
    return [
      { label: "止痛药", kind: "pill drug 止痛药", color: COLORS.red },
      { label: "饮水", kind: "water 喝水", color: COLORS.blueDeep },
      { label: "补肾品", kind: "unknown herbal 补肾", color: COLORS.amber },
      { label: "强运动", kind: "exercise 运动", color: COLORS.green },
      { label: "感染", kind: "infection 风险", color: COLORS.red },
      { label: "复查", kind: "kidney report", color: COLORS.blue },
    ];
  }
  return [
    { label: "重点一", kind: text, color: COLORS.blueDeep },
    { label: "重点二", kind: "risk", color: COLORS.red },
    { label: "重点三", kind: "evidence", color: COLORS.green },
  ];
}

const KineticTitle: React.FC<LayoutProps> = ({ job, beat, beatFrame }) => {
  const frame = useCurrentFrame();
  const lines = splitTitle(beat.large_text || job.source_vu.one_screen_message);
  const props = titlePropSet(`${job.source_vu.one_screen_message} ${beat.large_text}`);
  const reveal = interpolate(frame - beatFrame, [18, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 280,
          top: 250,
          width: 380,
          height: 380,
          opacity: 0.12,
          transform: `scale(${1 + Math.sin(frame / 28) * 0.018})`,
          zIndex: 2,
        }}
      >
        <MedicalVector kind="kidney anatomy" color={COLORS.blueDeep} large progress={frame / 90} />
      </div>
      <div style={{ position: "absolute", left: 70, right: 150, top: 315, zIndex: 10 }}>
        {lines.map((line, i) => (
          <Entrance key={`${beat.id}-${i}`} start={beatFrame} delay={i * 8} from="pop">
            <div
              style={{
                fontFamily: FONTS.sans,
                fontSize: lines.length > 2 ? 76 : 92,
                lineHeight: 1.08,
                fontWeight: 950,
                color: i === lines.length - 1 ? COLORS.blueDeep : COLORS.ink,
                textAlign: "center",
                textShadow: i === lines.length - 1 ? `4px 5px 0 ${COLORS.amber}` : "none",
                letterSpacing: 1,
              }}
            >
              {line}
            </div>
          </Entrance>
        ))}
        <div
          style={{
            height: 10,
            margin: "28px auto 0",
            width: interpolate(frame - beatFrame, [20, 54], [0, 660], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            }),
            borderRadius: 999,
            background: COLORS.red,
            boxShadow: "0 0 18px rgba(220,38,38,0.28)",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 94,
          top: 760,
          width: 760,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 18,
          zIndex: 9,
        }}
      >
        {props.map((item, index) => (
          <Entrance key={item.label} start={beatFrame} delay={36 + index * 8} from="up">
            <div
              style={{
                height: 172,
                borderRadius: 20,
                border: `4px solid ${item.color}`,
                background: "rgba(255,255,255,0.9)",
                boxShadow: "0 18px 44px rgba(15,23,42,0.14)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                transform: `translateY(${(1 - reveal) * 22}px)`,
              }}
            >
              <MedicalVector kind={item.kind} color={item.color} progress={frame / 80 + index * 0.1} />
              <div
                style={{
                  fontFamily: FONTS.sans,
                  fontSize: 28,
                  fontWeight: 950,
                  color: item.color,
                  lineHeight: 1,
                }}
              >
                {item.label}
              </div>
            </div>
          </Entrance>
        ))}
      </div>
    </>
  );
};

type LayoutProps = {
  job: VURenderJob;
  plan: VUPlan;
  beat: VUPlan["beats"][number];
  elements: VUElement[];
  beatFrame: number;
  durationFrames: number;
  resolvedAssets?: Record<string, ResolvedAsset>;
};

const MechanismStage: React.FC<{
  element: VUElement;
  slots: AssetSlot[];
  currentMain: string;
  localFrame: number;
  beatProgress: number;
}> = ({ element, slots, currentMain, localFrame, beatProgress }) => {
  const draw = interpolate(localFrame, [0, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const pulse = 1 + Math.sin(localFrame / 8) * 0.035;
  const label = compactLabel(currentMain, 5);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg width="100%" height="100%" viewBox="0 0 590 760" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="mechanism-flow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={COLORS.green} />
            <stop offset="55%" stopColor={COLORS.blueDeep} />
            <stop offset="100%" stopColor={COLORS.red} />
          </linearGradient>
          <filter id="soft-red-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          d="M72 380 C160 265 250 265 292 380 C340 515 462 500 518 360"
          fill="none"
          stroke="rgba(37,99,235,0.14)"
          strokeWidth="42"
          strokeLinecap="round"
        />
        <path
          d="M72 380 C160 265 250 265 292 380 C340 515 462 500 518 360"
          fill="none"
          stroke="url(#mechanism-flow)"
          strokeWidth="18"
          strokeLinecap="round"
          strokeDasharray="760"
          strokeDashoffset={760 * (1 - draw)}
          filter="url(#soft-red-glow)"
        />
        {[0, 1, 2, 3].map((i) => {
          const t = ((beatProgress + i * 0.17) % 1);
          const x = interpolate(t, [0, 0.5, 1], [72, 292, 518]);
          const y = interpolate(t, [0, 0.45, 1], [380, 340, 360]);
          return <circle key={i} cx={x} cy={y} r={10 + i} fill={i > 1 ? COLORS.red : COLORS.blueDeep} opacity={0.22 + i * 0.13} />;
        })}
        <circle cx="296" cy="382" r={108 * pulse} fill="rgba(239,68,68,0.06)" stroke="rgba(220,38,38,0.22)" strokeWidth="8" />
      </svg>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 230,
          transform: "translateX(-50%)",
          width: 330,
          height: 330,
          display: "grid",
          placeItems: "center",
        }}
      >
        <MedicalVector kind={`${element.asset_slot ?? ""} ${elementText(element, slots)} ${currentMain}`} color={COLORS.red} large progress={beatProgress} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 52,
          right: 52,
          bottom: 82,
          height: 112,
          borderRadius: 24,
          background: "rgba(254,226,226,0.72)",
          border: "2px solid rgba(220,38,38,0.28)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.5)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 24,
            top: 48,
            width: interpolate(draw, [0, 1], [0, 440]),
            height: 14,
            borderRadius: 999,
            background: COLORS.red,
            boxShadow: "0 0 22px rgba(220,38,38,0.36)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 24,
            top: 18,
            fontFamily: FONTS.sans,
            fontSize: 24,
            fontWeight: 950,
            color: COLORS.red,
          }}
        >
          {label}机制正在放大
        </div>
      </div>
    </div>
  );
};

const SubjectStage: React.FC<{
  element: VUElement;
  slots: AssetSlot[];
  currentMain: string;
  localFrame: number;
  beatProgress: number;
  resolvedAssets?: Record<string, ResolvedAsset>;
}> = ({ element, slots, currentMain, localFrame, beatProgress, resolvedAssets }) => {
  const pop = spring({
    frame: Math.max(0, localFrame),
    fps: 30,
    config: popConfig,
    durationInFrames: 28,
  });
  const slash = /不能|禁忌|乱吃|少|风险|伤|不明/.test(currentMain)
    ? interpolate(localFrame, [18, 46], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      })
    : 0;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
      <div
        style={{
          transform: `scale(${interpolate(pop, [0, 1], [0.82, 1])}) rotate(${Math.sin(beatProgress * Math.PI * 2) * 1.5}deg)`,
          width: 430,
          height: 430,
          display: "grid",
          placeItems: "center",
        }}
      >
        <AssetVisual element={element} slots={slots} resolvedAssets={resolvedAssets} large label={false} />
      </div>
      <svg width="100%" height="100%" viewBox="0 0 590 760" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <path
          d="M145 520 C220 610 370 610 448 520"
          fill="none"
          stroke={COLORS.blueDeep}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray="360"
          strokeDashoffset={360 * (1 - Math.min(1, localFrame / 44))}
          opacity="0.42"
        />
        {slash > 0 && (
          <path
            d="M145 205 L450 555"
            stroke={COLORS.red}
            strokeWidth="18"
            strokeLinecap="round"
            strokeDasharray="470"
            strokeDashoffset={470 * (1 - slash)}
            filter="drop-shadow(0 8px 18px rgba(220,38,38,0.28))"
          />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          left: 54,
          right: 54,
          bottom: 70,
          minHeight: 86,
          borderRadius: 20,
          background: "rgba(255,255,255,0.78)",
          border: "1px solid rgba(148,163,184,0.35)",
          display: "grid",
          placeItems: "center",
          fontFamily: FONTS.sans,
          fontSize: 36,
          fontWeight: 950,
          color: COLORS.ink,
          boxShadow: "0 14px 30px rgba(15,23,42,0.10)",
          padding: "0 22px",
          textAlign: "center",
        }}
      >
        {compactLabel(currentMain, 6)}
      </div>
    </div>
  );
};

const StructuralBoard: React.FC<LayoutProps> = ({ job, plan, beat, elements, durationFrames, resolvedAssets }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentMain = displayBeatText(beat, job.source_vu.one_screen_message, 18);
  const visualText = beat.visual_goal || job.source_vu.presentation_strategy;
  const beatIndex = Math.max(0, plan.beats.findIndex((item) => item.id === beat.id));
  const showMechanism =
    /机制|血流|滤过|下降|缺血|损伤|风险|成分|水肿|劳累|肾功能|掉|恶化/.test(`${currentMain}${visualText}`) ||
    beatIndex >= Math.max(1, Math.floor(plan.beats.length * 0.55));
  const visual =
    (showMechanism
      ? plan.elements.find((el) => ["evidence", "mechanism"].includes(el.role)) ??
        elements.find((el) => ["evidence", "mechanism"].includes(el.role))
      : undefined) ??
    elements.find((el) => el.role === "subject") ??
    plan.elements.find((el) => el.role === "subject") ??
    plan.elements.find((el) => ["evidence", "mechanism"].includes(el.role)) ??
    elements[0];
  const beatRows = plan.beats.slice(0, 9);
  const activeStart = beatStartFrame(beat, durationFrames);
  const prevBeatStart = beatIndex > 0 ? beatStartFrame(plan.beats[beatIndex - 1], durationFrames) : 0;
  const local = frame - activeStart;
  const beatEndFrame = Math.max(activeStart + 1, Math.floor(beat.end_ratio * durationFrames));
  const beatProgress = Math.max(0, Math.min(1, (frame - activeStart) / Math.max(1, beatEndFrame - activeStart)));
  const subjectEnter = spring({ frame, fps, config: springConfig, durationInFrames: 34 });
  const foldT = interpolate(frame, [0, Math.min(durationFrames - 1, durationFrames * 0.45)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const evidenceT = interpolate(frame, [durationFrames * 0.45, durationFrames * 0.72], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const activeYRaw = 438 + beatIndex * 62;
  const previousYRaw = 438 + Math.max(0, beatIndex - 1) * 62;
  const activeY = interpolate(frame, [activeStart, activeStart + 24], [previousYRaw, activeYRaw], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const boardScale = interpolate(foldT, [0, 1], [1, 0.92]);
  const boardX = interpolate(foldT, [0, 1], [60, 42]);
  const rightX = interpolate(subjectEnter, [0, 1], [650, 500]);
  const subjectScale = interpolate(subjectEnter, [0, 1], [0.86, 1]);
  const pathDraw = interpolate(local, [8, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 60,
          top: 210,
          width: 820,
          zIndex: 12,
          textAlign: "center",
          fontFamily: FONTS.sans,
        }}
      >
        <div
          style={{
            fontSize: cleanText(currentMain).length > 14 ? 48 : 64,
            lineHeight: 1.08,
            fontWeight: 950,
            color: COLORS.ink,
            letterSpacing: 1,
            textShadow: "0 10px 24px rgba(15,23,42,0.10)",
          }}
        >
          {currentMain}
        </div>
        <div
          style={{
            margin: "14px auto 0",
            width: interpolate(pathDraw, [0, 1], [0, 610]),
            height: 9,
            borderRadius: 999,
            background: showMechanism ? COLORS.red : COLORS.blueDeep,
            boxShadow: `0 0 20px ${showMechanism ? "rgba(220,38,38,0.28)" : "rgba(37,99,235,0.25)"}`,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: boardX,
          top: 382,
          width: 326,
          height: 740,
          zIndex: 10,
          transform: `scale(${boardScale})`,
          transformOrigin: "left top",
          fontFamily: FONTS.sans,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 24,
            background: "rgba(255,255,255,0.82)",
            border: "1px solid rgba(148,163,184,0.32)",
            boxShadow: "0 20px 46px rgba(15,23,42,0.10)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 24,
            top: 26,
            color: COLORS.inkSoft,
            fontSize: 22,
            fontWeight: 950,
            letterSpacing: 3,
          }}
        >
          结构闭环
        </div>
        <div
          style={{
            position: "absolute",
            right: 22,
            top: 24,
            width: 72,
            height: 30,
            borderRadius: 999,
            background: COLORS.blueDeep,
            color: "white",
            display: "grid",
            placeItems: "center",
            fontSize: 18,
            fontWeight: 950,
          }}
        >
          {beatIndex + 1}/{beatRows.length}
        </div>
        <svg width={326} height={740} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <path
            d="M62 82 L62 650"
            stroke="rgba(37,99,235,0.18)"
            strokeWidth={8}
            strokeLinecap="round"
          />
          <path
            d="M62 82 L62 650"
            stroke={COLORS.blueDeep}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={568}
            strokeDashoffset={568 * (1 - Math.min(1, beatIndex / Math.max(1, beatRows.length - 1)))}
          />
          <circle
            cx={62}
            cy={activeY - 382 + 38}
            r={23 + Math.sin(frame / 7) * 2}
            fill={COLORS.blueDeep}
            opacity={0.16}
          />
        </svg>
        {beatRows.map((row, index) => {
          const y = 82 + index * 62;
          const active = index === beatIndex;
          const done = index < beatIndex;
          const label = compactLabel(row.large_text || row.visual_goal || job.source_vu.one_screen_message, 5);
          return (
            <div key={row.id}>
              <div
                style={{
                  position: "absolute",
                  left: 44,
                  top: y,
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: active ? COLORS.blueDeep : done ? COLORS.green : "#E2E8F0",
                  color: active || done ? "white" : COLORS.inkSoft,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 17,
                  fontWeight: 950,
                  boxShadow: active ? "0 0 0 8px rgba(37,99,235,0.12)" : undefined,
                }}
              >
                {index + 1}
              </div>
              {(active || Math.abs(index - beatIndex) <= 1 || done) && (
                <div
                  style={{
                    position: "absolute",
                    left: 98,
                    top: y - (active ? 10 : 0),
                    width: active ? 208 : 166,
                    height: active ? 64 : 42,
                    borderRadius: active ? 15 : 11,
                    background: active ? COLORS.blueDeep : done ? "rgba(22,163,74,0.10)" : "rgba(255,255,255,0.86)",
                    border: active ? `2px solid ${COLORS.blueDeep}` : "1px solid rgba(148,163,184,0.32)",
                    color: active ? "white" : done ? COLORS.green : COLORS.inkSoft,
                    display: "grid",
                    placeItems: "center",
                    fontSize: active ? 25 : 18,
                    fontWeight: 950,
                    boxShadow: active ? "0 14px 34px rgba(37,99,235,0.26)" : undefined,
                    opacity: done && !active ? 0.78 : 1,
                  }}
                >
                  {label}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, zIndex: 7, pointerEvents: "none" }}>
        <path
          d="M360 735 C410 735 430 735 500 735"
          stroke={showMechanism ? COLORS.red : COLORS.blueDeep}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={120}
          strokeDashoffset={120 * (1 - pathDraw)}
        />
        <polygon
          points="512,735 488,719 488,751"
          fill={showMechanism ? COLORS.red : COLORS.blueDeep}
          opacity={pathDraw}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          left: rightX,
          top: 340,
          width: 430,
          height: 800,
          borderRadius: 34,
          background: "rgba(255,255,255,0.86)",
          border: `4px solid ${showMechanism ? COLORS.red : roleColors[visual.role] ?? COLORS.blueDeep}`,
          boxShadow: `0 28px 68px ${showMechanism ? "rgba(220,38,38,0.22)" : "rgba(37,99,235,0.18)"}`,
          display: "grid",
          placeItems: "center",
          padding: 18,
          zIndex: 9,
          transform: `scale(${subjectScale})`,
        }}
      >
        {showMechanism ? (
          <MechanismStage
            element={visual}
            slots={job.asset_slots}
            currentMain={currentMain}
            localFrame={local}
            beatProgress={beatProgress}
          />
        ) : (
          <SubjectStage
            element={visual}
            slots={job.asset_slots}
            currentMain={currentMain}
            localFrame={local}
            beatProgress={beatProgress}
            resolvedAssets={resolvedAssets}
          />
        )}
        <div
          style={{
            position: "absolute",
            top: 18,
            left: 22,
            padding: "7px 13px",
            borderRadius: 999,
            background: showMechanism ? COLORS.red : COLORS.blueDeep,
            color: "white",
            fontFamily: FONTS.sans,
            fontSize: 19,
            fontWeight: 950,
            letterSpacing: 1,
          }}
        >
          {showMechanism ? "机制" : "素材"}
        </div>
      </div>
    </>
  );
};

const DataPop: React.FC<LayoutProps> = ({ job, beat, elements, beatFrame }) => {
  const frame = useCurrentFrame();
  const primary = elements[0];
  const main = beat.large_text || elementText(primary, job.asset_slots) || job.source_vu.one_screen_message;
  const number = extractNumber(main) || extractNumber(job.source_vu.one_screen_message);
  const label = number ? main.replace(number, "") : main;
  const t = spring({ frame: Math.max(0, frame - beatFrame - 18), fps: 30, config: popConfig, durationInFrames: 28 });
  const numberScale = interpolate(t, [0, 1], [0.48, 1]);
  return (
    <>
      <TopHeadline text={isOrdinalOnly(label) ? job.source_vu.one_screen_message : label || job.source_vu.one_screen_message} start={beatFrame} color={COLORS.ink} />
      <div
        style={{
          position: "absolute",
          left: 72,
          top: 430,
          width: 800,
          textAlign: "center",
          zIndex: 12,
          fontFamily: FONTS.num,
          transform: `scale(${numberScale})`,
          opacity: interpolate(frame - beatFrame - 18, [0, 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            fontSize: number ? 230 : 104,
            lineHeight: 1,
            fontWeight: 950,
            color: COLORS.red,
            textShadow: "0 16px 34px rgba(220,38,38,0.28)",
          }}
        >
          {number || fitText(main, 12)}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 820,
          width: 740,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 18,
          zIndex: 10,
        }}
      >
        {elements.slice(1, 5).map((element, index) => (
          <Chip
            key={element.id}
            text={elementText(element, job.asset_slots)}
            color={roleColors[element.role] ?? COLORS.blueDeep}
            index={index}
            start={beatFrame + 42}
          />
        ))}
      </div>
    </>
  );
};

const ActionPath: React.FC<LayoutProps> = ({ job, beat, plan, beatFrame }) => {
  const frame = useCurrentFrame();
  const pathT = interpolate(frame - beatFrame, [10, 58], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const labels = plan.beats.slice(0, 5).map((item) => item.large_text || item.visual_goal).filter(Boolean);
  const activeIndex = Math.max(0, plan.beats.findIndex((item) => item.id === beat.id));
  return (
    <>
      <TopHeadline text={displayBeatText(beat, job.source_vu.one_screen_message)} start={beatFrame} />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, zIndex: 6, pointerEvents: "none" }}>
        <path
          d="M180 500 C320 600 280 760 440 850 S650 1030 780 1160"
          fill="none"
          stroke="rgba(37,99,235,0.22)"
          strokeWidth={26}
          strokeLinecap="round"
        />
        <path
          d="M180 500 C320 600 280 760 440 850 S650 1030 780 1160"
          fill="none"
          stroke={COLORS.blueDeep}
          strokeWidth={14}
          strokeLinecap="round"
          strokeDasharray={1200}
          strokeDashoffset={1200 * (1 - pathT)}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, zIndex: 8 }}>
        {labels.map((label, index) => {
          const positions = [
            { x: 120, y: 455 },
            { x: 290, y: 635 },
            { x: 390, y: 820 },
            { x: 585, y: 990 },
            { x: 725, y: 1120 },
          ];
          const pos = positions[index] ?? positions[positions.length - 1];
          const active = index === activeIndex;
          return (
            <Entrance key={index} start={beatFrame} delay={24 + index * 7} from="pop">
              <div
                style={{
                  position: "absolute",
                  left: pos.x,
                  top: pos.y,
                  width: active ? 260 : 210,
                  minHeight: 88,
                  borderRadius: 18,
                  background: active ? COLORS.blueDeep : "rgba(255,255,255,0.92)",
                  border: `3px solid ${COLORS.blueDeep}`,
                  color: active ? "white" : COLORS.ink,
                  boxShadow: active ? "0 18px 40px rgba(37,99,235,0.28)" : "0 10px 26px rgba(15,23,42,0.12)",
                  display: "grid",
                  placeItems: "center",
                  padding: "10px 14px",
                  fontFamily: FONTS.sans,
                  fontSize: active ? 31 : 25,
                  fontWeight: 950,
                  lineHeight: 1.12,
                  textAlign: "center",
                }}
              >
                {fitText(label, active ? 11 : 8)}
              </div>
            </Entrance>
          );
        })}
      </div>
    </>
  );
};

const MechanismWarning: React.FC<LayoutProps> = ({ job, beat, elements, beatFrame }) => {
  const frame = useCurrentFrame();
  const crack = interpolate(frame - beatFrame, [36, 72], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const nodes = elements.slice(0, 4);
  return (
    <>
      <TopHeadline text={displayBeatText(beat, job.source_vu.one_screen_message)} start={beatFrame} color={COLORS.red} />
      <Entrance start={beatFrame + 10} from="pop">
        <div
          style={{
            position: "absolute",
            left: 120,
            top: 430,
            width: 700,
            height: 270,
            borderRadius: 28,
            background: "rgba(254,226,226,0.9)",
            border: `5px solid ${COLORS.red}`,
            display: "grid",
            placeItems: "center",
            boxShadow: "0 24px 56px rgba(220,38,38,0.24)",
            zIndex: 9,
            fontFamily: FONTS.sans,
          }}
        >
          <div style={{ fontSize: 110, lineHeight: 1 }}>⚠️</div>
          <div style={{ fontSize: 46, fontWeight: 950, color: COLORS.red }}>
            {fitText(job.source_vu.one_screen_message, 14)}
          </div>
          <div
            style={{
              position: "absolute",
              left: 90,
              right: 90,
              top: 138,
              height: 8,
              background: COLORS.red,
              transform: `scaleX(${crack}) rotate(-7deg)`,
              transformOrigin: "left center",
              borderRadius: 999,
            }}
          />
        </div>
      </Entrance>
      <div style={{ position: "absolute", left: 78, top: 790, width: 780, display: "flex", gap: 14, zIndex: 10 }}>
        {nodes.map((element, index) => (
          <Entrance key={element.id} start={beatFrame} delay={60 + index * 9} from="down">
            <div
              style={{
                width: 184,
                height: 180,
                borderRadius: 20,
                background: "rgba(255,255,255,0.92)",
                border: `3px solid ${roleColors[element.role] ?? COLORS.red}`,
                boxShadow: "0 14px 32px rgba(15,23,42,0.13)",
                display: "grid",
                placeItems: "center",
                padding: 10,
              }}
            >
              <AssetVisual element={element} slots={job.asset_slots} label />
            </div>
          </Entrance>
        ))}
      </div>
    </>
  );
};

const ComparisonSplit: React.FC<LayoutProps> = ({ job, beat, elements, beatFrame }) => {
  const left = elements[0];
  const right = elements[1] ?? elements[0];
  return (
    <>
      <TopHeadline text={displayBeatText(beat, job.source_vu.one_screen_message)} start={beatFrame} />
      <Entrance start={beatFrame + 18} from="left">
        <div style={{ position: "absolute", left: 68, top: 450, width: 360, height: 580, zIndex: 9 }}>
          <ComparePanel element={left} slots={job.asset_slots} color={COLORS.red} />
        </div>
      </Entrance>
      <Entrance start={beatFrame + 30} from="right">
        <div style={{ position: "absolute", left: 520, top: 450, width: 360, height: 580, zIndex: 9 }}>
          <ComparePanel element={right} slots={job.asset_slots} color={COLORS.green} />
        </div>
      </Entrance>
      <Entrance start={beatFrame + 48} from="pop">
        <div
          style={{
            position: "absolute",
            left: 426,
            top: 670,
            width: 110,
            height: 110,
            borderRadius: "50%",
            background: COLORS.ink,
            color: "white",
            display: "grid",
            placeItems: "center",
            fontFamily: FONTS.num,
            fontSize: 50,
            fontWeight: 950,
            zIndex: 11,
            border: "5px solid white",
            boxShadow: "0 18px 40px rgba(15,23,42,0.38)",
          }}
        >
          VS
        </div>
      </Entrance>
    </>
  );
};

const ComparePanel: React.FC<{ element: VUElement; slots: AssetSlot[]; color: string }> = ({
  element,
  slots,
  color,
}) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      borderRadius: 28,
      background: "rgba(255,255,255,0.9)",
      border: `4px solid ${color}`,
      boxShadow: `0 22px 50px ${color}24`,
      display: "grid",
      placeItems: "center",
      padding: 22,
    }}
  >
    <AssetVisual element={element} slots={slots} large />
  </div>
);

const DecisionTree: React.FC<LayoutProps> = ({ job, beat, elements, beatFrame }) => {
  const branches = elements.slice(0, 2);
  return (
    <>
      <TopHeadline text={displayBeatText(beat, job.source_vu.one_screen_message)} start={beatFrame} />
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, zIndex: 6, pointerEvents: "none" }}>
        <line x1={470} y1={470} x2={250} y2={690} stroke={COLORS.green} strokeWidth={7} strokeLinecap="round" />
        <line x1={470} y1={470} x2={700} y2={690} stroke={COLORS.amber} strokeWidth={7} strokeLinecap="round" />
      </svg>
      {branches.map((element, index) => (
        <Entrance key={element.id} start={beatFrame + 28} delay={index * 12} from={index === 0 ? "left" : "right"}>
          <div
            style={{
              position: "absolute",
              left: index === 0 ? 80 : 532,
              top: 680,
              width: 335,
              height: 310,
              borderRadius: 24,
              background: "rgba(255,255,255,0.92)",
              border: `4px solid ${index === 0 ? COLORS.green : COLORS.amber}`,
              boxShadow: "0 18px 42px rgba(15,23,42,0.13)",
              display: "grid",
              placeItems: "center",
              padding: 18,
              zIndex: 10,
            }}
          >
            <AssetVisual element={element} slots={job.asset_slots} large={false} />
          </div>
        </Entrance>
      ))}
    </>
  );
};

const ConceptBalance: React.FC<LayoutProps> = ({ job, beat, beatFrame }) => {
  const frame = useCurrentFrame();
  const needle = interpolate(frame - beatFrame, [20, 88], [-42, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <>
      <TopHeadline text={displayBeatText(beat, job.source_vu.one_screen_message)} start={beatFrame} color={COLORS.green} />
      <div style={{ position: "absolute", left: 92, top: 520, width: 760, height: 500, zIndex: 9 }}>
        <svg width={760} height={500} viewBox="0 0 760 500">
          <path
            d="M90 390 A290 290 0 0 1 670 390"
            stroke="url(#balance-grad)"
            strokeWidth={74}
            fill="none"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="balance-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={COLORS.red} />
              <stop offset="48%" stopColor={COLORS.green} />
              <stop offset="52%" stopColor={COLORS.green} />
              <stop offset="100%" stopColor={COLORS.red} />
            </linearGradient>
          </defs>
          <g transform={`translate(380 390) rotate(${needle})`}>
            <line x1={0} y1={0} x2={0} y2={-265} stroke={COLORS.ink} strokeWidth={11} strokeLinecap="round" />
            <circle cx={0} cy={0} r={22} fill={COLORS.ink} />
          </g>
        </svg>
        <div style={{ position: "absolute", left: 300, top: 90, fontSize: 48, color: COLORS.green, fontFamily: FONTS.sans, fontWeight: 950 }}>
          平衡
        </div>
      </div>
    </>
  );
};

function familyLayout(family: PresentationFamily): React.FC<LayoutProps> {
  if (["kinetic_title", "object_shock_title", "pivot_title"].includes(family)) return KineticTitle;
  if (["data_pop", "overview_data"].includes(family)) return DataPop;
  if (["action_path", "value_summary"].includes(family)) return ActionPath;
  if (["mechanism_warning", "risk_stack", "mechanism_chain"].includes(family)) return MechanismWarning;
  if (["comparison_split", "replacement_compare"].includes(family)) return ComparisonSplit;
  if (family === "decision_tree") return DecisionTree;
  if (family === "concept_balance") return ConceptBalance;
  return StructuralBoard;
}

export const GenericVUClip: React.FC<GenericVUClipProps> = (props) => {
  const frame = useCurrentFrame();
  const durationFrames = Math.max(1, props.durationFrames || 150);
  const plan = props.plan ?? fallbackPlan(props.job);
  const beat = activeBeat(plan, frame, durationFrames);
  const beatFrame = beatStartFrame(beat, durationFrames);
  const elements = activeElements(plan, props.job, beat);
  const Layout = familyLayout(props.job.presentation_family);

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #F8FAFC 0%, #EAF2FF 48%, #DDEBFF 100%)",
        overflow: "hidden",
      }}
    >
      <BackgroundMotion family={props.job.presentation_family} />
      <Layout
        job={props.job}
        plan={plan}
        beat={beat}
        elements={elements}
        beatFrame={beatFrame}
        durationFrames={durationFrames}
        resolvedAssets={props.resolvedAssets}
      />
      <div
        style={{
          position: "absolute",
          left: STAGE.x,
          top: CANVAS_BOTTOM,
          width: STAGE.w,
          height: 1,
          opacity: 0,
        }}
      />
    </AbsoluteFill>
  );
};
