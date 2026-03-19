import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import type { Transcript } from "../schemas/blueprint.js";
import {
  applyTranscriptReview,
  normalizeTranscriptReview,
  type TranscriptReview,
  type TranscriptReviewDecision,
  type TranscriptReviewSummary,
} from "./review/index.js";

interface StoredTranscriptReviewReport {
  rawModelEdits?: TranscriptReview["edits"];
  acceptedEdits?: TranscriptReviewDecision[];
  rejectedEdits?: TranscriptReviewDecision[];
  summary?: Partial<TranscriptReviewSummary>;
}

interface ReplayCaseSummary {
  name: string;
  jobDir: string;
  accepted: number;
  rejected: number;
  replace: number;
  delete: number;
  dedupe: number;
  deltaAccepted: number;
  deltaRejected: number;
  newlyAccepted: string[];
  newlyRejected: string[];
}

function findFiles(root: string, targetName: string): string[] {
  const results: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === targetName) {
        results.push(full);
      }
    }
  }

  walk(root);
  return results;
}

function editKey(edit: { op: string; find: string; replace?: string }): string {
  return `${edit.op} | ${edit.find} | ${edit.replace ?? ""}`;
}

function toCountByOp(edits: TranscriptReviewDecision[]) {
  return {
    replace: edits.filter((edit) => edit.op === "replace_span" && edit.status === "accepted").length,
    delete: edits.filter((edit) => edit.op === "delete_span" && edit.status === "accepted").length,
    dedupe: edits.filter((edit) => edit.op === "dedupe_span" && edit.status === "accepted").length,
  };
}

function buildMarkdown(root: string, cases: ReplayCaseSummary[]): string {
  const lines: string[] = [];
  lines.push("# Transcript Review Replay Report");
  lines.push("");
  lines.push(`root: ${root}`);
  lines.push(`cases: ${cases.length}`);
  lines.push("");

  for (const item of cases) {
    lines.push(`## ${item.name}`);
    lines.push("");
    lines.push(`- job: ${item.jobDir}`);
    lines.push(`- accepted: ${item.accepted} (replace ${item.replace} / delete ${item.delete} / dedupe ${item.dedupe})`);
    lines.push(`- rejected: ${item.rejected}`);
    lines.push(`- delta accepted vs stored: ${item.deltaAccepted >= 0 ? "+" : ""}${item.deltaAccepted}`);
    lines.push(`- delta rejected vs stored: ${item.deltaRejected >= 0 ? "+" : ""}${item.deltaRejected}`);

    if (item.newlyAccepted.length > 0) {
      lines.push("- newly accepted:");
      for (const entry of item.newlyAccepted) {
        lines.push(`  - ${entry}`);
      }
    }

    if (item.newlyRejected.length > 0) {
      lines.push("- newly rejected:");
      for (const entry of item.newlyRejected) {
        lines.push(`  - ${entry}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  let rootDir = "output";
  let outputPath = "";
  let filter = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--root":
      case "-r":
        rootDir = args[++i];
        break;
      case "--output":
      case "-o":
        outputPath = args[++i];
        break;
      case "--filter":
      case "-f":
        filter = args[++i];
        break;
    }
  }

  const resolvedRoot = resolve(rootDir);
  const reviewPaths = findFiles(resolvedRoot, "transcript_review.json").filter((file) =>
    filter ? file.toLowerCase().includes(filter.toLowerCase()) : true
  );

  if (reviewPaths.length === 0) {
    console.error("No transcript_review.json files found.");
    process.exit(1);
  }

  const summaries: ReplayCaseSummary[] = [];

  for (const reviewPath of reviewPaths) {
    const jobDir = dirname(reviewPath);
    const transcriptPath = join(jobDir, "transcript.json");
    if (!existsSync(transcriptPath)) {
      continue;
    }

    const stored = JSON.parse(readFileSync(reviewPath, "utf-8")) as StoredTranscriptReviewReport;
    const transcript = JSON.parse(readFileSync(transcriptPath, "utf-8")) as Transcript;
    const review: TranscriptReview = normalizeTranscriptReview({ edits: stored.rawModelEdits ?? [] });
    const replayed = applyTranscriptReview(transcript, review);

    const storedAccepted = stored.acceptedEdits ?? [];
    const storedRejected = stored.rejectedEdits ?? [];
    const currentAccepted = replayed.report.acceptedEdits;
    const currentRejected = replayed.report.rejectedEdits;

    const storedAcceptedKeys = new Set(storedAccepted.map(editKey));
    const storedRejectedKeys = new Set(storedRejected.map(editKey));
    const currentAcceptedKeys = new Set(currentAccepted.map(editKey));
    const currentRejectedKeys = new Set(currentRejected.map(editKey));

    const currentCounts = toCountByOp(currentAccepted);

    summaries.push({
      name: relative(resolvedRoot, jobDir) || jobDir,
      jobDir,
      accepted: currentAccepted.length,
      rejected: currentRejected.length,
      replace: currentCounts.replace,
      delete: currentCounts.delete,
      dedupe: currentCounts.dedupe,
      deltaAccepted: currentAccepted.length - storedAccepted.length,
      deltaRejected: currentRejected.length - storedRejected.length,
      newlyAccepted: currentAccepted
        .filter((edit) => !storedAcceptedKeys.has(editKey(edit)))
        .map(editKey),
      newlyRejected: currentRejected
        .filter((edit) => !storedRejectedKeys.has(editKey(edit)) && !currentAcceptedKeys.has(editKey(edit)))
        .map(editKey),
    });
  }

  summaries.sort((a, b) => a.name.localeCompare(b.name, "en"));

  const markdown = buildMarkdown(resolvedRoot, summaries);
  const resolvedOutput = outputPath
    ? resolve(outputPath)
    : resolve(resolvedRoot, "transcript_review_replay_report.md");

  mkdirSync(dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, markdown, "utf-8");

  console.log(`review replay report saved: ${resolvedOutput}`);
  console.log(`cases: ${summaries.length}`);
  console.log(
    `accepted total: ${summaries.reduce((sum, item) => sum + item.accepted, 0)}, rejected total: ${summaries.reduce((sum, item) => sum + item.rejected, 0)}`
  );
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("analyze/replay-transcript-review.ts") ||
    process.argv[1].endsWith("analyze\\replay-transcript-review.ts"));

if (isMainModule) {
  main().catch((err) => {
    console.error("错误:", err.message ?? err);
    process.exit(1);
  });
}

