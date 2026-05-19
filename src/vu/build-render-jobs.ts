import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { buildRenderJob } from "./router";
import { VisualUnitFileSchema, VURenderJobSchema } from "./schema";

interface CliArgs {
  input: string;
  output: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    input: "local_artifacts/mianyili_03.visual_units.state_v4.manual.json",
    output: "local_artifacts/vu_pipeline/mianyili_03.vu_render_jobs.json",
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") {
      args.input = argv[++i];
    } else if (arg === "--output") {
      args.output = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const inputPath = resolve(args.input);
  const outputPath = resolve(args.output);
  const raw = JSON.parse(readFileSync(inputPath, "utf-8"));
  const parsed = VisualUnitFileSchema.parse(raw);
  const jobs = parsed.visual_units.map(buildRenderJob).map((job) => VURenderJobSchema.parse(job));

  const summary = jobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.llm_policy] = (acc[job.llm_policy] ?? 0) + 1;
    return acc;
  }, {});

  const output = {
    source: parsed.source ?? {},
    generated_at: new Date().toISOString(),
    summary: {
      total: jobs.length,
      ...summary,
      deepseek_calls_required: summary.deepseek_plan ?? 0,
    },
    jobs,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");

  console.log(`Wrote ${jobs.length} VU render jobs: ${outputPath}`);
  console.log(JSON.stringify(output.summary, null, 2));
}

main();

