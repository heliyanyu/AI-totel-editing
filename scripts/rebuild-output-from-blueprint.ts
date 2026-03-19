import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import {
  autoRepairBlueprint,
  validateBlueprint,
} from "../src/analyze/schema.js";
import { buildStep2Diagnostics } from "../src/analyze/step2-diagnostics.js";
import { postProcessBlueprint } from "../src/align/post-process.js";
import { renderFinalVideo } from "../src/renderer/render.js";
import type { Blueprint, Transcript, Word } from "../src/schemas/blueprint.js";
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
  copyFileSync(sourcePath, join(outputDir, fileName));
}

async function main() {
  const args = parseArgs();
  mkdirSync(args.outputDir, { recursive: true });

  const blueprintMergedPath = join(args.sourceDir, "blueprint_merged.json");
  const transcriptPath = join(args.sourceDir, "transcript.json");
  const reviewedTranscriptPath = join(args.sourceDir, "reviewed_transcript.json");

  ensurePathExists(blueprintMergedPath, "blueprint_merged");
  ensurePathExists(transcriptPath, "transcript");
  ensurePathExists(reviewedTranscriptPath, "reviewed_transcript");

  const merged = readJsonFile<any>(blueprintMergedPath);
  const transcript = readJsonFile<Transcript>(transcriptPath);
  const reviewedTranscript = readJsonFile<Transcript>(reviewedTranscriptPath);

  const repaired = autoRepairBlueprint(merged);
  const spokenDuration = transcript.words.reduce(
    (sum: number, word: Word) => sum + (word.end - word.start),
    0
  );
  const validation = validateBlueprint(
    repaired,
    transcript.duration,
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
  postProcessBlueprint(blueprint, transcript, reviewedTranscript, {
    debugPath: join(args.outputDir, "atom_alignment_debug.json"),
  });

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
  maybeCopy(args.sourceDir, args.outputDir, "reviewed_transcript.json");
  maybeCopy(args.sourceDir, args.outputDir, "reviewed_transcript.txt");
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
    transcript
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

  const resultPath = join(args.outputDir, "result.mp4");
  await renderFinalVideo({
    blueprintPath: join(args.outputDir, "blueprint.json"),
    timingMapPath: join(args.outputDir, "timing_map.json"),
    sourceVideoPath: args.videoPath,
    outputPath: resultPath,
  });

  console.log(
    JSON.stringify(
      {
        outputDir: args.outputDir,
        resultPath,
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
