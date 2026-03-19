/**
 * 字幕层 — 逐字跟随语音的卡拉OK式字幕
 *
 * 位置：画面底部 15%
 * 效果：半透明深色背景 pill + 白色文字，已说的字全白，未说的半透明
 * 按 ~16 字自动分行，在自然停顿处（时间间隔 >0.5s）优先断行
 * 如果逐词对齐置信不足，则退化为静态整句字幕，避免显示错误词流。
 */

import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { Word } from "../../schemas/blueprint";
import { FONT_FAMILY } from "../design-system";

const MAX_LINE_CHARS = 16;
const PAUSE_BREAK_THRESHOLD = 0.5;
const LINGER_AFTER = 0.3;
const SUBTITLE_FONT_SIZE = 42;
const SUBTITLE_BOTTOM = "15%";

interface SubtitleLine {
  words: Word[];
  text: string;
  startTime: number;
  endTime: number;
}

function groupWordsIntoLines(
  words: Word[],
  atomOriginalStart: number
): SubtitleLine[] {
  if (words.length === 0) return [];

  const lines: SubtitleLine[] = [];
  let currentWords: Word[] = [];
  let currentText = "";

  for (const word of words) {
    const wordText = word.text;
    const timeGap =
      currentWords.length > 0
        ? word.start - currentWords[currentWords.length - 1].end
        : 0;
    const charOverflow =
      currentText.length + wordText.length > MAX_LINE_CHARS &&
      currentWords.length > 0;
    const pauseBreak =
      timeGap > PAUSE_BREAK_THRESHOLD && currentWords.length > 0;

    if (charOverflow || pauseBreak) {
      lines.push({
        words: [...currentWords],
        text: currentText,
        startTime: currentWords[0].start - atomOriginalStart,
        endTime: currentWords[currentWords.length - 1].end - atomOriginalStart,
      });
      currentWords = [];
      currentText = "";
    }

    currentWords.push(word);
    currentText += wordText;
  }

  if (currentWords.length > 0) {
    lines.push({
      words: [...currentWords],
      text: currentText,
      startTime: currentWords[0].start - atomOriginalStart,
      endTime: currentWords[currentWords.length - 1].end - atomOriginalStart,
    });
  }

  return lines;
}

export interface SubtitleProps {
  words: Word[];
  atomOriginalStart: number;
  fallbackText?: string;
}

export const Subtitle: React.FC<SubtitleProps> = ({
  words,
  atomOriginalStart,
  fallbackText,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const lines = useMemo(
    () => groupWordsIntoLines(words, atomOriginalStart),
    [words, atomOriginalStart]
  );

  if (lines.length === 0) {
    if (!fallbackText) return null;

    return (
      <div
        style={{
          position: "absolute",
          bottom: SUBTITLE_BOTTOM,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.55)",
            borderRadius: 12,
            padding: "10px 28px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: SUBTITLE_FONT_SIZE,
              fontWeight: 600,
              fontFamily: FONT_FAMILY.sans,
              color: "rgba(255, 255, 255, 0.95)",
              letterSpacing: "0.04em",
              textShadow: "0 2px 6px rgba(0, 0, 0, 0.6)",
            }}
          >
            {fallbackText}
          </span>
        </div>
      </div>
    );
  }

  const activeLine = lines.find(
    (line) =>
      currentTime >= line.startTime - 0.05 &&
      currentTime <= line.endTime + LINGER_AFTER
  );

  if (!activeLine) return null;

  const fadeIn = interpolate(
    currentTime,
    [activeLine.startTime - 0.05, activeLine.startTime + 0.1],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const fadeOut = interpolate(
    currentTime,
    [activeLine.endTime, activeLine.endTime + LINGER_AFTER],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const opacity = Math.min(fadeIn, fadeOut);

  const slideY = interpolate(
    currentTime,
    [activeLine.startTime - 0.05, activeLine.startTime + 0.15],
    [12, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        bottom: SUBTITLE_BOTTOM,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform: `translateY(${slideY}px)`,
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.55)",
          borderRadius: 12,
          padding: "10px 28px",
          display: "flex",
          flexWrap: "nowrap",
          alignItems: "center",
        }}
      >
        {activeLine.words.map((word, i) => {
          const wordRelStart = word.start - atomOriginalStart;
          const wordProgress = interpolate(
            currentTime,
            [wordRelStart - 0.03, wordRelStart + 0.08],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const wordAlpha = 0.35 + 0.65 * wordProgress;

          return (
            <span
              key={i}
              style={{
                fontSize: SUBTITLE_FONT_SIZE,
                fontWeight: 600,
                fontFamily: FONT_FAMILY.sans,
                color: `rgba(255, 255, 255, ${wordAlpha})`,
                letterSpacing: "0.04em",
                textShadow: "0 2px 6px rgba(0, 0, 0, 0.6)",
              }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
