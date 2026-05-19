import type { DSLAction, DSLBeat, DSLDoc } from "./schema";

const DEFAULT_DURATIONS_S: Record<string, number> = {
  PopIn: 0.6,
  MagicMove: 0.7,
  StackReveal: 0.8,
  PathDraw: 1.0,
  CountUp: 0.9,
  Fade: 0.4,
  Strike: 0.6,
  Collapse: 0.7,
  SetState: 0,
};

export type Zone = { x: number; y: number };
export type ZoneTable = Record<string, Zone>;

export interface ElementSnapshot {
  visible: boolean;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  rotate: number;
  pathProgress: number;
  countValue: number | null;
  strikeProgress: number;
  childHighlight: Record<string, boolean>;
  appearedFrame: number | null;
}

export function resolveTimeRef(ref: string, beats: DSLBeat[]): number {
  const m = ref.match(/^(b\d+)([+-])(\d+(?:\.\d+)?)s$/);
  if (!m) throw new Error(`Invalid time ref: ${ref}`);
  const [, beatId, sign, offset] = m;
  const beat = beats.find((b) => b.id === beatId);
  if (!beat) throw new Error(`Unknown beat: ${beatId}`);
  const offsetSec = parseFloat(offset);
  return sign === "+" ? beat.start_s + offsetSec : beat.end_s - offsetSec;
}

function clamp(v: number, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function resolveZone<T extends Zone | null>(
  name: string | undefined,
  zones: ZoneTable,
  fallback: T,
): T extends null ? Zone | null : Zone {
  if (!name) return fallback as never;
  const zone = zones[name];
  if (zone) return zone;
  const center = zones.stage_center;
  if (typeof console !== "undefined") {
    console.warn(`[dsl] unknown zone "${name}" — falling back to stage_center`);
  }
  return (center ?? fallback ?? { x: 540, y: 960 }) as never;
}

function easeOutCubic(t: number) {
  const x = clamp(t);
  return 1 - Math.pow(1 - x, 3);
}

function easeOutBack(t: number) {
  const x = clamp(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function initialSnapshot(zones: ZoneTable): ElementSnapshot {
  const start = zones.stage_center ?? { x: 540, y: 960 };
  return {
    visible: false,
    x: start.x,
    y: start.y,
    scale: 1,
    opacity: 0,
    rotate: 0,
    pathProgress: 0,
    countValue: null,
    strikeProgress: 0,
    childHighlight: {},
    appearedFrame: null,
  };
}

interface ResolvedAction extends DSLAction {
  _t: number;
}

function actionsForElement(elementId: string, doc: DSLDoc): ResolvedAction[] {
  return doc.timeline
    .filter((a) => a.el.split(".")[0].split("[")[0] === elementId)
    .map((a) => ({ ...a, _t: resolveTimeRef(a.at, doc.beats) }))
    .sort((a, b) => a._t - b._t);
}

export function computeSnapshot(
  elementId: string,
  doc: DSLDoc,
  zones: ZoneTable,
  fps: number,
  frame: number,
): ElementSnapshot {
  const currentSec = frame / fps;
  let snap = initialSnapshot(zones);

  for (const action of actionsForElement(elementId, doc)) {
    if (currentSec < action._t) break;
    const localSec = currentSec - action._t;
    const durSec = action.duration_s ?? DEFAULT_DURATIONS_S[action.do] ?? 0.6;
    const rawT = durSec <= 0 ? 1 : clamp(localSec / durSec);

    switch (action.do) {
      case "PopIn": {
        const target = resolveZone(action.at_zone, zones, { x: snap.x, y: snap.y });
        const targetScale = action.scale ?? 1;
        const eased = easeOutBack(rawT);
        snap = {
          ...snap,
          visible: true,
          x: target.x,
          y: target.y,
          scale: 0.4 + (targetScale - 0.4) * eased,
          opacity: clamp(rawT * 3),
        };
        break;
      }
      case "MagicMove": {
        const start = snap;
        const target = action.to_zone ? resolveZone(action.to_zone, zones, null) : null;
        const targetScale = action.scale ?? action.to_scale ?? start.scale;
        const eased = easeOutCubic(rawT);
        snap = {
          ...start,
          visible: true,
          x: target ? start.x + (target.x - start.x) * eased : start.x,
          y: target ? start.y + (target.y - start.y) * eased : start.y,
          scale: start.scale + (targetScale - start.scale) * eased,
        };
        break;
      }
      case "Collapse": {
        const start = snap;
        const target = action.to_zone ? resolveZone(action.to_zone, zones, null) : null;
        const targetScale = action.to_scale ?? action.scale ?? 0.62;
        const eased = easeOutCubic(rawT);
        snap = {
          ...start,
          x: target ? start.x + (target.x - start.x) * eased : start.x,
          y: target ? start.y + (target.y - start.y) * eased : start.y,
          scale: start.scale + (targetScale - start.scale) * eased,
        };
        break;
      }
      case "Fade": {
        const startOpacity = snap.opacity;
        const targetOpacity = action.to ?? 1;
        const target = action.at_zone ? resolveZone(action.at_zone, zones, null) : null;
        const t = clamp(rawT);
        const opacity = startOpacity + (targetOpacity - startOpacity) * t;
        snap = {
          ...snap,
          visible: opacity > 0.001,
          opacity,
          x: target?.x ?? snap.x,
          y: target?.y ?? snap.y,
        };
        break;
      }
      case "StackReveal": {
        const target = action.at_zone ? resolveZone(action.at_zone, zones, null) : null;
        snap = {
          ...snap,
          visible: true,
          opacity: 1,
          scale: 1,
          x: target?.x ?? snap.x,
          y: target?.y ?? snap.y,
          appearedFrame: Math.round(action._t * fps),
        };
        break;
      }
      case "PathDraw": {
        const target = action.at_zone ? resolveZone(action.at_zone, zones, null) : null;
        snap = {
          ...snap,
          visible: true,
          opacity: 1,
          x: target?.x ?? snap.x,
          y: target?.y ?? snap.y,
          pathProgress: rawT,
        };
        break;
      }
      case "CountUp": {
        const from = action.from ?? 0;
        const to = action.to ?? 0;
        snap = {
          ...snap,
          countValue: from + (to - from) * easeOutCubic(rawT),
        };
        break;
      }
      case "Strike": {
        snap = { ...snap, strikeProgress: rawT };
        break;
      }
      case "SetState": {
        const idxMatch = action.el.match(/items\[(\d+)\]/);
        if (idxMatch) {
          const idx = idxMatch[1];
          snap = {
            ...snap,
            childHighlight: { ...snap.childHighlight, [idx]: true },
          };
        }
        break;
      }
    }
  }

  const el = doc.elements.find((e) => e.id === elementId);
  if (el && el.type === "numbered_list") {
    el.items.forEach((item, idx) => {
      if (item.highlight_at) {
        const t = resolveTimeRef(item.highlight_at, doc.beats);
        if (currentSec >= t) {
          snap.childHighlight[String(idx)] = true;
        }
      }
    });
  }

  return snap;
}
