import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Atom = {
  id: number;
  text: string;
  time: { s: number; e: number };
  boundary?: "scene" | "logic";
  status?: "keep" | "discard";
  audio_span_id?: string;
  reason?: string;
};

type AudioSpan = {
  id: string;
  start_id: number;
  end_id: number;
  reason?: string;
};

type TakePassDiscardRange = {
  start_id: number;
  end_id: number;
  reason?: string;
};

type Step1File = {
  atoms?: Atom[];
};

type Step1TakenFile = {
  atoms?: Atom[];
  audio_spans?: AudioSpan[];
};

type TakePassFile = {
  discard_ranges?: TakePassDiscardRange[];
};

type ParsedArgs = {
  step1Path: string;
  step1TakenPath: string;
  takePassPath: string;
  outputPath: string;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let step1Path = "";
  let step1TakenPath = "";
  let takePassPath = "";
  let outputPath = "";

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--step1") {
      step1Path = args[++index] ?? "";
    } else if (arg === "--step1-taken") {
      step1TakenPath = args[++index] ?? "";
    } else if (arg === "--take-pass") {
      takePassPath = args[++index] ?? "";
    } else if (arg === "--output") {
      outputPath = args[++index] ?? "";
    }
  }

  if (!step1Path || !step1TakenPath || !outputPath) {
    throw new Error(
      "Usage: npx tsx scripts/export-take-pass-annotation.ts --step1 step1_result.json --step1-taken step1_taken.json [--take-pass take_pass_result.json] --output take_pass_annotation.md"
    );
  }

  return {
    step1Path: resolve(step1Path),
    step1TakenPath: resolve(step1TakenPath),
    takePassPath: takePassPath ? resolve(takePassPath) : "",
    outputPath: resolve(outputPath),
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remain = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remain
    .toFixed(2)
    .padStart(5, "0")}`;
}

function formatDuration(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

function buildOverlayById(step1Taken: Step1TakenFile): Map<number, Atom> {
  return new Map((step1Taken.atoms ?? []).map((atom) => [atom.id, atom]));
}

function buildAtomsById(atoms: Atom[]): Map<number, Atom> {
  return new Map(atoms.map((atom) => [atom.id, atom]));
}

function groupScenes(atoms: Atom[]): Atom[][] {
  const scenes: Atom[][] = [];
  let current: Atom[] = [];

  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    if (index === 0 || atom.boundary === "scene") {
      if (current.length > 0) {
        scenes.push(current);
      }
      current = [atom];
    } else {
      current.push(atom);
    }
  }

  if (current.length > 0) {
    scenes.push(current);
  }

  return scenes;
}

function getStatus(atom: Atom, overlayById?: Map<number, Atom>): "keep" | "discard" {
  return (overlayById?.get(atom.id)?.status ?? atom.status ?? "keep") as
    | "keep"
    | "discard";
}

function getAudioSpanId(atom: Atom, overlayById?: Map<number, Atom>): string {
  return overlayById?.get(atom.id)?.audio_span_id ?? atom.audio_span_id ?? "";
}

function renderAtom(atom: Atom, overlayById?: Map<number, Atom>): string {
  const text = `[${atom.text}]`;
  return getStatus(atom, overlayById) === "discard" ? `~~${text}~~` : text;
}

function getMarker(atom: Atom, index: number): string {
  if (index === 0 || atom.boundary === "scene") {
    return index === 0 ? "||| " : "\n||| ";
  }
  if (atom.boundary === "logic") {
    return " || ";
  }
  return " | ";
}

function renderInlineAnnotation(
  atoms: Atom[],
  overlayById?: Map<number, Atom>
): string {
  const parts: string[] = [];

  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    parts.push(`${getMarker(atom, index)}${renderAtom(atom, overlayById)}`);
  }

  return parts.join("");
}

function renderInlineWithSpanOverlay(
  atoms: Atom[],
  overlayById: Map<number, Atom>
): string {
  const parts: string[] = [];
  let openSpanId = "";

  function closeSpan() {
    if (openSpanId) {
      parts.push("}");
      openSpanId = "";
    }
  }

  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    const marker = getMarker(atom, index);
    const status = getStatus(atom, overlayById);
    const spanId = getAudioSpanId(atom, overlayById);

    if (status === "discard" || !spanId) {
      closeSpan();
      parts.push(`${marker}${renderAtom(atom, overlayById)}`);
      continue;
    }

    if (openSpanId !== spanId) {
      closeSpan();
      parts.push(`${marker}${spanId}{${renderAtom(atom, overlayById)}`);
      openSpanId = spanId;
      continue;
    }

    parts.push(`${marker}${renderAtom(atom, overlayById)}`);
  }

  closeSpan();
  return parts.join("");
}

function renderSequence(atoms: Atom[]): string {
  return atoms
    .map((atom, index) => {
      const prefix = index === 0 ? "" : atom.boundary === "logic" ? " || " : " | ";
      return `${prefix}[${atom.text}]`;
    })
    .join("");
}

function renderByScene(
  scenes: Atom[][],
  overlayById: Map<number, Atom>
): string {
  return scenes
    .map((sceneAtoms, index) => {
      const start = formatTime(sceneAtoms[0].time.s);
      const end = formatTime(sceneAtoms[sceneAtoms.length - 1].time.e);
      return [
        `### Scene ${index + 1} (${start} - ${end})`,
        "",
        "```text",
        renderInlineWithSpanOverlay(sceneAtoms, overlayById),
        "```",
      ].join("\n");
    })
    .join("\n\n");
}

function renderAudioSpanTable(
  audioSpans: AudioSpan[],
  atomsById: Map<number, Atom>
): string {
  const header = [
    "| span | time | duration | atoms | text |",
    "|------|------|----------|-------|------|",
  ];

  const rows = audioSpans.map((span) => {
    const atoms: Atom[] = [];
    for (let id = span.start_id; id <= span.end_id; id++) {
      const atom = atomsById.get(id);
      if (atom) {
        atoms.push(atom);
      }
    }

    const start = atoms[0]?.time.s ?? 0;
    const end = atoms[atoms.length - 1]?.time.e ?? start;
    const text = atoms.map((atom) => atom.text).join(" ");

    return `| ${span.id} | ${formatTime(start)} - ${formatTime(end)} | ${formatDuration(
      end - start
    )} | ${span.start_id}-${span.end_id} | ${text} |`;
  });

  return [...header, ...rows].join("\n");
}

function renderShortSpanTable(
  audioSpans: AudioSpan[],
  atomsById: Map<number, Atom>,
  thresholdSeconds = 1.5
): string {
  const shortSpans = audioSpans
    .map((span) => {
      const start = atomsById.get(span.start_id)?.time.s ?? 0;
      const end = atomsById.get(span.end_id)?.time.e ?? start;
      return {
        span,
        duration: end - start,
      };
    })
    .filter((item) => item.duration < thresholdSeconds)
    .sort((left, right) => left.duration - right.duration);

  if (shortSpans.length === 0) {
    return "No spans shorter than 1.5s.";
  }

  const header = [
    "| span | duration | atoms | text |",
    "|------|----------|-------|------|",
  ];

  const rows = shortSpans.map(({ span, duration }) => {
    const atoms: Atom[] = [];
    for (let id = span.start_id; id <= span.end_id; id++) {
      const atom = atomsById.get(id);
      if (atom) {
        atoms.push(atom);
      }
    }
    const text = atoms.map((atom) => atom.text).join(" ");
    return `| ${span.id} | ${formatDuration(duration)} | ${span.start_id}-${span.end_id} | ${text} |`;
  });

  return [...header, ...rows].join("\n");
}

function renderDiscardRangeTable(
  discardRanges: TakePassDiscardRange[]
): string {
  if (discardRanges.length === 0) {
    return "No discard ranges.";
  }

  const header = [
    "| range | reason |",
    "|-------|--------|",
  ];

  const rows = discardRanges.map((range) => {
    const safeReason = (range.reason ?? "").replace(/\r?\n/g, " ");
    return `| ${range.start_id}-${range.end_id} | ${safeReason} |`;
  });

  return [...header, ...rows].join("\n");
}

function renderSpanReasonTable(audioSpans: AudioSpan[]): string {
  const header = [
    "| span | reason |",
    "|------|--------|",
  ];

  const rows = audioSpans.map((span) => {
    const safeReason = (span.reason ?? "").replace(/\r?\n/g, " ");
    return `| ${span.id} | ${safeReason} |`;
  });

  return [...header, ...rows].join("\n");
}

function renderSpanBlocks(
  audioSpans: AudioSpan[],
  atomsById: Map<number, Atom>
): string {
  return audioSpans
    .map((span) => {
      const atoms: Atom[] = [];
      for (let id = span.start_id; id <= span.end_id; id++) {
        const atom = atomsById.get(id);
        if (atom) {
          atoms.push(atom);
        }
      }

      const start = atoms[0]?.time.s ?? 0;
      const end = atoms[atoms.length - 1]?.time.e ?? start;

      return [
        `### ${span.id} (${formatTime(start)} - ${formatTime(end)}, ${formatDuration(
          end - start
        )}, atoms ${span.start_id}-${span.end_id})`,
        "",
        "```text",
        `${span.id}{${renderSequence(atoms)}}`,
        "```",
        "",
        span.reason ? `Reason: ${span.reason}` : "Reason: ",
      ].join("\n");
    })
    .join("\n\n");
}

function renderAtomTable(atoms: Atom[], overlayById: Map<number, Atom>): string {
  const header = [
    "| id | time | boundary | status | audio_span | text |",
    "|---:|------|----------|--------|------------|------|",
  ];

  const rows = atoms.map((atom) => {
    const overlayAtom = overlayById.get(atom.id);
    const boundary = atom.boundary ?? "";
    const status = overlayAtom?.status ?? atom.status ?? "keep";
    const audioSpanId = overlayAtom?.audio_span_id ?? "";
    return `| ${atom.id} | ${formatTime(atom.time.s)} - ${formatTime(
      atom.time.e
    )} | ${boundary} | ${status} | ${audioSpanId} | ${atom.text} |`;
  });

  return [...header, ...rows].join("\n");
}

function main() {
  const args = parseArgs();
  const step1 = readJsonFile<Step1File>(args.step1Path);
  const step1Taken = readJsonFile<Step1TakenFile>(args.step1TakenPath);
  const takePass = args.takePassPath
    ? readJsonFile<TakePassFile>(args.takePassPath)
    : { discard_ranges: [] };

  const atoms = step1.atoms ?? [];
  const overlayById = buildOverlayById(step1Taken);
  const atomsById = buildAtomsById(atoms);
  const scenes = groupScenes(atoms);
  const audioSpans = step1Taken.audio_spans ?? [];
  const discardRanges = takePass.discard_ranges ?? [];

  const markdown = [
    "# Take-Pass Annotation",
    "",
    "This file shows how `take/pass` deletes repair-chain drafts and groups the surviving `step1` atoms into final audio spans.",
    "",
    "## Legend",
    "",
    "| Marker | Meaning |",
    "|--------|---------|",
    "| `[]` | one step1 atom |",
    "| `|` | normal join inside a local flow |",
    "| `||` | logic boundary |",
    "| `|||` | scene boundary |",
    "| `~~[text]~~` | discarded by repair-pass |",
    "| `A7{...}` | one final audio span |",
    "",
    "## Raw Step1 Segmentation",
    "",
    "```text",
    renderInlineAnnotation(atoms),
    "```",
    "",
    "## Repair-Pass Overlay",
    "",
    "```text",
    renderInlineAnnotation(atoms, overlayById),
    "```",
    "",
    "## Final Take-Pass Overlay",
    "",
    "```text",
    renderInlineWithSpanOverlay(atoms, overlayById),
    "```",
    "",
    "## Short Final Spans (< 1.5s)",
    "",
    renderShortSpanTable(audioSpans, atomsById),
    "",
    "## Final Audio Spans",
    "",
    renderSpanBlocks(audioSpans, atomsById),
    "",
    "## Audio Span Table",
    "",
    renderAudioSpanTable(audioSpans, atomsById),
    "",
    "## Repair-Pass Discard Ranges",
    "",
    renderDiscardRangeTable(discardRanges),
    "",
    "## Audio Span Reasons",
    "",
    renderSpanReasonTable(audioSpans),
    "",
    "## By Scene",
    "",
    renderByScene(scenes, overlayById),
    "",
    "## Atom Table",
    "",
    renderAtomTable(atoms, overlayById),
    "",
  ]
    .filter((line, index, all) => {
      if (line !== "") {
        return true;
      }
      return all[index - 1] !== "";
    })
    .join("\n");

  mkdirSync(dirname(args.outputPath), { recursive: true });
  writeFileSync(args.outputPath, markdown, "utf-8");
  console.log(`Take-pass annotation saved: ${args.outputPath}`);
}

main();
