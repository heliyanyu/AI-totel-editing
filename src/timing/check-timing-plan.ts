import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import type { Blueprint, TimingMap } from "../schemas/blueprint.js";
import {
  validateTimingPlan,
  hasBlockingTimingIssues,
  formatTimingValidationFailures,
  writeTimingValidationReport,
} from "./validate-timing-map.js";

async function main() {
  const args = process.argv.slice(2);
  let blueprintPath = "";
  let timingMapPath = "";
  let outputDir = "";

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
      case "--output-dir":
      case "-o":
        outputDir = args[++i];
        break;
    }
  }

  if (!blueprintPath || !timingMapPath) {
    console.error(
      "用法: npx tsx src/timing/check-timing-plan.ts --blueprint blueprint.json --timing-map timing_map.json [-o outputDir]"
    );
    process.exit(1);
  }

  const resolvedBlueprintPath = resolve(blueprintPath);
  const resolvedTimingMapPath = resolve(timingMapPath);
  const resolvedOutputDir = outputDir ? resolve(outputDir) : dirname(resolvedTimingMapPath);

  const blueprint: Blueprint = JSON.parse(readFileSync(resolvedBlueprintPath, "utf-8"));
  const timingMap: TimingMap = JSON.parse(readFileSync(resolvedTimingMapPath, "utf-8"));

  const report = validateTimingPlan(blueprint, timingMap);
  const reportPath = writeTimingValidationReport(resolvedOutputDir, report);

  console.log(`timing 校验报告已保存: ${reportPath}`);
  console.log(`mode: ${report.summary.mode}`);
  console.log(`errors: ${report.summary.error_count}`);
  console.log(`warnings: ${report.summary.warn_count}`);

  if (hasBlockingTimingIssues(report)) {
    console.error(formatTimingValidationFailures(report));
    process.exit(1);
  }
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("timing/check-timing-plan.ts") ||
    process.argv[1].endsWith("timing\\check-timing-plan.ts"));
if (isMainModule) {
  main().catch((err) => {
    console.error("错误:", err.message ?? err);
    process.exit(1);
  });
}
