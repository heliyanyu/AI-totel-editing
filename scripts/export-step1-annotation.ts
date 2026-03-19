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

type Step1File = {
  atoms?: Atom[];
};

type ParsedArgs = {
  step1Path: string;
  step1TakenPath: string;
  outputPath: string;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let step1Path = "";
  let step1TakenPath = "";
  let outputPath = "";

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--step1") {
      step1Path = args[++index] ?? "";
    } else if (arg === "--step1-taken") {
      step1TakenPath = args[++index] ?? "";
    } else if (arg === "--output") {
      outputPath = args[++index] ?? "";
    }
  }

  if (!step1Path || !outputPath) {
    throw new Error(
      "Usage: npx tsx scripts/export-step1-annotation.ts --step1 step1_result.json [--step1-taken step1_taken.json] --output step1_annotation.md"
    );
  }

  return {
    step1Path: resolve(step1Path),
    step1TakenPath: step1TakenPath ? resolve(step1TakenPath) : "",
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

function buildStatusById(step1Taken: Step1File | null): Map<number, Atom> {
  return new Map((step1Taken?.atoms ?? []).map((atom) => [atom.id, atom]));
}

function renderAtomBody(atom: Atom, overlayAtom?: Atom): string {
  const status = overlayAtom?.status ?? atom.status ?? "keep";
  const text = `[${atom.text}]`;
  return status === "discard" ? `~~${text}~~` : text;
}

function renderInlineAnnotation(
  atoms: Atom[],
  overlayById?: Map<number, Atom>
): string {
  const parts: string[] = [];

  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    let marker = " | ";

    if (index === 0 || atom.boundary === "scene") {
      marker = index === 0 ? "||| " : "\n||| ";
    } else if (atom.boundary === "logic") {
      marker = " || ";
    }

    parts.push(`${marker}${renderAtomBody(atom, overlayById?.get(atom.id))}`);
  }

  return parts.join("");
}

function renderSceneSections(
  atoms: Atom[],
  overlayById?: Map<number, Atom>
): string {
  const scenes: Atom[][] = [];
  let currentScene: Atom[] = [];

  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    if (index === 0 || atom.boundary === "scene") {
      if (currentScene.length > 0) {
        scenes.push(currentScene);
      }
      currentScene = [atom];
    } else {
      currentScene.push(atom);
    }
  }

  if (currentScene.length > 0) {
    scenes.push(currentScene);
  }

  return scenes
    .map((sceneAtoms, index) => {
      const start = formatTime(sceneAtoms[0].time.s);
      const end = formatTime(sceneAtoms[sceneAtoms.length - 1].time.e);
      const body = renderInlineAnnotation(sceneAtoms, overlayById);
      return [`### Scene ${index + 1} (${start} - ${end})`, "", "```text", body, "```"].join(
        "\n"
      );
    })
    .join("\n\n");
}

function renderAtomTable(atoms: Atom[], overlayById?: Map<number, Atom>): string {
  const header = [
    "| id | time | boundary | status | audio_span | text |",
    "|---:|------|----------|--------|------------|------|",
  ];

  const rows = atoms.map((atom) => {
    const overlayAtom = overlayById?.get(atom.id);
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
  const step1Taken = args.step1TakenPath
    ? readJsonFile<Step1File>(args.step1TakenPath)
    : null;

  const atoms = step1.atoms ?? [];
  const overlayById = buildStatusById(step1Taken);

  const markdown = [
    "# Step1 Atom Annotation",
    "",
    "This file shows how the current `step1` semantic atoms are segmented.",
    "",
    "## Legend",
    "",
    "| Marker | Meaning |",
    "|--------|---------|",
    "| `[]` | one step1 atom |",
    "| `|` | normal join inside a local flow |",
    "| `||` | logic boundary |",
    "| `|||` | scene boundary |",
    "| `~~[text]~~` | removed later by take-pass |",
    "",
    "## Raw Step1 Segmentation",
    "",
    "```text",
    renderInlineAnnotation(atoms),
    "```",
    "",
    step1Taken ? "## Step1 With Take-Pass Overlay" : "",
    step1Taken ? "" : "",
    step1Taken ? "```text" : "",
    step1Taken ? renderInlineAnnotation(atoms, overlayById) : "",
    step1Taken ? "```" : "",
    step1Taken ? "" : "",
    "## By Scene",
    "",
    renderSceneSections(atoms, step1Taken ? overlayById : undefined),
    "",
    "## Atom Table",
    "",
    renderAtomTable(atoms, step1Taken ? overlayById : undefined),
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
  console.log(`Step1 annotation saved: ${args.outputPath}`);
}

main();
