export { renderFinalVideo, type RenderOptions } from "./final-video.js";
import { parseRenderConcurrencyOverride } from "./render-concurrency.js";

async function main() {
  const args = process.argv.slice(2);

  let blueprintPath = "";
  let timingMapPath = "";
  let genericVideoPath = "";
  let cutVideoPath = "";
  let sourceVideoPath = "";
  let outputPath = "";
  let concurrency: number | undefined;

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
      case "--video":
      case "-v":
        genericVideoPath = args[++i];
        break;
      case "--cut-video":
        cutVideoPath = args[++i];
        break;
      case "--source-video":
        sourceVideoPath = args[++i];
        break;
      case "--output":
      case "-o":
        outputPath = args[++i];
        break;
      case "--concurrency":
      case "-c":
        concurrency = parseRenderConcurrencyOverride(args[++i]);
        break;
    }
  }

  if (concurrency === undefined) {
    concurrency = parseRenderConcurrencyOverride(
      process.env.VIDEO_RENDER_CONCURRENCY
    );
  }

  const fallbackMediaPath = genericVideoPath || "";

  if (
    !blueprintPath ||
    !timingMapPath ||
    !outputPath ||
    (!cutVideoPath && !sourceVideoPath && !fallbackMediaPath)
  ) {
    console.error(
      "Usage: npx tsx src/renderer/render.ts -b blueprint.json -t timing_map.json -v video.mp4 -o final.mp4"
    );
    console.error(
      "   or: npx tsx src/renderer/render.ts -b blueprint.json -t timing_map.json --source-video doctor.mp4 -o final.mp4"
    );
    console.error(
      "   or: npx tsx src/renderer/render.ts -b blueprint.json -t timing_map.json --cut-video cut_video.mp4 -o final.mp4"
    );
    console.error("   optional: --concurrency 8  或设置 VIDEO_RENDER_CONCURRENCY=8");
    process.exit(1);
  }

  console.log("Remotion rendering...");
  const { renderFinalVideo } = await import("./final-video.js");
  await renderFinalVideo({
    blueprintPath,
    timingMapPath,
    cutVideoPath: cutVideoPath || fallbackMediaPath || undefined,
    sourceVideoPath: sourceVideoPath || fallbackMediaPath || undefined,
    outputPath,
    concurrency,
  });
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("renderer/render.ts") ||
    process.argv[1].endsWith("renderer\\render.ts"));
if (isMainModule) {
  main().catch((err) => {
    console.error("Error:", err.message ?? err);
    process.exit(1);
  });
}
