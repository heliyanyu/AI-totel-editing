import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Atom = {
  id: number;
  text: string;
  time: { s: number; e: number };
  boundary?: "scene" | "logic";
  status?: "keep" | "discard";
  reason?: string;
  audio_span_id?: string;
};

type Step1File = {
  atoms?: Atom[];
  audio_spans?: AudioSpan[];
};

type AudioSpan = {
  id: string;
  start_id: number;
  end_id: number;
  reason?: string;
};

type DiscardRange = {
  start_id: number;
  end_id: number;
  reason?: string;
};

type TakePassFile = {
  discard_ranges?: DiscardRange[];
};

type TimingClip = {
  id: string;
  output: { start: number; end: number };
};

type TimingMap = {
  clips?: TimingClip[];
  totalDuration?: number;
};

type ParsedArgs = {
  step1Path: string;
  step1TakenPath: string;
  takePassPath: string;
  timingMapPath: string;
  outputPath: string;
  videoPath: string;
};

type SceneBlock = {
  index: number;
  start: number;
  end: number;
  atoms: Atom[];
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let step1Path = "";
  let step1TakenPath = "";
  let takePassPath = "";
  let timingMapPath = "";
  let outputPath = "";
  let videoPath = "";

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--step1") {
      step1Path = args[++index] ?? "";
    } else if (arg === "--step1-taken") {
      step1TakenPath = args[++index] ?? "";
    } else if (arg === "--take-pass") {
      takePassPath = args[++index] ?? "";
    } else if (arg === "--timing-map") {
      timingMapPath = args[++index] ?? "";
    } else if (arg === "--output") {
      outputPath = args[++index] ?? "";
    } else if (arg === "--video") {
      videoPath = args[++index] ?? "";
    }
  }

  if (!step1Path || !step1TakenPath || !takePassPath || !outputPath) {
    throw new Error(
      "Usage: npx tsx scripts/build-take-pass-visual-report.ts --step1 step1_result.json --step1-taken step1_taken.json --take-pass take_pass_result.json [--timing-map timing_map.json] --output take_pass_visual.html [--video result.mp4]"
    );
  }

  return {
    step1Path: resolve(step1Path),
    step1TakenPath: resolve(step1TakenPath),
    takePassPath: resolve(takePassPath),
    timingMapPath: timingMapPath ? resolve(timingMapPath) : "",
    outputPath: resolve(outputPath),
    videoPath: videoPath ? resolve(videoPath) : "",
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const whole = Math.floor(total);
  const minutes = Math.floor(whole / 60);
  const remain = whole % 60;
  const fraction = Math.round((total - whole) * 100);
  return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(
    2,
    "0"
  )}.${String(fraction).padStart(2, "0")}`;
}

function sceneBlocks(atoms: Atom[]): SceneBlock[] {
  const scenes: SceneBlock[] = [];
  let current: Atom[] = [];

  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    if (index === 0 || atom.boundary === "scene") {
      if (current.length > 0) {
        scenes.push({
          index: scenes.length + 1,
          start: current[0].time.s,
          end: current[current.length - 1].time.e,
          atoms: current,
        });
      }
      current = [atom];
    } else {
      current.push(atom);
    }
  }

  if (current.length > 0) {
    scenes.push({
      index: scenes.length + 1,
      start: current[0].time.s,
      end: current[current.length - 1].time.e,
      atoms: current,
    });
  }

  return scenes;
}

function mergeAtoms(baseAtoms: Atom[], takenAtoms: Atom[]): Atom[] {
  const overlayById = new Map(takenAtoms.map((atom) => [atom.id, atom]));
  return baseAtoms.map((atom) => {
    const overlay = overlayById.get(atom.id);
    return {
      ...atom,
      status: overlay?.status ?? atom.status,
      reason: overlay?.reason,
      audio_span_id: overlay?.audio_span_id,
    };
  });
}

function textForRange(atoms: Atom[], startId: number, endId: number): string {
  return atoms
    .filter((atom) => atom.id >= startId && atom.id <= endId)
    .map((atom) => atom.text)
    .join("");
}

function durationForRange(atoms: Atom[], startId: number, endId: number): number {
  const ranged = atoms.filter((atom) => atom.id >= startId && atom.id <= endId);
  if (ranged.length === 0) {
    return 0;
  }
  return ranged[ranged.length - 1].time.e - ranged[0].time.s;
}

function badgeClass(duration: number): string {
  if (duration < 1.5) {
    return "bad";
  }
  if (duration < 2.2) {
    return "watch";
  }
  return "clean";
}

function buildHtml(
  atoms: Atom[],
  spans: AudioSpan[],
  discardRanges: DiscardRange[],
  timing: TimingMap | null,
  videoPath: string
): string {
  const scenes = sceneBlocks(atoms);
  const keptAtoms = atoms.filter((atom) => atom.status === "keep").length;
  const discardedAtoms = atoms.filter((atom) => atom.status === "discard").length;
  const spanSummaries = spans.map((span, index) => {
    const duration = durationForRange(atoms, span.start_id, span.end_id);
    const output = timing?.clips?.[index]?.output;
    return {
      ...span,
      duration,
      text: textForRange(atoms, span.start_id, span.end_id),
      output,
    };
  });
  const shortSpans = spanSummaries.filter((span) => span.duration < 1.5);

  const shortSpansHtml = shortSpans.length
    ? shortSpans
        .map(
          (span) => `
        <article class="card short">
          <div class="row spread">
            <strong>${escapeHtml(span.id)}</strong>
            <span>${span.duration.toFixed(2)}s</span>
          </div>
          <div class="small">ids ${span.start_id}-${span.end_id}</div>
          <div class="text">${escapeHtml(span.text)}</div>
        </article>
      `
        )
        .join("\n")
    : `<div class="empty">没有 &lt; 1.5s 的超短 span。</div>`;

  const spanCardsHtml = spanSummaries
    .map((span) => {
      const severity = badgeClass(span.duration);
      const jumpAttrs = span.output
        ? `data-start="${span.output.start.toFixed(
            2
          )}" data-end="${span.output.end.toFixed(2)}"`
        : "";
      return `
        <article class="card span ${severity}">
          <div class="row spread">
            <div>
              <strong>${escapeHtml(span.id)}</strong>
              <span class="small">ids ${span.start_id}-${span.end_id}</span>
            </div>
            <div class="pill ${severity}">${span.duration.toFixed(2)}s</div>
          </div>
          ${
            span.output
              ? `<div class="small">output ${formatTime(span.output.start)} - ${formatTime(
                  span.output.end
                )}</div>`
              : ""
          }
          <div class="text">${escapeHtml(span.text)}</div>
          ${
            span.reason
              ? `<div class="reason">${escapeHtml(span.reason)}</div>`
              : ""
          }
          ${
            span.output
              ? `<button class="jump" ${jumpAttrs}>跳到这段</button>`
              : ""
          }
        </article>
      `;
    })
    .join("\n");

  const discardCardsHtml = discardRanges
    .map((range) => {
      const text = textForRange(atoms, range.start_id, range.end_id);
      const duration = durationForRange(atoms, range.start_id, range.end_id);
      return `
        <article class="card discard">
          <div class="row spread">
            <strong>D ${range.start_id}-${range.end_id}</strong>
            <span>${duration.toFixed(2)}s</span>
          </div>
          <div class="text">${escapeHtml(text)}</div>
          ${
            range.reason
              ? `<div class="reason">${escapeHtml(range.reason)}</div>`
              : ""
          }
        </article>
      `;
    })
    .join("\n");

  const scenesHtml = scenes
    .map((scene) => {
      const atomsHtml = scene.atoms
        .map((atom) => {
          const state = atom.status ?? "keep";
          const title = atom.reason
            ? `${atom.text}\n${atom.reason}`
            : atom.text;
          const meta = [
            `#${atom.id}`,
            `${(atom.time.e - atom.time.s).toFixed(2)}s`,
            atom.audio_span_id ?? "",
          ]
            .filter(Boolean)
            .join(" · ");
          return `
            <div class="atom ${state}" title="${escapeHtml(title)}">
              <div class="atom-meta">${escapeHtml(meta)}</div>
              <div class="atom-text">${escapeHtml(atom.text)}</div>
            </div>
          `;
        })
        .join("\n");

      return `
        <section class="scene">
          <div class="row spread">
            <h3>Scene ${scene.index}</h3>
            <div class="small">${formatTime(scene.start)} - ${formatTime(
              scene.end
            )}</div>
          </div>
          <div class="atoms">${atomsHtml}</div>
        </section>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Take Pass Visual Report</title>
  <style>
    :root {
      --bg: #f5f1ea;
      --panel: rgba(255,255,255,0.84);
      --card: #fffdfa;
      --ink: #1e1b18;
      --muted: #6f675e;
      --line: #d9cfbf;
      --keep: #0c7c59;
      --discard: #c44536;
      --watch: #d78a1b;
      --accent: #215a6d;
      --short: #b03a2e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(255,209,102,0.22), transparent 28%),
        radial-gradient(circle at top right, rgba(33,90,109,0.12), transparent 22%),
        linear-gradient(180deg, #efe3cf 0%, var(--bg) 32%, #faf7f1 100%);
      font: 14px/1.5 "Microsoft YaHei", "PingFang SC", sans-serif;
    }
    .shell {
      display: grid;
      grid-template-columns: 360px 1fr;
      min-height: 100vh;
    }
    .sidebar {
      position: sticky;
      top: 0;
      align-self: start;
      height: 100vh;
      overflow: auto;
      padding: 20px;
      border-right: 1px solid var(--line);
      background: var(--panel);
      backdrop-filter: blur(16px);
    }
    .content {
      padding: 22px;
      display: grid;
      gap: 22px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      line-height: 1.1;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 20px;
    }
    h3 {
      margin: 0;
      font-size: 18px;
    }
    .summary {
      color: var(--muted);
      margin-bottom: 14px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
    }
    .chip, .pill {
      border-radius: 999px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.76);
    }
    .pill.clean { color: var(--keep); }
    .pill.watch { color: var(--watch); }
    .pill.bad { color: var(--short); }
    .legend {
      display: grid;
      gap: 8px;
      margin-top: 12px;
      color: var(--muted);
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dot {
      width: 12px;
      height: 12px;
      border-radius: 999px;
    }
    .dot.keep { background: var(--keep); }
    .dot.discard { background: var(--discard); }
    .dot.short { background: var(--short); }
    video {
      width: 100%;
      border-radius: 18px;
      background: #000;
      margin-top: 10px;
      box-shadow: 0 16px 50px rgba(0,0,0,0.14);
    }
    .section {
      background: rgba(255,255,255,0.55);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 18px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .spread {
      justify-content: space-between;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px;
      box-shadow: 0 10px 28px rgba(0,0,0,0.05);
    }
    .card.short { border-left: 6px solid var(--short); }
    .card.discard { border-left: 6px solid var(--discard); }
    .card.span.clean { border-left: 6px solid var(--keep); }
    .card.span.watch { border-left: 6px solid var(--watch); }
    .card.span.bad { border-left: 6px solid var(--short); }
    .small {
      color: var(--muted);
      font-size: 12px;
    }
    .text {
      margin-top: 8px;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 15px;
    }
    .reason {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px dashed var(--line);
      color: var(--muted);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .jump {
      margin-top: 12px;
      appearance: none;
      border: none;
      border-radius: 999px;
      background: var(--accent);
      color: white;
      padding: 8px 12px;
      cursor: pointer;
      font: inherit;
    }
    .scene + .scene {
      margin-top: 18px;
      padding-top: 18px;
      border-top: 1px solid var(--line);
    }
    .atoms {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .atom {
      min-width: 96px;
      max-width: 220px;
      border-radius: 14px;
      padding: 8px 10px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.82);
    }
    .atom.keep {
      border-color: rgba(12,124,89,0.35);
      background: rgba(12,124,89,0.10);
    }
    .atom.discard {
      border-color: rgba(196,69,54,0.35);
      background: rgba(196,69,54,0.09);
    }
    .atom-meta {
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .atom-text {
      font-size: 14px;
      word-break: break-word;
    }
    .empty {
      color: var(--muted);
      padding: 12px 0 2px;
    }
    @media (max-width: 1040px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar {
        position: static;
        height: auto;
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <h1>Take/Pass Visual</h1>
      <div class="summary">一页同时看 repair-pass 删除了什么、最终 audio span 怎么切、以及 scene 里每个 atom 的 keep/discard 状态。</div>
      <div class="chips">
        <div class="chip">atoms ${atoms.length}</div>
        <div class="chip">keep ${keptAtoms}</div>
        <div class="chip">discard ${discardedAtoms}</div>
        <div class="chip">discard ranges ${discardRanges.length}</div>
        <div class="chip">audio spans ${spans.length}</div>
        <div class="chip">short spans ${shortSpans.length}</div>
        ${
          typeof timing?.totalDuration === "number"
            ? `<div class="chip">video ${timing.totalDuration.toFixed(2)}s</div>`
            : ""
        }
      </div>
      ${
        videoPath
          ? `<video id="video" controls preload="metadata" src="${escapeHtml(
              videoPath
            )}"></video>`
          : ""
      }
      <div class="legend">
        <div class="legend-item"><span class="dot keep"></span><span>keep atom</span></div>
        <div class="legend-item"><span class="dot discard"></span><span>discard atom / discard range</span></div>
        <div class="legend-item"><span class="dot short"></span><span>short final span (&lt; 1.5s)</span></div>
      </div>
    </aside>
    <main class="content">
      <section class="section">
        <h2>Shortest Spans</h2>
        <div class="grid">${shortSpansHtml}</div>
      </section>

      <section class="section">
        <h2>Final Audio Spans</h2>
        <div class="grid">${spanCardsHtml}</div>
      </section>

      <section class="section">
        <h2>Repair-Pass Discard Ranges</h2>
        <div class="grid">${discardCardsHtml}</div>
      </section>

      <section class="section">
        <h2>By Scene</h2>
        ${scenesHtml}
      </section>
    </main>
  </div>
  <script>
    const video = document.getElementById("video");
    for (const button of document.querySelectorAll(".jump")) {
      button.addEventListener("click", () => {
        if (!video) return;
        const start = Number(button.dataset.start || "0");
        const end = Number(button.dataset.end || "0");
        video.currentTime = Math.max(0, start - 0.2);
        video.play().catch(() => {});
        const onTick = () => {
          if (video.currentTime >= end + 0.08) {
            video.pause();
            video.removeEventListener("timeupdate", onTick);
          }
        };
        video.addEventListener("timeupdate", onTick);
      });
    }
  </script>
</body>
</html>`;
}

function main() {
  const args = parseArgs();
  const step1 = readJsonFile<Step1File>(args.step1Path);
  const step1Taken = readJsonFile<Step1File>(args.step1TakenPath);
  const takePass = readJsonFile<TakePassFile>(args.takePassPath);
  const timing = args.timingMapPath
    ? readJsonFile<TimingMap>(args.timingMapPath)
    : null;

  const atoms = mergeAtoms(step1.atoms ?? [], step1Taken.atoms ?? []);
  const spans = step1Taken.audio_spans ?? [];
  const discardRanges = takePass.discard_ranges ?? [];
  const html = buildHtml(atoms, spans, discardRanges, timing, args.videoPath);

  mkdirSync(dirname(args.outputPath), { recursive: true });
  writeFileSync(args.outputPath, html, "utf-8");
  console.log(`Take-pass visual report saved: ${args.outputPath}`);
}

main();
