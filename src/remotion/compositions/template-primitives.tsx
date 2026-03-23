import React from "react";
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import type { Scene } from "../types";
import {
  BORDER_RADIUS,
  FONT_FAMILY,
  GLASS_CARD,
  SAFE_AREA,
  SHADOWS,
  TYPOGRAPHY,
  textColor,
  withAlpha,
} from "../design-system";
import { SCENE_TONE, VISUAL_SHELL, type SceneTone } from "../visual-language";

export interface PlannerMeta {
  role: string;
  tone: SceneTone;
  layout: string;
  topicLabel: string;
  isTopicEntry: boolean;
  isOverlay: boolean;
}

export function getPlannerMeta(scene: Scene): PlannerMeta {
  const props = scene.template_props ?? {};
  return {
    role: String(props.planner_role ?? "analysis"),
    tone: (props.planner_tone as SceneTone | undefined) ?? "brand",
    layout: String(props.planner_layout ?? (scene.view === "overlay" ? "overlay_left" : "board")),
    topicLabel: String(props.planner_topic_label ?? scene.title ?? "Topic"),
    isTopicEntry: props.planner_is_topic_entry === true,
    isOverlay: scene.view === "overlay",
  };
}

export function roleLabel(role: string): string {
  switch (role) {
    case "opener":
      return "OPENING";
    case "topic_entry":
      return "TOPIC";
    case "warning":
      return "RISK";
    case "comparison":
      return "COMPARE";
    case "summary":
      return "SUMMARY";
    case "bridge":
      return "BRIDGE";
    default:
      return "DETAILS";
  }
}

function resolveStageWidth(meta: PlannerMeta, maxWidth?: number): number {
  if (typeof maxWidth === "number") {
    return maxWidth;
  }

  if (meta.layout === "overlay_center") {
    return VISUAL_SHELL.overlayPanelWidth;
  }

  if (meta.layout === "stack" || meta.layout === "split_board") {
    return meta.isOverlay ? VISUAL_SHELL.overlayWideWidth : VISUAL_SHELL.graphicsPanelWidth;
  }

  if (meta.layout === "spotlight" || meta.layout === "board") {
    return meta.isOverlay ? VISUAL_SHELL.overlayWideWidth : VISUAL_SHELL.graphicsPanelWidth;
  }

  return meta.isOverlay ? VISUAL_SHELL.overlayPanelWidth : VISUAL_SHELL.graphicsPanelWidth;
}

interface TemplateStageProps {
  scene: Scene;
  children: ReactNode;
  maxWidth?: number;
  vertical?: "top" | "center";
  gap?: number;
}

export const TemplateStage: React.FC<TemplateStageProps> = ({
  scene,
  children,
  maxWidth,
  vertical,
  gap = VISUAL_SHELL.sectionGap,
}) => {
  const meta = getPlannerMeta(scene);
  const alignItems = "center" as const;
  const justifyContent =
    vertical ?? (meta.layout === "spotlight" || meta.layout === "overlay_center" ? "center" : "flex-start");
  const topPadding =
    justifyContent === "center"
      ? SAFE_AREA.top
      : SAFE_AREA.top + (meta.isOverlay ? VISUAL_SHELL.overlayTopOffset : 28);
  const bottomPadding = meta.isOverlay
    ? Math.max(160, SAFE_AREA.bottom - VISUAL_SHELL.overlayBottomInset)
    : SAFE_AREA.bottom;

  return (
    <AbsoluteFill
      style={{
        padding: `${topPadding}px ${SAFE_AREA.horizontal}px ${bottomPadding}px`,
        display: "flex",
        flexDirection: "column",
        alignItems,
        justifyContent,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: resolveStageWidth(meta, maxWidth),
          display: "flex",
          flexDirection: "column",
          gap,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

interface EyebrowProps {
  label: string;
  tone?: SceneTone;
}

export const EyebrowPill: React.FC<EyebrowProps> = ({ label, tone = "brand" }) => {
  const palette = SCENE_TONE[tone];
  return (
    <div
      style={{
        alignSelf: "flex-start",
        padding: "8px 14px",
        borderRadius: BORDER_RADIUS.full,
        background: palette.soft,
        border: `1px solid ${palette.border}`,
        color: palette.solid,
        fontFamily: FONT_FAMILY.sans,
        fontSize: TYPOGRAPHY.caption.fontSize - 10,
        fontWeight: 700,
        letterSpacing: 1.2,
      }}
    >
      {label}
    </div>
  );
};

interface TemplateHeaderProps {
  scene: Scene;
  title?: string;
  eyebrow?: string;
  tone?: SceneTone;
  align?: "left" | "center";
  description?: string;
}

export const TemplateHeader: React.FC<TemplateHeaderProps> = ({
  scene,
  title,
  eyebrow,
  tone,
  align = "left",
  description,
}) => {
  const meta = getPlannerMeta(scene);
  const palette = SCENE_TONE[tone ?? meta.tone];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        textAlign: align,
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          justifyContent: align === "center" ? "center" : "flex-start",
        }}
      >
        {eyebrow ? <EyebrowPill label={eyebrow} tone={tone ?? meta.tone} /> : null}
        <div
          style={{
            fontFamily: FONT_FAMILY.sans,
            fontSize: TYPOGRAPHY.caption.fontSize - 10,
            fontWeight: 700,
            color: withAlpha("#0F172A", 0.52),
            letterSpacing: 1.2,
          }}
        >
          {meta.topicLabel}
        </div>
      </div>

      {(title ?? scene.title) && (
        <div
          style={{
            fontFamily: FONT_FAMILY.sans,
            fontSize: Math.round(TYPOGRAPHY.body.fontSize * 0.95),
            fontWeight: 700,
            lineHeight: 1.15,
            color: textColor(1),
            maxWidth: "100%",
          }}
        >
          {title ?? scene.title}
        </div>
      )}

      {description && (
        <div
          style={{
            fontFamily: FONT_FAMILY.sans,
            fontSize: TYPOGRAPHY.caption.fontSize - 4,
            fontWeight: 500,
            lineHeight: 1.25,
            color: withAlpha("#0F172A", 0.6),
          }}
        >
          {description}
        </div>
      )}

      <div
        style={{
          width: 92,
          height: 4,
          borderRadius: BORDER_RADIUS.full,
          background: `linear-gradient(90deg, ${palette.solid}, ${withAlpha(palette.solid, 0.22)})`,
        }}
      />
    </div>
  );
};

interface TemplatePanelProps {
  children: ReactNode;
  tone?: SceneTone;
  accent?: "left" | "top" | "none";
  padding?: string;
  style?: CSSProperties;
}

export const TemplatePanel: React.FC<TemplatePanelProps> = ({
  children,
  tone = "brand",
  accent = "none",
  padding = "26px 28px",
  style,
}) => {
  const palette = SCENE_TONE[tone];
  const accentStyle =
    accent === "left"
      ? { borderLeft: `6px solid ${palette.solid}` }
      : accent === "top"
      ? { borderTop: `6px solid ${palette.solid}` }
      : {};

  return (
    <div
      style={{
        ...GLASS_CARD,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${palette.border}`,
        boxShadow: `${SHADOWS.card}, 0 0 0 1px ${palette.glow}`,
        background: palette.gradient,
        padding,
        position: "relative",
        overflow: "hidden",
        ...accentStyle,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const SectionNote: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div
    style={{
      fontFamily: FONT_FAMILY.sans,
      fontSize: TYPOGRAPHY.caption.fontSize - 6,
      fontWeight: 600,
      lineHeight: 1.25,
      color: withAlpha("#0F172A", 0.56),
    }}
  >
    {children}
  </div>
);

export const AccentBadge: React.FC<{
  label: ReactNode;
  tone?: SceneTone;
  size?: "sm" | "md" | "lg";
}> = ({ label, tone = "brand", size = "md" }) => {
  const palette = SCENE_TONE[tone];
  const dim =
    size === "sm" ? 34 : size === "lg" ? 64 : 42;
  const fs =
    size === "sm"
      ? TYPOGRAPHY.caption.fontSize - 10
      : size === "lg"
      ? 40
      : TYPOGRAPHY.caption.fontSize - 6;
  const pad =
    size === "sm" ? "0 10px" : size === "lg" ? "0 14px" : "0 12px";
  return (
    <div
      style={{
        minWidth: dim,
        height: dim,
        padding: pad,
        borderRadius: BORDER_RADIUS.full,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: palette.soft,
        border: `1px solid ${palette.border}`,
        color: palette.solid,
        fontFamily: FONT_FAMILY.number,
        fontSize: fs,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
};
