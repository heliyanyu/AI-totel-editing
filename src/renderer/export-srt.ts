import { readFileSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import type { Blueprint, TimingMap } from "../schemas/blueprint.js";

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function buildSrt(
  blueprint: Blueprint,
  timingMap: TimingMap
): string {
  // Build a map from atom id to output timing.
  const atomOutputTiming = new Map<
    number,
    { start: number; end: number }
  >();
  for (const seg of timingMap.segments) {
    atomOutputTiming.set(seg.atom_id, {
      start: seg.output.start,
      end: seg.output.end,
    });
  }

  // Collect all kept atoms with their subtitle text and output timing.
  const entries: Array<{ start: number; end: number; text: string }> = [];
  for (const scene of blueprint.scenes) {
    for (const seg of scene.logic_segments) {
      for (const atom of seg.atoms) {
        if (atom.status !== "keep") continue;
        const timing = atomOutputTiming.get(atom.id);
        if (!timing || timing.end <= timing.start) continue;
        const text = ((atom as any).subtitle_text ?? atom.text ?? "").trim();
        if (!text) continue;
        entries.push({ start: timing.start, end: timing.end, text });
      }
    }
  }

  // Sort by start time.
  entries.sort((a, b) => a.start - b.start);

  // Extend each entry's end to the next entry's start, eliminating gaps.
  for (let i = 0; i < entries.length - 1; i++) {
    if (entries[i].end < entries[i + 1].start) {
      entries[i].end = entries[i + 1].start;
    }
  }

  // Format as SRT.
  return entries
    .map(
      (entry, i) =>
        `${i + 1}\n${formatSrtTime(entry.start)} --> ${formatSrtTime(entry.end)}\n${entry.text}\n`
    )
    .join("\n");
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  let blueprintPath = "";
  let timingMapPath = "";
  let outputPath = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--blueprint":
      case "-b":
        blueprintPath = args[++i];
        break;
      case "--timing-map":
      case "-t":
        timingMapPath = args[++i];
        break;
      case "--output":
      case "-o":
        outputPath = args[++i];
        break;
    }
  }

  if (!blueprintPath || !timingMapPath) {
    console.error(
      "Usage: npx tsx src/renderer/export-srt.ts -b blueprint.json -t timing_map.json [-o output.srt]"
    );
    process.exit(1);
  }

  const blueprint: Blueprint = JSON.parse(
    readFileSync(resolve(blueprintPath), "utf-8")
  );
  const timingMap: TimingMap = JSON.parse(
    readFileSync(resolve(timingMapPath), "utf-8")
  );

  const srt = buildSrt(blueprint, timingMap);
  const outPath = outputPath
    ? resolve(outputPath)
    : join(
        resolve(blueprintPath, ".."),
        "subtitles.srt"
      );

  writeFileSync(outPath, srt, "utf-8");
  console.log(`SRT 已保存: ${outPath} (${srt.split("\n\n").length} 条)`);
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("export-srt.ts") ||
    process.argv[1].endsWith("export-srt.js"));
if (isMainModule) {
  main().catch((err) => {
    console.error("Error:", err.message ?? err);
    process.exit(1);
  });
}
