/**
 * Motion primitives — PPT-grade animation building blocks.
 *
 * 5 core patterns:
 *   1. MagicMove        — element persists across beats, smoothly interpolates between keyframe states
 *   2. StackReveal      — items pop in one after another with stagger
 *   3. PopIn            — single element appears with overshoot scale
 *   4. PathDraw         — SVG path stroke-dashoffset animation (writes itself)
 *   5. CountUp          — numeric ticker animation (0 → target)
 *
 * All driven by Remotion's spring + interpolate.
 */

import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// ─── Spring presets ─────────────────────────────────────────────
export const SPRINGS = {
  /** snappy entrance with light overshoot */
  enter: { mass: 0.8, damping: 14, stiffness: 120 } as const,
  /** very bouncy (pop emphasis) */
  pop:   { mass: 0.6, damping: 10, stiffness: 180 } as const,
  /** smooth glide (Magic Move) */
  glide: { mass: 1.0, damping: 22, stiffness: 95 } as const,
  /** quick exit no overshoot */
  exit:  { mass: 0.8, damping: 28, stiffness: 130 } as const,
};

type SpringConfig = (typeof SPRINGS)[keyof typeof SPRINGS];

// ─── Keyframe state for MagicMove ──────────────────────────────
export interface KeyframeState {
  /** absolute frame number when this state should be reached */
  frame: number;
  x?: number;       // px from left of canvas (center-aligned)
  y?: number;       // px from top of canvas (center-aligned)
  scale?: number;
  rotate?: number;  // deg
  opacity?: number;
  blur?: number;    // px
}

interface MagicMoveProps {
  states: KeyframeState[];
  springConfig?: SpringConfig;
  children: React.ReactNode;
  /** anchor point of children: 'center' (default) or 'top-left' */
  anchor?: "center" | "top-left";
}

/**
 * MagicMove — interpolate any element's transform between successive keyframe states.
 * The element is always rendered; properties tween smoothly using spring-driven interpolation.
 */
export const MagicMove: React.FC<MagicMoveProps> = ({
  states,
  springConfig = SPRINGS.glide,
  children,
  anchor = "center",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (states.length === 0) return null;

  // Find the surrounding keyframes
  const sorted = [...states].sort((a, b) => a.frame - b.frame);
  const before = [...sorted].reverse().find((s) => s.frame <= frame) ?? sorted[0];
  const after = sorted.find((s) => s.frame > frame) ?? sorted[sorted.length - 1];

  // Compute progress between before and after using spring
  // CRITICAL: detect "hold" segments (where all properties are identical)
  // and skip spring evaluation, otherwise spring oscillates around 1.0
  // and causes the element to jitter/twitch every frame.
  const isHold =
    (before.x ?? 540) === (after.x ?? 540) &&
    (before.y ?? 960) === (after.y ?? 960) &&
    (before.scale ?? 1) === (after.scale ?? 1) &&
    (before.rotate ?? 0) === (after.rotate ?? 0) &&
    (before.opacity ?? 1) === (after.opacity ?? 1) &&
    (before.blur ?? 0) === (after.blur ?? 0);

  let t: number;
  if (before === after || after.frame === before.frame || isHold) {
    t = 1;
  } else {
    const segmentLen = after.frame - before.frame;
    const localFrame = frame - before.frame;
    const linearProgress = Math.max(0, Math.min(1, localFrame / segmentLen));
    // Apply spring easing on the segment
    t = spring({
      frame: localFrame,
      fps,
      config: springConfig,
      durationInFrames: segmentLen,
    });
    t = Math.max(0, Math.min(1, t || linearProgress));
  }

  const lerp = (a: number, b: number) => a + (b - a) * t;
  const pick = (k: keyof KeyframeState, fallback: number) =>
    lerp(
      (before[k] as number | undefined) ?? fallback,
      (after[k] as number | undefined) ?? (before[k] as number | undefined) ?? fallback
    );

  const x = pick("x", 540);
  const y = pick("y", 960);
  const scale = pick("scale", 1);
  const rotate = pick("rotate", 0);
  const opacity = pick("opacity", 1);
  const blur = pick("blur", 0);

  const transformOrigin = anchor === "center" ? "center" : "top left";
  const translate =
    anchor === "center"
      ? `translate(-50%, -50%) translate(${x}px, ${y}px)`
      : `translate(${x}px, ${y}px)`;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        transform: `${translate} scale(${scale}) rotate(${rotate}deg)`,
        transformOrigin,
        opacity,
        filter: blur > 0 ? `blur(${blur}px)` : undefined,
        willChange: "transform, opacity, filter",
      }}
    >
      {children}
    </div>
  );
};

// ─── PopIn ──────────────────────────────────────────────────────
interface PopInProps {
  /** frame when the pop-in should start */
  startFrame: number;
  /** how long the pop animation lasts (frames) */
  durationFrames?: number;
  springConfig?: SpringConfig;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export const PopIn: React.FC<PopInProps> = ({
  startFrame,
  durationFrames = 18,
  springConfig = SPRINGS.pop,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - startFrame;
  if (local < 0) {
    return <div style={{ ...style, opacity: 0 }}>{children}</div>;
  }
  const t = spring({ frame: local, fps, config: springConfig, durationInFrames: durationFrames });
  const scale = interpolate(t, [0, 1], [0.4, 1], { extrapolateRight: "clamp" });
  const opacity = interpolate(local, [0, 6], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ ...style, transform: `scale(${scale})`, opacity, willChange: "transform, opacity" }}>
      {children}
    </div>
  );
};

// ─── StackReveal ────────────────────────────────────────────────
interface StackRevealProps {
  /** frame when first child starts animating in */
  startFrame: number;
  /** frames between each child */
  staggerFrames?: number;
  /** springConfig for each item */
  springConfig?: SpringConfig;
  /** direction of the slide */
  slideFrom?: "below" | "right" | "left" | "above";
  /** slide distance in px */
  slideDistance?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export const StackReveal: React.FC<StackRevealProps> = ({
  startFrame,
  staggerFrames = 8,
  springConfig = SPRINGS.enter,
  slideFrom = "below",
  slideDistance = 40,
  children,
  style,
}) => {
  const items = React.Children.toArray(children);
  return (
    <div style={style}>
      {items.map((child, i) => (
        <StackRevealItem
          key={i}
          startFrame={startFrame + i * staggerFrames}
          springConfig={springConfig}
          slideFrom={slideFrom}
          slideDistance={slideDistance}
        >
          {child}
        </StackRevealItem>
      ))}
    </div>
  );
};

interface StackRevealItemProps {
  startFrame: number;
  springConfig: SpringConfig;
  slideFrom: "below" | "right" | "left" | "above";
  slideDistance: number;
  children: React.ReactNode;
}

const StackRevealItem: React.FC<StackRevealItemProps> = ({
  startFrame,
  springConfig,
  slideFrom,
  slideDistance,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - startFrame;
  if (local < 0) return <div style={{ opacity: 0 }}>{children}</div>;
  const t = spring({ frame: local, fps, config: springConfig, durationInFrames: 18 });
  const opacity = interpolate(local, [0, 6], [0, 1], { extrapolateRight: "clamp" });

  let dx = 0, dy = 0;
  switch (slideFrom) {
    case "below": dy = (1 - t) * slideDistance; break;
    case "above": dy = (t - 1) * slideDistance; break;
    case "right": dx = (1 - t) * slideDistance; break;
    case "left":  dx = (t - 1) * slideDistance; break;
  }
  return (
    <div
      style={{
        opacity,
        transform: `translate(${dx}px, ${dy}px)`,
        willChange: "transform, opacity",
      }}
    >
      {children}
    </div>
  );
};

// ─── CountUp ────────────────────────────────────────────────────
interface CountUpProps {
  startFrame: number;
  durationFrames?: number;
  from?: number;
  to: number;
  format?: (n: number) => string;
  style?: React.CSSProperties;
}

export const CountUp: React.FC<CountUpProps> = ({
  startFrame,
  durationFrames = 24,
  from = 0,
  to,
  format = (n) => Math.round(n).toString(),
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - startFrame;
  if (local < 0) return <span style={{ ...style, opacity: 0 }}>{format(from)}</span>;
  const t = spring({ frame: local, fps, config: SPRINGS.glide, durationInFrames: durationFrames });
  const value = from + (to - from) * Math.max(0, Math.min(1, t));
  return <span style={style}>{format(value)}</span>;
};

// ─── PathDraw ───────────────────────────────────────────────────
interface PathDrawProps {
  startFrame: number;
  durationFrames?: number;
  d: string;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  /** approx pathLength so we don't need DOM measurement */
  pathLength?: number;
  style?: React.CSSProperties;
}

export const PathDraw: React.FC<PathDrawProps> = ({
  startFrame,
  durationFrames = 30,
  d,
  stroke = "#DC2626",
  strokeWidth = 4,
  fill = "none",
  pathLength = 1000,
  style,
}) => {
  const frame = useCurrentFrame();
  const local = frame - startFrame;
  const t = local <= 0 ? 0 : Math.min(1, local / durationFrames);
  return (
    <path
      d={d}
      stroke={stroke}
      strokeWidth={strokeWidth}
      fill={fill}
      strokeDasharray={pathLength}
      strokeDashoffset={pathLength * (1 - t)}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    />
  );
};
