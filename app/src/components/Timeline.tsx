import React, { useMemo, useCallback } from "react";
import { useEditorStore } from "../store/blueprint-store";

const SCENE_COLORS = [
  "#4a9eff", "#4caf50", "#ff9800", "#e91e63",
  "#9c27b0", "#00bcd4", "#ff5722", "#8bc34a",
];

interface TimelineBlock {
  segmentId: string;
  startSec: number;
  endSec: number;
  leftPct: number;
  widthPct: number;
  color: string;
  label: string;
}

interface GapBlock {
  leftPct: number;
  widthPct: number;
}

function atomMediaRange(atom: { time: { start: number; end: number }; media_range?: { start: number; end: number } }): { start: number; end: number } {
  return atom.media_range ?? atom.time;
}
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const Timeline: React.FC = () => {
  const blueprint = useEditorStore((s) => s.blueprint);
  const timingMap = useEditorStore((s) => s.timingMap);
  const meta = useEditorStore((s) => s.meta);
  const selectedSegmentId = useEditorStore((s) => s.selectedSegmentId);
  const selectSegment = useEditorStore((s) => s.selectSegment);

  const data = useMemo(() => {
    if (!blueprint) return null;

    const timingByAtomId = new Map((timingMap?.segments || []).map((seg) => [seg.atom_id, seg]));
    const blocks: TimelineBlock[] = [];

    for (let sceneIndex = 0; sceneIndex < blueprint.scenes.length; sceneIndex++) {
      const scene = blueprint.scenes[sceneIndex];
      const color = SCENE_COLORS[sceneIndex % SCENE_COLORS.length];

      for (const seg of scene.logic_segments) {
        const keepAtoms = seg.atoms.filter((atom) => atom.status === "keep");
        if (keepAtoms.length === 0) continue;

        const mapped = keepAtoms
          .map((atom) => timingByAtomId.get(atom.id))
          .filter((item): item is NonNullable<typeof item> => Boolean(item));

        const fallbackStart = Math.min(...keepAtoms.map((atom) => atom.time.start));
        const fallbackEnd = Math.max(...keepAtoms.map((atom) => atom.time.end));

        const startSec = mapped.length > 0
          ? Math.min(...mapped.map((item) => item.output.start))
          : fallbackStart;
        const endSec = mapped.length > 0
          ? Math.max(...mapped.map((item) => item.output.end))
          : fallbackEnd;

        if (endSec <= startSec) continue;

        blocks.push({
          segmentId: seg.id,
          startSec,
          endSec,
          leftPct: 0,
          widthPct: 0,
          color,
          label: seg.id,
        });
      }
    }

    if (blocks.length === 0) return null;

    blocks.sort((a, b) => a.startSec - b.startSec);
    const totalDuration = timingMap?.totalDuration ?? Math.max(...blocks.map((b) => b.endSec));
    if (totalDuration <= 0) return null;

    for (const block of blocks) {
      block.leftPct = (block.startSec / totalDuration) * 100;
      block.widthPct = Math.max(0.6, ((block.endSec - block.startSec) / totalDuration) * 100);
    }

    const gaps: GapBlock[] = [];
    let previousEnd = 0;
    for (const block of blocks) {
      if (block.startSec > previousEnd + 0.35) {
        gaps.push({
          leftPct: (previousEnd / totalDuration) * 100,
          widthPct: ((block.startSec - previousEnd) / totalDuration) * 100,
        });
      }
      previousEnd = Math.max(previousEnd, block.endSec);
    }

    const tickInterval = totalDuration > 90 ? 15 : totalDuration > 45 ? 10 : 5;
    const ticks: { pct: number; label: string }[] = [];
    for (let t = tickInterval; t < totalDuration; t += tickInterval) {
      ticks.push({ pct: (t / totalDuration) * 100, label: formatTime(t) });
    }

    const renderMode = meta?.renderMode ?? timingMap?.mode ?? "cut_video";

    return {
      blocks,
      gaps,
      ticks,
      totalDuration,
      segmentCount: blocks.length,
      sceneCount: blueprint.scenes.length,
      modeLabel: renderMode === "source_direct" ? "成片时间轴 · source_direct" : "成片时间轴 · cut_video",
    };
  }, [blueprint, timingMap, meta?.renderMode]);

  const handleBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!data) return;
    const target = e.target as HTMLElement;
    if (target.dataset.sid || target.closest("[data-sid]")) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    let bestId = "";
    let bestDist = Infinity;
    for (const block of data.blocks) {
      const mid = block.leftPct + block.widthPct / 2;
      const dist = Math.abs(mid - pct);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = block.segmentId;
      }
    }
    if (bestId) selectSegment(bestId);
  }, [data, selectSegment]);

  if (!data) {
    return (
      <div className="timeline">
        <div className="tl-bar" />
        <div className="tl-labels">
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  const selectedBlock = data.blocks.find((block) => block.segmentId === selectedSegmentId);
  const playheadPct = selectedBlock
    ? (((selectedBlock.startSec + selectedBlock.endSec) / 2) / data.totalDuration) * 100
    : null;

  return (
    <div className="timeline">
      <div className="tl-bar" onClick={handleBarClick}>
        <div className="tl-ticks">
          {data.ticks.map((tick, index) => (
            <React.Fragment key={index}>
              <div className="tl-tick" style={{ left: `${tick.pct}%` }} />
              <div className="tl-tick-label" style={{ left: `${tick.pct}%` }}>
                {tick.label}
              </div>
            </React.Fragment>
          ))}
        </div>

        {data.gaps.map((gap, index) => (
          <div
            key={`gap-${index}`}
            className="tl-gap"
            style={{ left: `${gap.leftPct}%`, width: `${gap.widthPct}%` }}
          />
        ))}

        {data.blocks.map((block) => (
          <div
            key={block.segmentId}
            className={`tl-block ${block.segmentId === selectedSegmentId ? "active" : ""}`}
            style={{
              left: `${block.leftPct}%`,
              width: `${block.widthPct}%`,
              background: block.color,
            }}
            data-sid={block.segmentId}
            title={`${block.label} (${formatTime(block.startSec)} - ${formatTime(block.endSec)})`}
            onClick={() => selectSegment(block.segmentId)}
          >
            {block.widthPct > 4 ? block.label : ""}
          </div>
        ))}

        {playheadPct !== null && <div className="tl-playhead" style={{ left: `${playheadPct}%` }} />}
      </div>

      <div className="tl-labels">
        <span>{data.modeLabel}</span>
        <span>{formatTime(data.totalDuration)}</span>
        <span className="tl-stats">
          {data.sceneCount} scenes / {data.segmentCount} segs
        </span>
      </div>
    </div>
  );
};

