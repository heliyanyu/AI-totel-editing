import type { KeepAtom, TimingMap, Word } from "../schemas/blueprint";
import type { SegmentRenderInfo } from "./segment-to-scene";

export interface SourceDirectAudioSequencePlan {
  key: string;
  fromFrame: number;
  durationInFrames: number;
  trimBefore: number;
  trimAfter: number;
}

export interface SubtitleSequencePlan {
  key: string;
  fromFrame: number;
  durationInFrames: number;
  atomOriginalStart: number;
  words: Word[];
  fallbackText: string;
}

export interface RenderSegmentSequencePlan {
  key: string;
  fromFrame: number;
  durationInFrames: number;
  renderScene: SegmentRenderInfo["renderScene"];
  subtitles: SubtitleSequencePlan[];
}

export function secondsToFramesFloor(seconds: number, fps: number): number {
  return Math.floor(seconds * fps);
}

export function secondsToFramesCeil(seconds: number, fps: number): number {
  return Math.ceil(seconds * fps);
}

export function buildSourceDirectAudioSequencePlans(
  timingMap: TimingMap,
  fps: number
): SourceDirectAudioSequencePlan[] {
  if (timingMap.mode !== "source_direct") {
    return [];
  }

  return timingMap.clips.map((clip) => {
    const fromFrame = secondsToFramesFloor(clip.output.start, fps);
    const endFrame = secondsToFramesCeil(clip.output.end, fps);
    const durationInFrames = Math.max(1, endFrame - fromFrame);
    const trimBefore = secondsToFramesFloor(clip.source.start, fps);
    const trimAfter = Math.max(
      trimBefore + 1,
      secondsToFramesCeil(clip.source.end, fps)
    );

    return {
      key: `audio-${clip.id}`,
      fromFrame,
      durationInFrames,
      trimBefore,
      trimAfter,
    };
  });
}

function buildSubtitleSequencePlans(
  keepAtoms: KeepAtom[],
  atomTimingById: Map<number, TimingMap["segments"][number]>,
  segmentOutputStart: number,
  fps: number
): SubtitleSequencePlan[] {
  return keepAtoms
    .map((atom) => {
      const atomTiming = atomTimingById.get(atom.id);
      if (!atomTiming) {
        return null;
      }

      const fromFrame = secondsToFramesFloor(
        atomTiming.output.start - segmentOutputStart,
        fps
      );
      const durationInFrames = secondsToFramesCeil(
        atomTiming.output.end - atomTiming.output.start,
        fps
      );

      if (durationInFrames <= 0) {
        return null;
      }

      return {
        key: `sub-${atom.id}`,
        fromFrame: Math.max(0, fromFrame),
        durationInFrames,
        atomOriginalStart: atomTiming.original.start,
        words: atom.words ?? [],
        fallbackText: atom.subtitle_text ?? atom.text,
      } satisfies SubtitleSequencePlan;
    })
    .filter((plan): plan is SubtitleSequencePlan => plan !== null);
}

export function buildRenderSegmentSequencePlans(
  renderInfos: SegmentRenderInfo[],
  timingMap: TimingMap,
  fps: number,
  totalFrames: number
): RenderSegmentSequencePlan[] {
  const atomTimingById = new Map(
    timingMap.segments.map((timing) => [timing.atom_id, timing] as const)
  );

  return renderInfos
    .map((info, index) => {
      const fromFrame = secondsToFramesFloor(info.outputStart, fps);
      const segDurationFrames = secondsToFramesCeil(
        info.outputEnd - info.outputStart,
        fps
      );

      const nextInfo = renderInfos[index + 1];
      const sequenceEnd = nextInfo
        ? secondsToFramesFloor(nextInfo.outputStart, fps)
        : totalFrames;
      const durationInFrames = Math.max(
        segDurationFrames,
        sequenceEnd - fromFrame
      );

      if (durationInFrames <= 0) {
        return null;
      }

      const keepAtoms = info.segment.atoms.filter(
        (atom): atom is KeepAtom => atom.status === "keep"
      );

      return {
        key: info.segment.id,
        fromFrame,
        durationInFrames,
        renderScene: info.renderScene,
        subtitles: buildSubtitleSequencePlans(
          keepAtoms,
          atomTimingById,
          info.outputStart,
          fps
        ),
      } satisfies RenderSegmentSequencePlan;
    })
    .filter((plan): plan is RenderSegmentSequencePlan => plan !== null);
}
