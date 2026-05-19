import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

import type { GenericVUClipProps } from "../remotion/demos/GenericVUClip";
import type { TimelineVUClipProps } from "../remotion/demos/TimelineVUClip";
import { VUPlanSchema, VURenderJobSchema, type VUPlan, type VURenderJob } from "./schema";

interface CliArgs {
  jobsPath: string;
  plansPath: string;
  outputDir: string;
  entryPoint: string;
  fps: number;
  concurrency: number | string | null;
  renderSkipLlm: boolean;
  vu?: string;
  limit?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    jobsPath: "",
    plansPath: "",
    outputDir: "",
    entryPoint: "src/remotion/index.ts",
    fps: 30,
    concurrency: "50%",
    renderSkipLlm: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--jobs") args.jobsPath = argv[++i];
    else if (arg === "--plans") args.plansPath = argv[++i];
    else if (arg === "--output-dir") args.outputDir = argv[++i];
    else if (arg === "--entry") args.entryPoint = argv[++i];
    else if (arg === "--fps") args.fps = Number(argv[++i]);
    else if (arg === "--concurrency") {
      const value = argv[++i];
      args.concurrency = /^\d+$/.test(value) ? Number(value) : value;
    }
    else if (arg === "--render-skip-llm") args.renderSkipLlm = true;
    else if (arg === "--vu") args.vu = argv[++i];
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.jobsPath || !args.outputDir) {
    throw new Error(
      "Usage: npx tsx src/vu/render-overlays.ts --jobs vu_render_jobs.json [--plans vu_plans.json] --output-dir vu_overlays"
    );
  }
  return args;
}

function safeName(text: string) {
  return text.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 48);
}

function loadJobs(path: string): VURenderJob[] {
  const raw = JSON.parse(readFileSync(resolve(path), "utf-8"));
  const jobs: unknown[] = Array.isArray(raw.jobs) ? raw.jobs : [];
  return jobs.map((job) => VURenderJobSchema.parse(job));
}

function loadPlans(path?: string): Map<string, VUPlan> {
  const plans = new Map<string, VUPlan>();
  if (!path) return plans;
  const resolved = resolve(path);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolved, "utf-8"));
  } catch {
    return plans;
  }
  const results = Array.isArray((raw as { results?: unknown[] }).results)
    ? (raw as { results: unknown[] }).results
    : [];
  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const item = result as { ok?: boolean; plan?: unknown; vu_id?: string };
    if (!item.ok || !item.plan) continue;
    const parsed = VUPlanSchema.safeParse(item.plan);
    if (parsed.success) plans.set(parsed.data.vu_id, parsed.data);
  }
  return plans;
}

function shouldRender(job: VURenderJob, renderSkipLlm: boolean): boolean {
  if (job.llm_policy === "skip_llm" && !renderSkipLlm) return false;
  return true;
}

async function main() {
  const args = parseArgs(process.argv);
  const jobs = loadJobs(args.jobsPath);
  const plans = loadPlans(args.plansPath);
  const outputDir = resolve(args.outputDir);
  mkdirSync(outputDir, { recursive: true });

  let renderable = jobs.filter((job) => shouldRender(job, args.renderSkipLlm));
  if (args.vu) renderable = renderable.filter((job) => job.vu_id === args.vu);
  if (args.limit !== undefined) renderable = renderable.slice(0, args.limit);
  console.log(`Rendering ${renderable.length}/${jobs.length} VU overlay clips`);

  const serveUrl = await bundle({
    entryPoint: resolve(args.entryPoint),
    webpackOverride: (config) => config,
  });

  let rendered = 0;
  let dslRendered = 0;
  let skipped = jobs.length - renderable.length;
  for (const [index, job] of renderable.entries()) {
    const durationFrames = Math.max(24, Math.round(job.source_vu.duration * args.fps));
    const plan = plans.get(job.vu_id) ?? null;
    const useDsl = plan?.dsl != null;
    const compositionId = useDsl ? "TimelineVUClip" : "GenericVUClip";

    const inputProps: GenericVUClipProps | TimelineVUClipProps = useDsl
      ? ({ dsl: plan!.dsl!, durationFrames } as TimelineVUClipProps)
      : ({ job, plan, durationFrames } as GenericVUClipProps);

    const composition = await selectComposition({
      serveUrl,
      id: compositionId,
      inputProps: inputProps as unknown as Record<string, unknown>,
      logLevel: "warn",
    });
    const output = resolve(
      outputDir,
      `${String(index + 1).padStart(2, "0")}_${job.vu_id}_${safeName(job.presentation_family)}.mp4`
    );
    console.log(
      `[${index + 1}/${renderable.length}] ${job.vu_id} (${useDsl ? "DSL" : "legacy"}) -> ${output}`
    );
    await renderMedia({
      serveUrl,
      composition: {
        ...composition,
        durationInFrames: durationFrames,
        fps: args.fps,
        width: 1080,
        height: 1920,
      },
      inputProps: inputProps as unknown as Record<string, unknown>,
      codec: "h264",
      outputLocation: output,
      overwrite: true,
      muted: true,
      concurrency: args.concurrency,
      logLevel: "warn",
    });
    rendered++;
    if (useDsl) dslRendered++;
  }

  console.log(JSON.stringify({ rendered, dslRendered, skipped, outputDir }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
