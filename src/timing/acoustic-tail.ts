import { execFileSync } from "child_process";
import type { Blueprint, TimingClip } from "../schemas/blueprint.js";
import { allAtoms } from "../schemas/blueprint.js";

const ANALYSIS_SAMPLE_RATE = 16000;
const ANALYSIS_FRAME_SEC = 0.01;
const ANALYSIS_LOOKBACK_SEC = 0.08;
const ANALYSIS_LOOKAHEAD_SEC = 0.18;
const ANALYSIS_MIN_EXTENSION_SEC = 0.02;
const ANALYSIS_QUIET_RUN_SEC = 0.03;
const ANALYSIS_THRESHOLD_FRACTION = 0.22;
const ANALYSIS_NOISE_FLOOR_MULTIPLIER = 2.5;

export interface AcousticEnvelope {
  frameDurationSec: number;
  values: number[];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function decodeMonoSamples(inputPath: string): Float32Array {
  const raw = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(ANALYSIS_SAMPLE_RATE),
      "-f",
      "f32le",
      "-",
    ],
    {
      encoding: "buffer",
      maxBuffer: 256 * 1024 * 1024,
    }
  ) as Buffer;

  const sampleCount = Math.floor(raw.byteLength / Float32Array.BYTES_PER_ELEMENT);
  const view = new Float32Array(
    raw.buffer,
    raw.byteOffset,
    sampleCount
  );

  return new Float32Array(view);
}

function buildAcousticEnvelope(samples: Float32Array): AcousticEnvelope {
  const frameSize = Math.max(1, Math.round(ANALYSIS_SAMPLE_RATE * ANALYSIS_FRAME_SEC));
  const values: number[] = [];

  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const frameEnd = Math.min(samples.length, offset + frameSize);
    let sumSquares = 0;
    for (let index = offset; index < frameEnd; index++) {
      const value = samples[index];
      sumSquares += value * value;
    }

    const frameLength = Math.max(1, frameEnd - offset);
    values.push(Math.sqrt(sumSquares / frameLength));
  }

  return {
    frameDurationSec: ANALYSIS_FRAME_SEC,
    values,
  };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * fraction))
  );
  return sorted[index];
}

export function findAcousticTailBoundary(
  envelope: AcousticEnvelope,
  boundarySec: number
): number {
  const lastFrame = envelope.values.length - 1;
  if (lastFrame < 0) {
    return boundarySec;
  }

  const frameDurationSec = envelope.frameDurationSec;
  const boundaryFrame = Math.min(
    lastFrame,
    Math.max(0, Math.floor(boundarySec / frameDurationSec))
  );
  const referenceStart = Math.max(
    0,
    Math.floor((boundarySec - ANALYSIS_LOOKBACK_SEC) / frameDurationSec)
  );
  const referenceEnd = Math.min(
    lastFrame,
    Math.ceil(boundarySec / frameDurationSec)
  );
  const lookaheadEnd = Math.min(
    lastFrame,
    Math.ceil((boundarySec + ANALYSIS_LOOKAHEAD_SEC) / frameDurationSec)
  );

  const localReferenceWindow = envelope.values.slice(referenceStart, referenceEnd + 1);
  const localSearchWindow = envelope.values.slice(referenceStart, lookaheadEnd + 1);
  const referenceEnergy = Math.max(...localReferenceWindow, 0);
  if (referenceEnergy <= 0) {
    return boundarySec;
  }

  const noiseFloor = percentile(localSearchWindow, 0.2);
  const quietThreshold = Math.min(
    referenceEnergy * 0.45,
    Math.max(
      referenceEnergy * ANALYSIS_THRESHOLD_FRACTION,
      noiseFloor * ANALYSIS_NOISE_FLOOR_MULTIPLIER
    )
  );
  const quietFramesRequired = Math.max(
    1,
    Math.ceil(ANALYSIS_QUIET_RUN_SEC / frameDurationSec)
  );
  const minimumSearchFrame = Math.min(
    lookaheadEnd,
    Math.max(
      boundaryFrame,
      Math.ceil((boundarySec + ANALYSIS_MIN_EXTENSION_SEC) / frameDurationSec)
    )
  );

  let quietRun = 0;
  for (let frame = minimumSearchFrame; frame <= lookaheadEnd; frame++) {
    const energy = envelope.values[frame];
    quietRun = energy <= quietThreshold ? quietRun + 1 : 0;

    if (quietRun >= quietFramesRequired) {
      const quietStartFrame = frame - quietRun + 1;
      const candidate = quietStartFrame * frameDurationSec;
      return round3(Math.max(boundarySec, candidate));
    }
  }

  return boundarySec;
}

function rebuildClipOutputs(clips: TimingClip[]): TimingClip[] {
  let outputOffset = 0;

  return clips.map((clip) => {
    const clipDuration = Math.max(0, clip.source.end - clip.source.start);
    const nextClip: TimingClip = {
      ...clip,
      source: {
        start: round3(clip.source.start),
        end: round3(clip.source.end),
      },
      output: {
        start: round3(outputOffset),
        end: round3(outputOffset + clipDuration),
      },
    };
    outputOffset += clipDuration;
    return nextClip;
  });
}

export function refineSourceDirectClipsWithAcousticTails(
  inputPath: string,
  blueprint: Blueprint,
  clips: TimingClip[]
): TimingClip[] {
  if (clips.length === 0) {
    return clips;
  }

  const orderedAtoms = allAtoms(blueprint)
    .map((atom) => ({
      id: atom.id,
      start: atom.time.start,
      end: atom.time.end,
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id - b.id);
  const atomIndexById = new Map<number, number>();
  for (let index = 0; index < orderedAtoms.length; index++) {
    atomIndexById.set(orderedAtoms[index].id, index);
  }

  const envelope = buildAcousticEnvelope(decodeMonoSamples(inputPath));
  const refined = clips.map((clip) => ({ ...clip, source: { ...clip.source }, output: { ...clip.output }, content: { ...clip.content }, atom_ids: [...clip.atom_ids] }));

  for (const clip of refined) {
    const lastAtomId = clip.atom_ids[clip.atom_ids.length - 1];
    if (typeof lastAtomId !== "number") {
      continue;
    }

    const lastIndex = atomIndexById.get(lastAtomId);
    if (typeof lastIndex !== "number") {
      continue;
    }

    const nextAtom = orderedAtoms[lastIndex + 1];
    const proposedEnd = findAcousticTailBoundary(envelope, clip.content.end);
    if (proposedEnd <= clip.source.end) {
      continue;
    }

    let clampedEnd = proposedEnd;
    if (nextAtom) {
      // Tail extension must never revive the following atom's audio.
      // We can only use the real gap before the next atom begins.
      clampedEnd = Math.min(clampedEnd, nextAtom.start);
    }

    clip.source.end = round3(Math.max(clip.source.end, clampedEnd));
  }

  return rebuildClipOutputs(refined);
}
