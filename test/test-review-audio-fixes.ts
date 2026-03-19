import assert from "node:assert/strict";
import {
  applyTranscriptReview,
  normalizeTranscriptReview,
} from "../src/analyze/review/index.js";
import { applyTakePass } from "../src/analyze/audio/index.js";
import { postProcessBlueprint } from "../src/align/post-process.js";
import {
  buildTimingClips,
  extractMergedKeepWindows,
} from "../src/timing/audio-plan.js";
import { findAcousticTailBoundary } from "../src/timing/acoustic-tail.js";
import type { Blueprint, Transcript } from "../src/schemas/blueprint.js";

function buildWord(text: string, start: number, end: number) {
  return { text, start, end };
}

function testReviewSpanFallbackAndGlobalIndices() {
  const words = [
    ...Array.from({ length: 20 }, (_, index) =>
      buildWord(`a${index}`, index * 0.3, index * 0.3 + 0.2)
    ),
    ...Array.from({ length: 20 }, (_, index) =>
      buildWord(`b${index}`, 10 + index * 0.3, 10 + index * 0.3 + 0.2)
    ),
  ];
  const transcript: Transcript = {
    duration: 20,
    words,
  };

  const normalized = normalizeTranscriptReview(
    {
      spans: [
        {
          id: 1,
          cleaned_text: `x${words.slice(0, 20).map((word) => word.text).join("").slice(1)}`,
          confidence: 0.9,
        },
      ],
    },
    transcript.words
  );

  assert.equal(
    normalized.spans?.length,
    2,
    "missing review chunks should be backfilled"
  );
  assert.equal(
    normalized.spans?.[1].cleanedText,
    words.slice(20).map((word) => word.text).join(""),
    "backfilled span should keep original text"
  );

  const { reviewedTranscript, report } = applyTranscriptReview(
    transcript,
    normalized
  );
  assert.equal(report.reviewMode, "anchored_spans");

  const secondChunkFirstWord = reviewedTranscript.words.find((word) =>
    Array.isArray(word.source_word_indices) &&
    word.source_word_indices.includes(20)
  );
  assert.ok(
    secondChunkFirstWord,
    "reviewed transcript should preserve global source indices"
  );
}

function testTakePassKeepsContinuousLogicAtomsInOneAudioSpan() {
  const step1Result = {
    atoms: [
      {
        id: 1,
        text: "alpha",
        time: { s: 0, e: 0.4 },
        status: "keep",
        boundary: "scene" as const,
      },
      {
        id: 2,
        text: "beta",
        time: { s: 0.4, e: 0.8 },
        status: "keep",
        boundary: "logic" as const,
      },
      {
        id: 3,
        text: "gamma",
        time: { s: 0.8, e: 1.2 },
        status: "keep",
      },
    ],
  };

  const stats = applyTakePass(step1Result, {
    takes: [{ start_id: 1, end_id: 3, reason: "continuous sentence" }],
  });

  assert.equal(stats.takeCount, 1);
  assert.deepEqual(step1Result.audio_spans, [
    {
      id: "A1",
      start_id: 1,
      end_id: 3,
      reason: "保留自然可播表达：alphabetagamma",
    },
  ]);
  assert.equal(
    (step1Result.atoms[0] as { audio_span_id?: string }).audio_span_id,
    "A1"
  );
  assert.equal(
    (step1Result.atoms[2] as { audio_span_id?: string }).audio_span_id,
    "A1"
  );
}

function testTakePassDropsRestartAtomsInsideSpan() {
  const step1Result = {
    atoms: [
      {
        id: 1,
        text: "支架",
        time: { s: 0, e: 0.4 },
        status: "keep",
        boundary: "scene" as const,
      },
      {
        id: 2,
        text: "我们说",
        time: { s: 0.4, e: 0.9 },
        status: "keep",
      },
      {
        id: 3,
        text: "支架",
        time: { s: 0.9, e: 1.2 },
        status: "keep",
      },
      {
        id: 4,
        text: "只是",
        time: { s: 1.2, e: 1.5 },
        status: "keep",
      },
      {
        id: 5,
        text: "开路先锋",
        time: { s: 1.5, e: 2.1 },
        status: "keep",
      },
    ],
  };

  applyTakePass(step1Result, {
    takes: [{ start_id: 1, end_id: 5, reason: "contains restart" }],
  });

  const keptIds = step1Result.atoms
    .filter((atom) => atom.status === "keep")
    .map((atom) => atom.id);
  assert.deepEqual(keptIds, [1, 4, 5]);
  assert.deepEqual(step1Result.audio_spans, [
    {
      id: "A1",
      start_id: 1,
      end_id: 1,
      reason: "保留自然可播表达：支架",
    },
    {
      id: "A2",
      start_id: 4,
      end_id: 5,
      reason: "保留自然可播表达：只是开路先锋",
    },
  ]);
}

function testTakePassRemovesDuplicatePrefixesAndLargeGapFragments() {
  const step1Result = {
    atoms: [
      {
        id: 1,
        text: "减少",
        time: { s: 0, e: 0.4 },
        status: "keep",
        boundary: "scene" as const,
      },
      {
        id: 2,
        text: "减少",
        time: { s: 0.4, e: 0.8 },
        status: "keep",
      },
      {
        id: 3,
        text: "炎症",
        time: { s: 0.8, e: 1.3 },
        status: "keep",
      },
      {
        id: 4,
        text: "心",
        time: { s: 3.2, e: 3.5 },
        status: "keep",
      },
      {
        id: 5,
        text: "恢复",
        time: { s: 4.8, e: 5.3 },
        status: "keep",
      },
    ],
  };

  applyTakePass(step1Result, {
    takes: [{ start_id: 1, end_id: 5, reason: "restart + gap" }],
  });

  assert.deepEqual(
    step1Result.audio_spans,
    [
      {
        id: "A1",
        start_id: 2,
        end_id: 3,
        reason: "保留自然可播表达：减少炎症",
      },
      {
        id: "A2",
        start_id: 5,
        end_id: 5,
        reason: "保留自然可播表达：恢复",
      },
    ],
    "duplicate starters should be removed and tiny gap fragments should be dropped"
  );
}

function testTakePassSkipsRestartConnectorBridge() {
  const step1Result = {
    atoms: [
      {
        id: 1,
        text: "一般",
        time: { s: 0, e: 0.4 },
        status: "keep",
        boundary: "scene" as const,
      },
      {
        id: 2,
        text: "需要",
        time: { s: 0.4, e: 0.7 },
        status: "keep",
      },
      {
        id: 3,
        text: "坚持",
        time: { s: 0.7, e: 1.0 },
        status: "keep",
      },
      {
        id: 4,
        text: "一年",
        time: { s: 1.0, e: 1.3 },
        status: "keep",
      },
      {
        id: 5,
        text: "之后呢",
        time: { s: 1.3, e: 1.7 },
        status: "keep",
      },
      {
        id: 6,
        text: "之后",
        time: { s: 1.7, e: 2.0 },
        status: "keep",
      },
      {
        id: 7,
        text: "再调整",
        time: { s: 2.0, e: 2.5 },
        status: "keep",
      },
    ],
  };

  applyTakePass(step1Result, {
    takes: [
      { start_id: 1, end_id: 4, reason: "first clause" },
      { start_id: 6, end_id: 7, reason: "second clause" },
    ],
  });

  assert.deepEqual(step1Result.audio_spans, [
    {
      id: "A1",
      start_id: 1,
      end_id: 4,
      reason: "保留自然可播表达：一般需要坚持一年",
    },
    {
      id: "A2",
      start_id: 6,
      end_id: 7,
      reason: "保留自然可播表达：之后再调整",
    },
  ]);
}

function testTakePassRemovesRepeatedSentenceButKeepsParallelList() {
  const repeated = {
    atoms: [
      {
        id: 1,
        text: "这些呢",
        time: { s: 0, e: 0.3 },
        status: "keep",
        boundary: "scene" as const,
      },
      { id: 2, text: "都会", time: { s: 0.3, e: 0.6 }, status: "keep" },
      { id: 3, text: "不停的", time: { s: 0.6, e: 0.9 }, status: "keep" },
      { id: 4, text: "给炎症", time: { s: 0.9, e: 1.2 }, status: "keep" },
      { id: 5, text: "添", time: { s: 1.2, e: 1.35 }, status: "keep" },
      { id: 6, text: "这些", time: { s: 1.35, e: 1.65 }, status: "keep" },
      { id: 7, text: "都会", time: { s: 1.65, e: 1.95 }, status: "keep" },
      { id: 8, text: "不停的", time: { s: 1.95, e: 2.25 }, status: "keep" },
      { id: 9, text: "给炎症", time: { s: 2.25, e: 2.55 }, status: "keep" },
      { id: 10, text: "添柴", time: { s: 2.55, e: 2.9 }, status: "keep" },
    ],
  };

  applyTakePass(repeated, {
    takes: [{ start_id: 1, end_id: 10, reason: "repeated clause" }],
  });

  assert.deepEqual(repeated.audio_spans, [
    {
      id: "A1",
      start_id: 6,
      end_id: 10,
      reason: "保留自然可播表达：这些都会不停的给炎症添柴",
    },
  ]);

  const list = {
    atoms: [
      {
        id: 1,
        text: "好好吃饭",
        time: { s: 0, e: 0.5 },
        status: "keep",
        boundary: "scene" as const,
      },
      { id: 2, text: "好好睡觉", time: { s: 0.5, e: 1.0 }, status: "keep" },
      { id: 3, text: "好好的", time: { s: 1.0, e: 1.3 }, status: "keep" },
      { id: 4, text: "活动", time: { s: 1.3, e: 1.7 }, status: "keep" },
    ],
  };

  applyTakePass(list, {
    takes: [{ start_id: 1, end_id: 4, reason: "parallel list" }],
  });

  assert.deepEqual(list.audio_spans, [
    {
      id: "A1",
      start_id: 1,
      end_id: 4,
      reason: "保留自然可播表达：好好吃饭好好睡觉好好的活动",
    },
  ]);
}

function testRepairPassDiscardRangesBuildPlayableTakes() {
  const step1Result = {
    atoms: [
      {
        id: 1,
        text: "每周",
        time: { s: 0, e: 0.5 },
        status: "keep",
        boundary: "scene" as const,
      },
      { id: 2, text: "每周", time: { s: 0.5, e: 1.1 }, status: "keep" },
      { id: 3, text: "至少", time: { s: 1.1, e: 1.4 }, status: "keep" },
      { id: 4, text: "三到五次", time: { s: 1.4, e: 2.0 }, status: "keep" },
    ],
  };

  applyTakePass(step1Result, {
    discard_ranges: [
      {
        start_id: 1,
        end_id: 1,
        reason: "前一个“每周”已被后面的完整版本覆盖",
      },
    ],
  });

  assert.deepEqual(
    step1Result.atoms.map((atom) => [atom.id, atom.status, atom.reason]),
    [
      [1, "discard", "前一个“每周”已被后面的完整版本覆盖"],
      [2, "keep", undefined],
      [3, "keep", undefined],
      [4, "keep", undefined],
    ]
  );
  assert.deepEqual(step1Result.audio_spans, [
    {
      id: "A1",
      start_id: 2,
      end_id: 4,
      reason: "保留自然可播表达：每周至少三到五次",
    },
  ]);
}

function testRepairPassDiscardedConnectorDoesNotComeBack() {
  const step1Result = {
    atoms: [
      {
        id: 1,
        text: "alpha",
        time: { s: 0, e: 0.4 },
        status: "keep",
        boundary: "scene" as const,
      },
      {
        id: 2,
        text: "之后呢",
        time: { s: 0.4, e: 0.8 },
        status: "keep",
      },
      {
        id: 3,
        text: "之后",
        time: { s: 0.8, e: 1.1 },
        status: "keep",
      },
      {
        id: 4,
        text: "再调整",
        time: { s: 1.1, e: 1.5 },
        status: "keep",
      },
    ],
  };

  applyTakePass(step1Result, {
    discard_ranges: [
      {
        start_id: 2,
        end_id: 2,
        reason: "superseded bridge",
      },
    ],
  });

  assert.deepEqual(
    step1Result.audio_spans?.map((span) => ({
      id: span.id,
      start_id: span.start_id,
      end_id: span.end_id,
    })),
    [
      { id: "A1", start_id: 1, end_id: 1 },
      { id: "A2", start_id: 3, end_id: 4 },
    ],
    "repair-pass discard should not be revived by second-stage bridging"
  );
}

function testRepairPassDoesNotSecondGuessKeptAtoms() {
  const step1Result = {
    atoms: [
      {
        id: 1,
        text: "我们说",
        time: { s: 0, e: 0.4 },
        status: "keep",
        boundary: "scene" as const,
      },
      {
        id: 2,
        text: "旧版本",
        time: { s: 0.4, e: 0.8 },
        status: "keep",
      },
      {
        id: 3,
        text: "正文",
        time: { s: 0.8, e: 1.2 },
        status: "keep",
      },
    ],
  };

  applyTakePass(step1Result, {
    discard_ranges: [
      {
        start_id: 2,
        end_id: 2,
        reason: "superseded middle chunk",
      },
    ],
  });

  assert.deepEqual(
    step1Result.audio_spans?.map((span) => ({
      id: span.id,
      start_id: span.start_id,
      end_id: span.end_id,
    })),
    [
      { id: "A1", start_id: 1, end_id: 1 },
      { id: "A2", start_id: 3, end_id: 3 },
    ],
    "discard_ranges mode should not drop LLM-kept atoms just because local heuristics dislike them"
  );
}

function testPlannerRespectsAudioSpanIds() {
  const blueprint: Blueprint = {
    title: "test",
    scenes: [
      {
        id: "S1",
        title: "scene",
        view: "overlay",
        logic_segments: [
          {
            id: "S1-L1",
            transition_type: "demo",
            template: "hero_text",
            items: [{ text: "alphabeta" }],
            atoms: [
              {
                id: 1,
                text: "alpha",
                time: { start: 0, end: 0.4 },
                status: "keep",
                audio_span_id: "A1",
              },
              {
                id: 2,
                text: "beta",
                time: { start: 1.0, end: 1.4 },
                status: "keep",
                audio_span_id: "A1",
              },
              {
                id: 3,
                text: "gamma",
                time: { start: 1.6, end: 1.9 },
                status: "keep",
                audio_span_id: "A2",
              },
            ],
          },
        ],
      },
    ],
  };

  const windows = extractMergedKeepWindows(blueprint, "legacy_time");
  assert.equal(
    windows.length,
    2,
    "planner should keep separate audio spans separate"
  );
  assert.deepEqual(
    windows.map((window) => [window.start, window.end, window.audioSpanId]),
    [
      [0, 1.4, "A1"],
      [1.6, 1.9, "A2"],
    ]
  );
}

function testPlannerAddsTailPadForSentenceBreaks() {
  const blueprint: Blueprint = {
    title: "tail-pad",
    scenes: [
      {
        id: "S1",
        title: "scene",
        view: "overlay",
        logic_segments: [
          {
            id: "S1-L1",
            transition_type: "demo",
            template: "hero_text",
            items: [{ text: "demo" }],
            atoms: [
              {
                id: 1,
                text: "first",
                time: { start: 0, end: 1 },
                media_range: { start: 0, end: 1 },
                status: "keep",
              },
              {
                id: 2,
                text: "second",
                time: { start: 2, end: 2.5 },
                media_range: { start: 2, end: 2.5 },
                status: "keep",
              },
            ],
          },
        ],
      },
    ],
  };

  const transcript: Transcript = {
    duration: 5,
    words: [
      buildWord("f", 0, 0.4),
      buildWord("irst", 0.4, 1),
      buildWord("noise", 1.01, 1.22),
      buildWord("s", 2, 2.2),
      buildWord("econd", 2.2, 2.5),
    ],
  };

  const clips = buildTimingClips(
    blueprint,
    transcript.duration,
    "source_direct",
    "media_range_v2",
    transcript
  );

  assert.equal(clips.length, 2);
  assert.equal(
    clips[0].source.end,
    1.18,
    "sentence-ending clip should keep a small tail pad even if the next transcript word starts immediately"
  );
}

function testPlannerDoesNotAddSourceDirectLeadIn() {
  const blueprint: Blueprint = {
    title: "no-lead-in",
    scenes: [
      {
        id: "S1",
        title: "scene",
        view: "overlay",
        logic_segments: [
          {
            id: "S1-L1",
            transition_type: "demo",
            template: "hero_text",
            items: [{ text: "demo" }],
            atoms: [
              {
                id: 1,
                text: "first",
                time: { start: 1, end: 1.5 },
                media_range: { start: 1, end: 1.5 },
                status: "keep",
                audio_span_id: "A1",
              },
              {
                id: 2,
                text: "second",
                time: { start: 2.2, end: 2.8 },
                media_range: { start: 2.2, end: 2.8 },
                status: "keep",
                audio_span_id: "A2",
              },
            ],
          },
        ],
      },
    ],
  };

  const clips = buildTimingClips(
    blueprint,
    5,
    "source_direct",
    "media_range_v2"
  );

  assert.equal(clips.length, 2);
  assert.equal(
    clips[0].source.start,
    1,
    "source_direct mode should not pre-roll clip starts before the kept atom"
  );
  assert.equal(
    clips[1].source.start,
    2.2,
    "source_direct mode should keep each clip start aligned to the kept atom"
  );
}

function testPlannerDoesNotBleedIntoDiscardedNeighborAudio() {
  const blueprint: Blueprint = {
    title: "no-bleed",
    scenes: [
      {
        id: "S1",
        title: "scene",
        view: "overlay",
        logic_segments: [
          {
            id: "S1-L1",
            transition_type: "demo",
            template: "hero_text",
            items: [{ text: "demo" }],
            atoms: [
              {
                id: 1,
                text: "keep",
                time: { start: 0, end: 1 },
                media_range: { start: 0, end: 1 },
                status: "keep",
                audio_span_id: "A1",
              },
              {
                id: 2,
                text: "discarded",
                time: { start: 1, end: 1.4 },
                status: "discard",
                reason: "removed",
              },
              {
                id: 3,
                text: "next",
                time: { start: 2, end: 2.5 },
                media_range: { start: 2, end: 2.5 },
                status: "keep",
                audio_span_id: "A2",
              },
            ],
          },
        ],
      },
    ],
  };

  const clips = buildTimingClips(
    blueprint,
    5,
    "source_direct",
    "media_range_v2"
  );

  assert.equal(clips.length, 2);
  assert.equal(
    clips[0].source.end,
    1,
    "tail pad should not cross into a discarded neighboring atom"
  );
}

function testAcousticTailFindsFirstQuietPoint() {
  const boundary = findAcousticTailBoundary(
    {
      frameDurationSec: 0.01,
      values: [
        0.8,
        0.9,
        1.0,
        0.85,
        0.7,
        0.55,
        0.36,
        0.18,
        0.05,
        0.04,
        0.03,
        0.02,
      ],
    },
    0.05
  );

  assert.equal(
    boundary,
    0.08,
    "acoustic tail search should extend to the first sustained quiet point after the boundary"
  );
}

function testAcousticTailDoesNotRunIntoFreshSpeech() {
  const boundary = findAcousticTailBoundary(
    {
      frameDurationSec: 0.01,
      values: [
        0.8,
        0.9,
        1.0,
        0.88,
        0.84,
        0.82,
        0.8,
        0.79,
        0.78,
        0.77,
        0.76,
        0.75,
        0.74,
        0.73,
        0.72,
        0.71,
        0.7,
        0.69,
        0.68,
        0.67,
        0.66,
        0.65,
      ],
    },
    0.05
  );

  assert.equal(
    boundary,
    0.05,
    "acoustic tail search should stay at the original boundary when no quiet tail appears inside the lookahead window"
  );
}

function testRepairAwareMediaTrimMovesRestartKeepStartForward() {
  const blueprint: Blueprint = {
    title: "repair-align",
    scenes: [
      {
        id: "S1",
        title: "scene",
        view: "overlay",
        logic_segments: [
          {
            id: "S1-L1",
            transition_type: "demo",
            template: "hero_text",
            items: [{ text: "demo" }],
            atoms: [
              {
                id: 1,
                text: "之后呢",
                time: { start: 0, end: 0.68 },
                status: "discard",
                reason: "restart",
              },
              {
                id: 2,
                text: "之后",
                time: { start: 0.68, end: 1.78 },
                status: "keep",
                audio_span_id: "A1",
              },
            ],
          },
        ],
      },
    ],
  };

  const transcript: Transcript = {
    duration: 3,
    words: [
      buildWord("之", 0, 0.24),
      buildWord("后", 0.24, 0.5),
      buildWord("呢", 0.5, 0.68),
      buildWord("之", 0.68, 0.94),
      buildWord("后", 0.94, 1.78),
    ],
  };

  postProcessBlueprint(blueprint, transcript, transcript);

  const keepAtom = blueprint.scenes[0].logic_segments[0].atoms[1];
  assert.equal(keepAtom.status, "keep");
  assert.deepEqual(keepAtom.media_range, { start: 0.72, end: 1.78 });
}

function main() {
  testReviewSpanFallbackAndGlobalIndices();
  testTakePassKeepsContinuousLogicAtomsInOneAudioSpan();
  testTakePassDropsRestartAtomsInsideSpan();
  testTakePassRemovesDuplicatePrefixesAndLargeGapFragments();
  testTakePassSkipsRestartConnectorBridge();
  testTakePassRemovesRepeatedSentenceButKeepsParallelList();
  testRepairPassDiscardRangesBuildPlayableTakes();
  testRepairPassDiscardedConnectorDoesNotComeBack();
  testRepairPassDoesNotSecondGuessKeptAtoms();
  testPlannerRespectsAudioSpanIds();
  testPlannerAddsTailPadForSentenceBreaks();
  testPlannerDoesNotAddSourceDirectLeadIn();
  testPlannerDoesNotBleedIntoDiscardedNeighborAudio();
  testAcousticTailFindsFirstQuietPoint();
  testAcousticTailDoesNotRunIntoFreshSpeech();
  testRepairAwareMediaTrimMovesRestartKeepStartForward();
  console.log("review/audio fixes: ok");
}

main();
