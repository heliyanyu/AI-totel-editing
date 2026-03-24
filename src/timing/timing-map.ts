import type {
  Blueprint,
  TimingClip,
  TimingMap,
  TimingSegment,
  KeepAtom,
  Transcript,
  Word,
} from "../schemas/blueprint.js";
import { keepAtoms } from "../schemas/blueprint.js";
import {
  type PlanningStrategy,
  buildTimingClips,
  defaultPlanningStrategy,
  getAtomPlaybackRange,
} from "./audio-plan.js";

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function buildTimingSegments(
  blueprint: Blueprint,
  clips: TimingClip[],
  strategy: PlanningStrategy = "legacy_time"
): TimingSegment[] {
  const keeps = keepAtoms(blueprint);
  const keepById = new Map<number, KeepAtom>(keeps.map((atom) => [atom.id, atom]));
  const segments: TimingSegment[] = [];

  for (const clip of clips) {
    for (const atomId of clip.atom_ids) {
      const atom = keepById.get(atomId);
      if (!atom) {
        continue;
      }
      const playback = getAtomPlaybackRange(atom, strategy);
      if (playback.end - playback.start <= 0) {
        continue; // skip zero-duration atoms (e.g. last atom at exact video end)
      }
      const atomOffset = playback.start - clip.source.start;
      segments.push({
        atom_id: atom.id,
        original: {
          start: round3(playback.start),
          end: round3(playback.end),
        },
        output: {
          start: round3(clip.output.start + atomOffset),
          end: round3(clip.output.start + atomOffset + (playback.end - playback.start)),
        },
      });
    }
  }

  return segments.sort((a, b) => a.output.start - b.output.start);
}

export function buildTimingMapFromBlueprint(
  blueprint: Blueprint,
  totalDuration: number,
  mode: "cut_video" | "source_direct",
  strategy: PlanningStrategy = defaultPlanningStrategy(mode),
  transcript?: Transcript | Word[]
): TimingMap {
  const clips = buildTimingClips(blueprint, totalDuration, mode, strategy, transcript);
  const segments = buildTimingSegments(blueprint, clips, strategy);
  const totalOutputDuration = clips.length > 0 ? clips[clips.length - 1].output.end : 0;

  return {
    mode,
    clips,
    segments,
    totalDuration: round3(totalOutputDuration),
  };
}
