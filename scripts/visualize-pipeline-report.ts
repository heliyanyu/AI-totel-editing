import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";

type TranscriptWord = {
  text: string;
  start?: number;
  end?: number;
};

type Transcript = {
  duration?: number;
  words: TranscriptWord[];
};

type ReviewedToken = {
  id: number;
  text: string;
};

type ReviewedTokenDocument = {
  duration?: number;
  text: string;
  tokens: ReviewedToken[];
};

type ReviewSpan = {
  id: number;
  sourceWordStart: number;
  sourceWordEnd: number;
  sourceStart?: number;
  sourceEnd?: number;
  originalText: string;
  cleanedText: string;
  confidence?: number;
};

type Step1Boundary = "scene" | "logic";

type Step1Atom = {
  id: number;
  start_id?: number;
  end_id?: number;
  text: string;
  time?: { s?: number; e?: number };
  status?: "keep" | "discard";
  boundary?: Step1Boundary;
  reason?: string;
};

type Step1Result = {
  atoms: Step1Atom[];
};

type TakePassRange = {
  start_atom_id: number;
  end_atom_id: number;
};

type TakePassResult = {
  discard_ranges?: TakePassRange[];
};

type BlueprintItem = {
  text: string;
  emoji?: string;
};

type BlueprintAtom = {
  id: number;
  text: string;
  status: "keep" | "discard";
  boundary?: Step1Boundary;
};

type LogicSegment = {
  id: string;
  transition_type: string;
  template: string;
  items: BlueprintItem[];
  template_props?: Record<string, unknown>;
  atoms: BlueprintAtom[];
};

type BlueprintScene = {
  id: string;
  title: string;
  view: string;
  logic_segments: LogicSegment[];
};

type Blueprint = {
  title: string;
  scenes: BlueprintScene[];
};

type TimingMap = {
  mode?: string;
  totalDuration?: number;
  clips?: Array<{ id: string; atom_ids?: number[] }>;
};

function parseArgs(argv: string[]) {
  let analysisDir = "";
  let renderDir = "";
  let outputPath = "";

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--analysis-dir":
        analysisDir = argv[++index] ?? "";
        break;
      case "--render-dir":
        renderDir = argv[++index] ?? "";
        break;
      case "--output":
      case "-o":
        outputPath = argv[++index] ?? "";
        break;
      default:
        break;
    }
  }

  if (!analysisDir) {
    throw new Error(
      "Usage: npx tsx scripts/visualize-pipeline-report.ts --analysis-dir <dir> [--render-dir <dir>] [-o <file>]"
    );
  }

  const resolvedAnalysisDir = resolve(analysisDir);
  const resolvedRenderDir = resolve(renderDir || analysisDir);
  const resolvedOutputPath = resolve(
    outputPath || join(resolvedRenderDir, "pipeline_visual_report.md")
  );

  return {
    analysisDir: resolvedAnalysisDir,
    renderDir: resolvedRenderDir,
    outputPath: resolvedOutputPath,
  };
}

function readJsonIfExists<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function compactText(text: string): string {
  return (text ?? "").replace(/\s+/g, "");
}

function transcriptToText(transcript?: Transcript): string {
  if (!transcript) {
    return "";
  }
  return transcript.words.map((word) => word.text).join("");
}

function reviewedToText(reviewed?: ReviewedTokenDocument): string {
  if (!reviewed) {
    return "";
  }
  return reviewed.text || reviewed.tokens.map((token) => token.text).join("");
}

function editDistance(a: string, b: string): number {
  const charsA = Array.from(a);
  const charsB = Array.from(b);
  const rows = charsA.length + 1;
  const cols = charsB.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) {
    table[i][0] = i;
  }
  for (let j = 0; j < cols; j++) {
    table[0][j] = j;
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (charsA[i - 1] === charsB[j - 1]) {
        table[i][j] = table[i - 1][j - 1];
        continue;
      }
      table[i][j] = Math.min(
        table[i - 1][j] + 1,
        table[i][j - 1] + 1,
        table[i - 1][j - 1] + 1
      );
    }
  }

  return table[rows - 1][cols - 1];
}

function truncate(text: string, maxLength = 80): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function markerForBoundary(boundary?: Step1Boundary, first = false): string {
  if (first || boundary === "scene") {
    return "|||";
  }
  if (boundary === "logic") {
    return "||";
  }
  return "|";
}

function mergeBoundary(
  current: Step1Boundary | undefined,
  incoming: Step1Boundary | undefined
): Step1Boundary | undefined {
  if (current === "scene" || incoming === "scene") {
    return "scene";
  }
  if (current === "logic" || incoming === "logic") {
    return "logic";
  }
  return undefined;
}

function renderAtomText(atom: Step1Atom | BlueprintAtom, showDiscard = false): string {
  if (showDiscard && atom.status === "discard") {
    return `×[${atom.text}]`;
  }
  return `[${atom.text}]`;
}

function renderMarkedAtoms(
  atoms: Array<Step1Atom | BlueprintAtom>,
  options?: { keepOnly?: boolean; showDiscard?: boolean }
): string {
  if (!atoms.length) {
    return "(no atoms)";
  }

  const keepOnly = options?.keepOnly ?? false;
  const showDiscard = options?.showDiscard ?? false;
  const lines: string[] = [];
  let currentLine = "";
  let pendingBoundary: Step1Boundary | undefined;
  let firstVisible = true;

  const pushSegment = (marker: string, segment: string) => {
    if (!currentLine) {
      currentLine = `${marker} ${segment}`;
      return;
    }
    lines.push(currentLine);
    currentLine = `${marker} ${segment}`;
  };

  for (const atom of atoms) {
    if (keepOnly && atom.status === "discard") {
      pendingBoundary = mergeBoundary(pendingBoundary, atom.boundary);
      continue;
    }

    const effectiveBoundary = mergeBoundary(pendingBoundary, atom.boundary);
    pendingBoundary = undefined;
    const marker = markerForBoundary(effectiveBoundary, firstVisible);
    const segment = renderAtomText(atom, showDiscard);

    if (firstVisible || effectiveBoundary === "scene" || effectiveBoundary === "logic") {
      pushSegment(marker, segment);
    } else {
      currentLine += ` | ${segment}`;
    }

    firstVisible = false;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.join("\n");
}

function collectBlueprintAtoms(blueprint?: Blueprint): BlueprintAtom[] {
  if (!blueprint) {
    return [];
  }
  const atoms: BlueprintAtom[] = [];
  for (const scene of blueprint.scenes) {
    let firstSceneAtom = true;
    for (const logicSegment of scene.logic_segments) {
      let firstLogicAtom = true;
      for (const atom of logicSegment.atoms) {
        atoms.push({
          ...atom,
          boundary: firstSceneAtom
            ? "scene"
            : firstLogicAtom
              ? "logic"
              : undefined,
        });
        firstSceneAtom = false;
        firstLogicAtom = false;
      }
    }
  }
  return atoms;
}

function countBoundaries(atoms: Step1Atom[]) {
  let sceneCount = 0;
  let logicCount = 0;
  for (const atom of atoms) {
    if (atom.boundary === "scene") {
      sceneCount += 1;
    } else if (atom.boundary === "logic") {
      logicCount += 1;
    }
  }
  return { sceneCount, logicCount };
}

function formatBytes(value?: number): string {
  if (!value || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function fileSizeIfExists(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  return formatBytes(statSync(filePath).size);
}

function renderReviewSection(
  transcriptText: string,
  reviewedText: string,
  reviewSpans: ReviewSpan[]
): string {
  const changedSpans = reviewSpans.filter(
    (span) => compactText(span.originalText) !== compactText(span.cleanedText)
  );
  const changedCharCount = changedSpans.reduce(
    (sum, span) => sum + editDistance(compactText(span.originalText), compactText(span.cleanedText)),
    0
  );

  const lines: string[] = [];
  lines.push("## Review");
  lines.push("");
  lines.push(`- source spans: ${reviewSpans.length}`);
  lines.push(`- 实际改动 spans: ${changedSpans.length}`);
  lines.push(`- 字符编辑距离总计: ${changedCharCount}`);
  lines.push(
    changedSpans.length === 0 && compactText(transcriptText) === compactText(reviewedText)
      ? "- 结论: 本次 review 为纯透传，这个 case 可以考虑跳过 review。"
      : "- 结论: 本次 review 确实改动了文本，建议保留 review。"
  );
  lines.push("");
  lines.push("### 原文");
  lines.push("");
  lines.push(transcriptText || "(missing transcript)");
  lines.push("");
  lines.push("### Review 后");
  lines.push("");
  lines.push(reviewedText || "(missing reviewed text)");
  lines.push("");
  lines.push("### 改动明细");
  lines.push("");

  if (changedSpans.length === 0) {
    lines.push("- 无改动");
  } else {
    for (const span of changedSpans) {
      const timeText =
        span.sourceStart !== undefined && span.sourceEnd !== undefined
          ? ` | ${span.sourceStart.toFixed(2)}-${span.sourceEnd.toFixed(2)}s`
          : "";
      lines.push(
        `- span ${span.id} | words ${span.sourceWordStart}-${span.sourceWordEnd}${timeText} | distance ${editDistance(
          compactText(span.originalText),
          compactText(span.cleanedText)
        )}`
      );
      lines.push(`  原: ${truncate(span.originalText, 120)}`);
      lines.push(`  改: ${truncate(span.cleanedText, 120)}`);
    }
  }

  return lines.join("\n");
}

function renderStep2Section(blueprint?: Blueprint): string {
  const lines: string[] = [];
  lines.push("## Step2 / 编排");
  lines.push("");

  if (!blueprint) {
    lines.push("- 未找到 blueprint，无法展示 step2 编排结果。");
    return lines.join("\n");
  }

  const templates = blueprint.scenes.flatMap((scene) =>
    scene.logic_segments.map((segment) => segment.template)
  );
  const subtitleOnly = templates.length > 0 && templates.every((template) => template === "subtitle_only");

  lines.push(`- title: ${blueprint.title}`);
  lines.push(`- scenes: ${blueprint.scenes.length}`);
  lines.push(`- logic segments: ${blueprint.scenes.reduce((sum, scene) => sum + scene.logic_segments.length, 0)}`);
  lines.push(
    subtitleOnly
      ? "- 说明: 当前 blueprint 是 subtitle_only，step2 被跳过，只保留医生原视频和字幕。"
      : `- templates: ${Array.from(new Set(templates)).join(", ")}`
  );
  lines.push("");

  for (const scene of blueprint.scenes) {
    lines.push(`### ${scene.id} | ${scene.title} | ${scene.view}`);
    lines.push("");
    for (const segment of scene.logic_segments) {
      const items = segment.items.map((item) => `${item.emoji ?? ""}${item.text}`).join(" / ");
      lines.push(`- ${segment.id} | ${segment.template} | ${segment.transition_type}`);
      lines.push(`  items: ${items || "(empty)"}`);
      const props =
        segment.template_props && Object.keys(segment.template_props).length > 0
          ? JSON.stringify(segment.template_props)
          : "{}";
      lines.push(`  props: ${props}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function main() {
  const { analysisDir, renderDir, outputPath } = parseArgs(process.argv.slice(2));

  const transcript =
    readJsonIfExists<Transcript>(join(analysisDir, "transcript_raw.json")) ??
    readJsonIfExists<Transcript>(join(analysisDir, "transcript.json")) ??
    readJsonIfExists<Transcript>(join(renderDir, "transcript_raw.json")) ??
    readJsonIfExists<Transcript>(join(renderDir, "transcript.json"));
  const reviewedTokens =
    readJsonIfExists<ReviewedTokenDocument>(join(analysisDir, "reviewed_tokens.json")) ??
    readJsonIfExists<ReviewedTokenDocument>(join(renderDir, "reviewed_tokens.json"));
  const reviewSpans =
    readJsonIfExists<ReviewSpan[]>(join(analysisDir, "review_spans.json")) ??
    readJsonIfExists<ReviewSpan[]>(join(renderDir, "review_spans.json")) ??
    [];
  const step1Result =
    readJsonIfExists<Step1Result>(join(analysisDir, "step1_result.json")) ??
    readJsonIfExists<Step1Result>(join(renderDir, "step1_result.json"));
  const step1Taken =
    readJsonIfExists<Step1Result>(join(analysisDir, "step1_taken.json")) ??
    readJsonIfExists<Step1Result>(join(renderDir, "step1_taken.json"));
  const takePass =
    readJsonIfExists<TakePassResult>(join(analysisDir, "take_pass_result.json")) ??
    readJsonIfExists<TakePassResult>(join(renderDir, "take_pass_result.json"));
  const blueprint =
    readJsonIfExists<Blueprint>(join(renderDir, "blueprint.json")) ??
    readJsonIfExists<Blueprint>(join(analysisDir, "blueprint.json")) ??
    readJsonIfExists<Blueprint>(join(renderDir, "blueprint_derived.json")) ??
    readJsonIfExists<Blueprint>(join(analysisDir, "blueprint_derived.json")) ??
    readJsonIfExists<Blueprint>(join(renderDir, "blueprint_merged.json")) ??
    readJsonIfExists<Blueprint>(join(analysisDir, "blueprint_merged.json"));
  const timingMap =
    readJsonIfExists<TimingMap>(join(renderDir, "timing_map.json")) ??
    readJsonIfExists<TimingMap>(join(analysisDir, "timing_map.json"));

  const transcriptText = transcriptToText(transcript);
  const reviewedText = reviewedToText(reviewedTokens) || transcriptText;
  const step1Atoms = step1Result?.atoms ?? [];
  const step1TakenAtoms = step1Taken?.atoms ?? [];
  const blueprintAtoms = collectBlueprintAtoms(blueprint);
  const step1Counts = countBoundaries(step1Atoms);
  const takeCounts = {
    total: step1TakenAtoms.length,
    keep: step1TakenAtoms.filter((atom) => atom.status !== "discard").length,
    discard: step1TakenAtoms.filter((atom) => atom.status === "discard").length,
  };
  const sourceDirectCutVideoPath = join(renderDir, "source_direct_cut_video.mp4");
  const overlayLayerPath = existsSync(join(renderDir, "overlay_layer.mp4"))
    ? join(renderDir, "overlay_layer.mp4")
    : join(renderDir, "result.mp4");

  const lines: string[] = [];
  lines.push("# Pipeline Visual Report");
  lines.push("");
  lines.push(`- analysis dir: \`${analysisDir}\``);
  lines.push(`- render dir: \`${renderDir}\``);
  lines.push("");
  lines.push("## 概览");
  lines.push("");
  lines.push(`- 原始文本长度: ${Array.from(transcriptText).length} 字`);
  lines.push(`- review 后文本长度: ${Array.from(reviewedText).length} 字`);
  lines.push(`- step1 atoms: ${step1Atoms.length}`);
  lines.push(`- step1 scenes: ${step1Counts.sceneCount}`);
  lines.push(`- step1 logic breaks: ${step1Counts.logicCount}`);
  lines.push(`- take-pass keep/discard: ${takeCounts.keep}/${takeCounts.discard}`);
  lines.push(
    `- discard ranges: ${takePass?.discard_ranges?.length ?? 0}`
  );
  if (blueprint) {
    lines.push(`- blueprint scenes: ${blueprint.scenes.length}`);
    lines.push(
      `- blueprint logic segments: ${blueprint.scenes.reduce((sum, scene) => sum + scene.logic_segments.length, 0)}`
    );
  }
  if (timingMap) {
    lines.push(`- timing mode: ${timingMap.mode ?? "unknown"}`);
    lines.push(`- timing clips: ${timingMap.clips?.length ?? 0}`);
    if (typeof timingMap.totalDuration === "number") {
      lines.push(`- total duration: ${timingMap.totalDuration.toFixed(2)}s`);
    }
  }
  const cutVideoSize = fileSizeIfExists(sourceDirectCutVideoPath);
  if (cutVideoSize) {
    lines.push(`- 剪裁后的原视频: \`${sourceDirectCutVideoPath}\` (${cutVideoSize})`);
  }
  const overlayLayerSize = fileSizeIfExists(overlayLayerPath);
  if (overlayLayerSize) {
    lines.push(`- overlay layer: \`${overlayLayerPath}\` (${overlayLayerSize})`);
  }
  lines.push("");
  lines.push(renderReviewSection(transcriptText, reviewedText, reviewSpans));
  lines.push("");
  lines.push("## Step1 / 三级切块");
  lines.push("");
  if (step1Atoms.length === 0) {
    lines.push("- 未找到 step1_result.json");
  } else {
    lines.push("```text");
    lines.push(renderMarkedAtoms(step1Atoms));
    lines.push("```");
  }
  lines.push("");
  lines.push("## Take-pass / 标记结果");
  lines.push("");
  lines.push("- 说明: `×[text]` = 本阶段判定 discard");
  lines.push("");
  if (step1TakenAtoms.length === 0) {
    lines.push("- 未找到 step1_taken.json");
  } else {
    lines.push("```text");
    lines.push(renderMarkedAtoms(step1TakenAtoms, { showDiscard: true }));
    lines.push("```");
  }
  lines.push("");
  lines.push("## Take-pass / 保留后");
  lines.push("");
  if (step1TakenAtoms.length === 0) {
    lines.push("- 未找到 step1_taken.json");
  } else {
    lines.push("```text");
    lines.push(renderMarkedAtoms(step1TakenAtoms, { keepOnly: true }));
    lines.push("```");
  }
  lines.push("");
  lines.push(renderStep2Section(blueprint));
  lines.push("");
  lines.push("## Final / Blueprint Keep Atoms");
  lines.push("");
  if (blueprintAtoms.length === 0) {
    lines.push("- 未找到 blueprint");
  } else {
    lines.push("```text");
    lines.push(renderMarkedAtoms(blueprintAtoms, { keepOnly: true }));
    lines.push("```");
  }
  lines.push("");

  writeFileSync(outputPath, lines.join("\n"), "utf-8");
  console.log(`Report written to ${outputPath}`);
}

main();
