import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  autoRepairBlueprint,
  validateBlueprint,
} from "../src/analyze/schema.js";
import { buildStep2Diagnostics } from "../src/analyze/step2-diagnostics.js";
import { deriveBlueprintAtomsFromTranscript } from "../src/analyze/derive/atom-from-tokens.js";
import { renderFinalVideo } from "../src/renderer/render.js";
import type { AlignedTokenTranscript, Blueprint, Transcript, Word } from "../src/schemas/blueprint.js";
import { buildDirectTimingMap } from "../src/timing/build-direct-timing-map.js";

type Args = {
  sourceDir: string;
  outputDir: string;
  videoPath: string;
  skipRender: boolean;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let sourceDir = "";
  let outputDir = "";
  let videoPath = "";
  let skipRender = false;

  for (let index = 0; index < args.length; index++) {
    switch (args[index]) {
      case "--source-dir":
        sourceDir = resolve(args[++index] ?? "");
        break;
      case "--output-dir":
        outputDir = resolve(args[++index] ?? "");
        break;
      case "--video":
        videoPath = resolve(args[++index] ?? "");
        break;
      case "--skip-render":
        skipRender = true;
        break;
    }
  }

  if (!sourceDir || !outputDir || !videoPath) {
    throw new Error(
      "Usage: npx tsx scripts/rebuild-output-from-blueprint.ts --source-dir output/case --output-dir output/case_rebuilt --video source.mp4 [--skip-render]"
    );
  }

  return {
    sourceDir,
    outputDir,
    videoPath,
    skipRender,
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function readTranscriptDocument(filePath: string): Transcript {
  const payload = readJsonFile<
    Transcript | AlignedTokenTranscript | { duration?: unknown; words?: unknown; tokens?: unknown }
  >(filePath);

  if (Array.isArray((payload as Transcript).words)) {
    return payload as Transcript;
  }

  if (Array.isArray((payload as AlignedTokenTranscript).tokens)) {
    const transcript = payload as AlignedTokenTranscript;
    return {
      duration: transcript.duration,
      words: transcript.tokens.map((token, index) => ({
        text: token.text,
        start: token.start,
        end: token.end,
        source_word_indices: token.raw_word_indices ?? [index],
        source_start: token.source_start ?? token.start,
        source_end: token.source_end ?? token.end,
        synthetic: token.synthetic,
      })),
    };
  }

  throw new Error(`Unsupported transcript payload: ${filePath}`);
}

function ensurePathExists(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function maybeCopy(sourceDir: string, outputDir: string, fileName: string): void {
  const sourcePath = join(sourceDir, fileName);
  if (!existsSync(sourcePath)) {
    return;
  }
  const destPath = join(outputDir, fileName);
  if (resolve(sourcePath) === resolve(destPath)) {
    return;
  }
  copyFileSync(sourcePath, destPath);
}

async function main() {
  const args = parseArgs();
  mkdirSync(args.outputDir, { recursive: true });

  const blueprintMergedPath = join(args.sourceDir, "blueprint_merged.json");
  const transcriptPath = existsSync(join(args.sourceDir, "transcript_raw.json"))
    ? join(args.sourceDir, "transcript_raw.json")
    : join(args.sourceDir, "transcript.json");
  const alignedTokenTranscriptPath = join(
    args.sourceDir,
    "transcript_aligned_tokens.json"
  );

  ensurePathExists(blueprintMergedPath, "blueprint_merged");
  ensurePathExists(transcriptPath, "transcript");

  const merged = readJsonFile<any>(blueprintMergedPath);
  const transcript = readTranscriptDocument(transcriptPath);
  const sourceTranscript = existsSync(alignedTokenTranscriptPath)
    ? readTranscriptDocument(alignedTokenTranscriptPath)
    : transcript;

  const repaired = autoRepairBlueprint(merged);
  const spokenDuration = sourceTranscript.words.reduce(
    (sum: number, word: Word) => sum + (word.end - word.start),
    0
  );
  const validation = validateBlueprint(
    repaired,
    sourceTranscript.duration,
    spokenDuration
  );

  if (validation.zodErrors) {
    throw new Error(
      `Blueprint Zod validation failed:\n${validation.zodErrors.join("\n")}`
    );
  }

  if (validation.logicErrors?.length) {
    throw new Error(
      `Blueprint logic validation failed:\n${validation.logicErrors.join("\n")}`
    );
  }

  const blueprint = validation.data as Blueprint;
  deriveBlueprintAtomsFromTranscript(blueprint, sourceTranscript);

  writeFileSync(
    join(args.outputDir, "blueprint.json"),
    JSON.stringify(blueprint, null, 2),
    "utf-8"
  );
  writeFileSync(
    join(args.outputDir, "blueprint_merged.json"),
    JSON.stringify(merged, null, 2),
    "utf-8"
  );
  writeFileSync(
    join(args.outputDir, "step2_diagnostics.json"),
    JSON.stringify(buildStep2Diagnostics(blueprint), null, 2),
    "utf-8"
  );

  maybeCopy(args.sourceDir, args.outputDir, "transcript.json");
  maybeCopy(args.sourceDir, args.outputDir, "transcript_raw.json");
  maybeCopy(args.sourceDir, args.outputDir, "transcribe_qwen_manifest.json");
  maybeCopy(args.sourceDir, args.outputDir, "transcript_aligned_words.json");
  maybeCopy(args.sourceDir, args.outputDir, "transcript_aligned_tokens.json");
  maybeCopy(args.sourceDir, args.outputDir, "force_align_manifest.json");
  maybeCopy(args.sourceDir, args.outputDir, "reviewed_transcript.json");
  maybeCopy(args.sourceDir, args.outputDir, "reviewed_transcript.txt");
  maybeCopy(args.sourceDir, args.outputDir, "reviewed_tokens.json");
  maybeCopy(args.sourceDir, args.outputDir, "reviewed_text.txt");
  maybeCopy(args.sourceDir, args.outputDir, "reviewed_transcript_map.json");
  maybeCopy(args.sourceDir, args.outputDir, "review_spans.json");
  maybeCopy(args.sourceDir, args.outputDir, "step1_result.json");
  maybeCopy(args.sourceDir, args.outputDir, "step1_cleaned.json");
  maybeCopy(args.sourceDir, args.outputDir, "step1_taken.json");
  maybeCopy(args.sourceDir, args.outputDir, "step2_result.json");
  maybeCopy(args.sourceDir, args.outputDir, "take_pass_result.json");
  maybeCopy(args.sourceDir, args.outputDir, "take_pass_annotation.md");

  const timing = await buildDirectTimingMap(
    args.videoPath,
    blueprint,
    args.outputDir,
    "media_range_v2",
    sourceTranscript
  );

  if (args.skipRender) {
    console.log(
      JSON.stringify(
        {
          outputDir: args.outputDir,
          blueprintPath: join(args.outputDir, "blueprint.json"),
          timingMapPath: timing.timingMapPath,
          skippedRender: true,
        },
        null,
        2
      )
    );
    return;
  }

  const overlayLayerPath = join(args.outputDir, "overlay_layer.mp4");
  const renderArtifacts = await renderFinalVideo({
    blueprintPath: join(args.outputDir, "blueprint.json"),
    timingMapPath: join(args.outputDir, "timing_map.json"),
    sourceVideoPath: args.videoPath,
    outputPath: overlayLayerPath,
  });

  console.log(
    JSON.stringify(
      {
        outputDir: args.outputDir,
        overlayLayerPath: renderArtifacts.overlayLayerPath,
        cutSourceVideoPath: renderArtifacts.cutSourceVideoPath,
        renderOutputsPath: renderArtifacts.renderOutputsPath,
        blueprintPath: join(args.outputDir, "blueprint.json"),
        timingMapPath: timing.timingMapPath,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
