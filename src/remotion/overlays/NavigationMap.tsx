/**
 * NavigationMap 导览图叠层 v3
 *
 * 动画升级：
 * - 容器：slideUp heavy spring（从 60px 下方升入）
 * - 标题 "内容导览"：blurIn smooth spring
 * - 节点 stagger 入场：slideUp + blurIn，每节点间隔 6 帧
 * - 连接线：height spring 动画，跟随上方节点
 * - 活跃节点：pulseGlowShadow 呼吸发光 + sin 波微缩放
 * - 已完成节点：SVG 勾号 stroke-dashoffset 描绘动画 + 完成闪光
 * - 待定节点：opacity 0.6，无动画
 * - Flash 退出：smooth interpolate 淡出
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";
import { AbsoluteFill } from "remotion";
import {
  BORDER_RADIUS,
  FONT_FAMILY,
  SEMANTIC_COLORS,
  SHADOWS,
  TYPOGRAPHY,
  withAlpha,
} from "../design-system";
import { SCENE_TONE } from "../visual-language";
import type {
  VisualNavAppearance,
  VisualTopicNode,
} from "../../compose/visual-planner";
import {
  slideUp,
  blurIn,
  stagger,
  mergeStyles,
  SPRING_PRESETS,
} from "../animations/index";
import { pulseGlowShadow } from "../animations/compose";

// ========== AnimatedCheckmark sub-component ==========

/**
 * SVG checkmark with stroke-dashoffset draw animation.
 * Path "M6 13 L10.5 17.5 L18 8" within a 24x24 viewBox.
 * Animated over 12 frames using Easing.out(quad).
 */
const AnimatedCheckmark: React.FC<{
  frame: number;
  startFrame: number;
  color?: string;
  size?: number;
}> = ({ frame, startFrame, color = "#FFFFFF", size = 24 }) => {
  const totalLength = 18.47;
  const animDuration = 12;

  const elapsed = frame - startFrame;
  const rawProgress = interpolate(elapsed, [0, animDuration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });

  const dashOffset = totalLength * (1 - rawProgress);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ display: "block" }}
    >
      <path
        d="M6 13 L10.5 17.5 L18 8"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={totalLength}
        strokeDashoffset={dashOffset}
      />
    </svg>
  );
};

// ========== ConnectorLine ==========

/**
 * Connector line between nodes.
 * Height animates from 0 to 24px using spring, following the node above.
 */
const ConnectorLine: React.FC<{
  isCompleted: boolean;
  frame: number;
  fps: number;
  staggerIdx: number;
  exitStyle: { opacity: number; transform?: string; filter?: string };
}> = ({ isCompleted, frame, fps, staggerIdx, exitStyle }) => {
  const nodeDelay = stagger(staggerIdx, 6);
  const connectorDelay = nodeDelay + 3;

  const heightProgress = spring({
    frame: frame - connectorDelay,
    fps,
    config: SPRING_PRESETS.snappy,
    durationInFrames: 15,
  });

  const animatedHeight = interpolate(heightProgress, [0, 1], [0, 24]);
  const lineOpacity = interpolate(heightProgress, [0, 0.3], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: 4,
        height: animatedHeight,
        borderRadius: 2,
        background: isCompleted
          ? SEMANTIC_COLORS.positive
          : withAlpha("#0F172A", 0.15),
        opacity: lineOpacity * exitStyle.opacity,
        overflow: "hidden",
      }}
    />
  );
};

// ========== NavNodeCard ==========

/**
 * Individual navigation node card with v3 animations:
 * - Stagger entrance: slideUp + blurIn, 6 frames apart
 * - Active: glow pulse breathing + scale breathing via sin wave
 * - Completed: animated SVG checkmark + subtle completion flash
 * - Pending: opacity 0.6
 */
const NavNodeCard: React.FC<{
  node: VisualTopicNode;
  isActive: boolean;
  isCompleted: boolean;
  isPending: boolean;
  frame: number;
  fps: number;
  staggerIdx: number;
  toneColor: string;
  exitStyle: { opacity: number; transform?: string; filter?: string };
}> = ({
  node,
  isActive,
  isCompleted,
  isPending,
  frame,
  fps,
  staggerIdx,
  toneColor,
  exitStyle,
}) => {
  // ---- Stagger entrance: slideUp + blurIn, 6 frames apart ----
  const delay = stagger(staggerIdx, 6);
  const entrySlide = slideUp(frame, delay, fps, "snappy", 40);
  const entryBlur = blurIn(frame, delay, fps, "smooth");
  const entryMerged = mergeStyles(entrySlide, entryBlur);

  // ---- Active node animations ----
  let activeScale = 1;
  let activeGlow: string | undefined;

  if (isActive) {
    const periodMs = 1200;
    const periodFrames = (periodMs / 1000) * fps;
    const phase = (frame % periodFrames) / periodFrames;
    activeScale = 1 + 0.03 * Math.sin(phase * Math.PI * 2);

    activeGlow = pulseGlowShadow(
      frame,
      fps,
      toneColor,
      1200,
      28,
      10,
    );
  }

  // ---- Completed node: subtle flash on completion ----
  let completionFlash = 1;
  if (isCompleted) {
    const flashStart = delay;
    const elapsed = frame - flashStart;
    if (elapsed >= 0 && elapsed < 14) {
      completionFlash = interpolate(elapsed, [0, 3, 14], [1, 1.4, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
  }

  // ---- Pending node: dimmed but still legible ----
  const pendingDim = isPending ? 0.6 : 1;

  // ---- Build final opacity ----
  const combinedOpacity =
    entryMerged.opacity * exitStyle.opacity * pendingDim * completionFlash;

  // ---- Build final transform ----
  const transforms: string[] = [];
  if (entryMerged.transform) transforms.push(entryMerged.transform);
  if (exitStyle.transform) transforms.push(exitStyle.transform);
  if (activeScale !== 1) transforms.push(`scale(${activeScale})`);
  const finalTransform =
    transforms.length > 0 ? transforms.join(" ") : undefined;

  // ---- Build final filter ----
  const filters: string[] = [];
  if (entryMerged.filter) filters.push(entryMerged.filter);
  if (exitStyle.filter) filters.push(exitStyle.filter);
  const finalFilter = filters.length > 0 ? filters.join(" ") : undefined;

  // ---- Card style by state ----
  const navCardBase: React.CSSProperties = {
    borderRadius: BORDER_RADIUS.md,
    border: `1px solid ${withAlpha("#0F172A", 0.1)}`,
    boxShadow: SHADOWS.card,
    padding: "24px 28px",
  };

  let cardStyles: React.CSSProperties;

  if (isActive) {
    cardStyles = {
      ...navCardBase,
      background: toneColor,
      borderColor: toneColor,
      boxShadow: activeGlow,
    };
  } else if (isCompleted) {
    cardStyles = {
      ...navCardBase,
      background: "rgba(255, 255, 255, 0.96)",
      borderLeft: `5px solid ${SEMANTIC_COLORS.positive}`,
    };
  } else {
    cardStyles = {
      ...navCardBase,
      background: "rgba(255, 255, 255, 0.90)",
      borderColor: withAlpha("#0F172A", 0.1),
    };
  }

  const checkmarkStartFrame = delay + 8;

  return (
    <div
      style={{
        ...cardStyles,
        opacity: combinedOpacity,
        transform: finalTransform,
        filter: finalFilter,
        width: "100%",
        padding: "20px 28px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        willChange: "transform, opacity, filter",
      }}
    >
      {/* 状态指示器圆圈 */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          background: isActive
            ? toneColor
            : isCompleted
              ? SEMANTIC_COLORS.positive
              : withAlpha("#0F172A", 0.15),
        }}
      >
        {isCompleted ? (
          <AnimatedCheckmark
            frame={frame}
            startFrame={checkmarkStartFrame}
            color="#FFFFFF"
            size={22}
          />
        ) : (
          <span
            style={{
              color: "#FFFFFF",
              fontSize: 18,
              fontWeight: 700,
              fontFamily: FONT_FAMILY.sans,
            }}
          >
            {isActive ? "\u25CF" : `${staggerIdx + 1}`}
          </span>
        )}
      </div>

      {/* 节点标签 */}
      <span
        style={{
          color: isActive
            ? "#FFFFFF"
            : isCompleted
              ? withAlpha("#0F172A", 0.88)
              : withAlpha("#0F172A", 0.65),
          fontSize: TYPOGRAPHY.body.fontSize - 10,
          fontWeight: isActive ? 700 : 500,
          fontFamily: FONT_FAMILY.sans,
          lineHeight: 1.3,
        }}
      >
        {node.label}
      </span>
    </div>
  );
};

// ========== Main Component ==========

interface NavigationMapProps {
  appearance: VisualNavAppearance;
  nodes: VisualTopicNode[];
}

export const NavigationMap: React.FC<NavigationMapProps> = ({
  appearance,
  nodes,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tone = SCENE_TONE[appearance.tone];

  const totalFrames = Math.max(1, appearance.endFrame - appearance.startFrame);

  // ---- Container entrance: slideUp with heavy spring (60px) ----
  const containerEntry = slideUp(frame, 0, fps, "heavy", 60);

  // ---- Exit handling ----
  let exitStyle = { opacity: 1 } as {
    opacity: number;
    transform?: string;
    filter?: string;
  };

  if (appearance.type === "flash") {
    const fadeOutStart = totalFrames - Math.round(0.4 * fps);
    const exitOpacity = interpolate(
      frame,
      [fadeOutStart, totalFrames],
      [1, 0],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.quad),
      },
    );
    exitStyle = { opacity: exitOpacity };
  }

  // Merge container entry + exit
  const containerStyle = mergeStyles(containerEntry, exitStyle);

  // ---- Title: blurIn with smooth spring ----
  const titleStyle = blurIn(frame, 0, fps, "smooth");
  const titleMerged = mergeStyles(titleStyle, exitStyle);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: "60px",
        // 不透明遮罩：确保导览图完全覆盖底层场景内容
        backgroundColor: "rgba(246, 250, 255, 1)",
      }}
    >
      {/* 大导览图容器 */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
          width: "80%",
          maxWidth: 800,
          opacity: containerStyle.opacity,
          transform: containerStyle.transform,
          filter: containerStyle.filter,
        }}
      >
        {/* 导览图标题 */}
        <div
          style={{
            marginBottom: 32,
            opacity: titleMerged.opacity * 0.7,
            filter: titleMerged.filter,
          }}
        >
          <span
            style={{
              color: withAlpha("#0F172A", 0.5),
              fontSize: TYPOGRAPHY.body.fontSize - 6,
              fontWeight: 500,
              fontFamily: FONT_FAMILY.sans,
              letterSpacing: 3,
            }}
          >
            内容导览
          </span>
        </div>

        {nodes.map((node, idx) => {
          const isActive = node.id === appearance.activeNode;
          const isCompleted = appearance.completedNodes.includes(node.id);
          const isPending = !isActive && !isCompleted;

          return (
            <React.Fragment key={node.id}>
              <NavNodeCard
                node={node}
                isActive={isActive}
                isCompleted={isCompleted}
                isPending={isPending}
                frame={frame}
                fps={fps}
                staggerIdx={idx}
                toneColor={tone.solid}
                exitStyle={exitStyle}
              />
              {/* 连接线 */}
              {idx < nodes.length - 1 && (
                <ConnectorLine
                  isCompleted={isCompleted}
                  frame={frame}
                  fps={fps}
                  staggerIdx={idx}
                  exitStyle={exitStyle}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
