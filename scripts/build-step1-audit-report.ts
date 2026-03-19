import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type TimeRange = {
  start: number;
  end: number;
};

type Atom = {
  id: number;
  text: string;
  status: "keep" | "discard";
  audio_span_id?: string;
  time: { s: number; e: number };
};

type AudioSpan = {
  id: string;
  start_id: number;
  end_id: number;
  reason?: string;
};

type Step1Taken = {
  atoms: Atom[];
  audio_spans?: AudioSpan[];
};

type TimingClip = {
  id: string;
  output: TimeRange;
  source: TimeRange;
  content: TimeRange;
  atom_ids: number[];
};

type TimingMap = {
  clips: TimingClip[];
  totalDuration: number;
};

type TranscriptWord = {
  text: string;
  start: number;
  end: number;
};

type Transcript = {
  duration: number;
  words: TranscriptWord[];
};

type AuditRow = {
  spanId: string;
  clipId: string;
  output: TimeRange;
  source: TimeRange;
  expected: string;
  actual: string;
  similarity: number;
  kind: "clean" | "watch" | "bad";
  atomIds: number[];
  reason?: string;
};

function parseArgs() {
  const args = process.argv.slice(2);
  let step1Path = "";
  let timingPath = "";
  let transcriptPath = "";
  let outputPath = "";
  let videoPath = "";

  for (let index = 0; index < args.length; index++) {
    switch (args[index]) {
      case "--step1":
        step1Path = args[++index];
        break;
      case "--timing-map":
        timingPath = args[++index];
        break;
      case "--transcript":
        transcriptPath = args[++index];
        break;
      case "--output":
        outputPath = args[++index];
        break;
      case "--video":
        videoPath = args[++index];
        break;
    }
  }

  if (!step1Path || !timingPath || !transcriptPath || !outputPath) {
    throw new Error(
      "Usage: npx tsx scripts/build-step1-audit-report.ts --step1 step1_taken.json --timing-map timing_map.json --transcript result_transcript.json --output audit.html [--video result.mp4]"
    );
  }

  return {
    step1Path: resolve(step1Path),
    timingPath: resolve(timingPath),
    transcriptPath: resolve(transcriptPath),
    outputPath: resolve(outputPath),
    videoPath: videoPath ? resolve(videoPath) : "",
  };
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function normalizeText(text: string): string {
  return text.replace(/[\s\p{P}，。！？、；：“”‘’（）()【】《》…]/gu, "");
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function similarityScore(expected: string, actual: string): number {
  const a = normalizeText(expected);
  const b = normalizeText(actual);
  if (!a && !b) {
    return 1;
  }
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length, 1);
}

function formatTime(sec: number): string {
  const whole = Math.floor(Math.max(0, sec));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  const fraction = Math.round((sec - whole) * 100);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}.${String(fraction).padStart(2, "0")}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function classify(similarity: number): AuditRow["kind"] {
  if (similarity < 0.8) {
    return "bad";
  }
  if (similarity < 0.9) {
    return "watch";
  }
  return "clean";
}

function buildAuditRows(
  step1: Step1Taken,
  timing: TimingMap,
  transcript: Transcript
): AuditRow[] {
  const spans = step1.audio_spans ?? [];
  return spans
    .map((span, index) => {
      const clip = timing.clips[index];
      if (!clip) {
        return null;
      }

      const atoms = step1.atoms.filter(
        (atom) => atom.id >= span.start_id && atom.id <= span.end_id
      );
      const expected = atoms.map((atom) => atom.text).join("");
      const actual = transcript.words
        .filter(
          (word) =>
            word.start < clip.output.end && word.end > clip.output.start
        )
        .map((word) => word.text)
        .join("");
      const similarity = similarityScore(expected, actual);

      return {
        spanId: span.id,
        clipId: clip.id,
        output: clip.output,
        source: clip.source,
        expected,
        actual,
        similarity,
        kind: classify(similarity),
        atomIds: clip.atom_ids,
        reason: span.reason,
      } satisfies AuditRow;
    })
    .filter((row): row is AuditRow => Boolean(row))
    .sort((left, right) => left.output.start - right.output.start);
}

function buildHtml(rows: AuditRow[], videoPath: string): string {
  const counters = rows.reduce(
    (summary, row) => {
      summary.total += 1;
      summary[row.kind] += 1;
      return summary;
    },
    { total: 0, clean: 0, watch: 0, bad: 0 }
  );

  const rowsHtml = rows
    .map((row) => {
      const pct = Math.max(0, Math.min(100, Math.round(row.similarity * 100)));
      const atomIdText = row.atomIds.join(", ");
      return `
        <article class="card ${row.kind}">
          <div class="meta">
            <div>
              <strong>${row.spanId}</strong>
              <span>${row.clipId}</span>
            </div>
            <div>${formatTime(row.output.start)} - ${formatTime(row.output.end)}</div>
          </div>
          <div class="bar">
            <div class="fill ${row.kind}" style="width:${pct}%"></div>
          </div>
          <div class="score">${pct}%</div>
          <div class="block">
            <div class="label">Step1 / take-pass 期望</div>
            <div class="text">${escapeHtml(row.expected)}</div>
          </div>
          <div class="block">
            <div class="label">成片重转录</div>
            <div class="text">${escapeHtml(row.actual)}</div>
          </div>
          <div class="block small">
            <div><span class="label">source</span> ${formatTime(
              row.source.start
            )} - ${formatTime(row.source.end)}</div>
            <div><span class="label">atoms</span> ${escapeHtml(atomIdText)}</div>
          </div>
          ${
            row.reason
              ? `<div class="block small"><span class="label">reason</span> ${escapeHtml(
                  row.reason
                )}</div>`
              : ""
          }
          <button class="jump" data-start="${row.output.start.toFixed(
            2
          )}" data-end="${row.output.end.toFixed(2)}">跳到这段</button>
        </article>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Step1 Audit</title>
  <style>
    :root {
      --bg: #f4efe7;
      --card: #fffdf8;
      --ink: #1d1b18;
      --muted: #6d655c;
      --line: #d8cec0;
      --clean: #4d8b31;
      --watch: #d08b1b;
      --bad: #b54040;
      --accent: #0d5c63;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: linear-gradient(180deg, #efe5d4 0%, var(--bg) 35%, #f8f4ec 100%);
      color: var(--ink);
      font: 14px/1.5 "Microsoft YaHei", "PingFang SC", sans-serif;
    }
    .shell {
      display: grid;
      grid-template-columns: minmax(360px, 520px) 1fr;
      min-height: 100vh;
    }
    .sidebar {
      position: sticky;
      top: 0;
      align-self: start;
      height: 100vh;
      padding: 20px;
      border-right: 1px solid var(--line);
      background: rgba(255,255,255,0.58);
      backdrop-filter: blur(14px);
    }
    .content {
      padding: 20px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
    }
    .summary {
      color: var(--muted);
      margin-bottom: 16px;
    }
    .chips {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .chip {
      border-radius: 999px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.8);
    }
    .chip.clean { color: var(--clean); }
    .chip.watch { color: var(--watch); }
    .chip.bad { color: var(--bad); }
    video {
      width: 100%;
      border-radius: 16px;
      background: #000;
      box-shadow: 0 20px 60px rgba(0,0,0,0.16);
      margin-bottom: 16px;
    }
    .hint {
      color: var(--muted);
      font-size: 13px;
    }
    .grid {
      display: grid;
      gap: 14px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-left: 6px solid var(--line);
      border-radius: 18px;
      padding: 14px 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.05);
    }
    .card.clean { border-left-color: var(--clean); }
    .card.watch { border-left-color: var(--watch); }
    .card.bad { border-left-color: var(--bad); }
    .meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 8px;
    }
    .meta strong {
      color: var(--ink);
      margin-right: 8px;
    }
    .bar {
      height: 8px;
      background: #ece3d6;
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 6px;
    }
    .fill {
      height: 100%;
      border-radius: 999px;
    }
    .fill.clean { background: var(--clean); }
    .fill.watch { background: var(--watch); }
    .fill.bad { background: var(--bad); }
    .score {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 10px;
    }
    .block { margin-bottom: 10px; }
    .block.small {
      color: var(--muted);
      font-size: 12px;
    }
    .label {
      color: var(--accent);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 2px;
    }
    .text {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 15px;
    }
    .jump {
      appearance: none;
      border: none;
      border-radius: 999px;
      background: var(--accent);
      color: white;
      padding: 8px 12px;
      cursor: pointer;
      font: inherit;
    }
    @media (max-width: 980px) {
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
      <h1>Step1 原子审计</h1>
      <div class="summary">把 step1/take-pass 期望文本和成片重转录放在一起看，快速判断问题更像来自 atom 本身，还是来自后续 timing / render。</div>
      <div class="chips">
        <div class="chip">总段数 ${counters.total}</div>
        <div class="chip clean">干净 ${counters.clean}</div>
        <div class="chip watch">可疑 ${counters.watch}</div>
        <div class="chip bad">问题段 ${counters.bad}</div>
      </div>
      ${
        videoPath
          ? `<video id="video" controls preload="metadata" src="${escapeHtml(
              videoPath
            )}"></video>`
          : `<div class="hint">未提供视频路径，所以这里不内嵌播放器。</div>`
      }
      <div class="hint">建议先看红色和黄色卡片。如果成片重转录持续“多出词 / 半句重复 / 词干断裂”，通常更像是 step1 atom 本身切坏了。</div>
    </aside>
    <main class="content">
      <div class="grid">
        ${rowsHtml}
      </div>
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

async function main() {
  const args = parseArgs();
  const step1 = readJsonFile<Step1Taken>(args.step1Path);
  const timing = readJsonFile<TimingMap>(args.timingPath);
  const transcript = readJsonFile<Transcript>(args.transcriptPath);
  const rows = buildAuditRows(step1, timing, transcript);
  mkdirSync(dirname(args.outputPath), { recursive: true });
  writeFileSync(args.outputPath, buildHtml(rows, args.videoPath), "utf-8");
  console.log(`Audit report saved: ${args.outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
