import { readFileSync } from "fs";
import { renderStill, selectComposition } from "@remotion/renderer";
import type { RenderScene } from "../schemas/blueprint.js";
import { VIDEO_FPS } from "../remotion/utils.js";
import { bundleRemotionProject } from "./bundle.js";

export interface RenderSceneStillOptions {
  scene: RenderScene;
  outputPath: string;
  bundleLocation?: string;
  frame?: number;
  jpegQuality?: number;
}

export function getSegmentPreviewFrame(scene: RenderScene): number {
  const dwellMs = scene.timeline.dwell_end_ms - 500;
  return Math.max(0, Math.round((dwellMs / 1000) * VIDEO_FPS));
}

export async function renderSceneStill(
  options: RenderSceneStillOptions
): Promise<{ outputPath: string; bundleLocation: string; frame: number; bytes: number }> {
  const bundleLocation = options.bundleLocation ?? (await bundleRemotionProject());
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "SegmentPreview",
    inputProps: { scene: options.scene },
  });

  const requestedFrame = options.frame ?? getSegmentPreviewFrame(options.scene);
  const frame = Math.min(
    Math.max(0, requestedFrame),
    composition.durationInFrames - 1
  );

  await renderStill({
    composition,
    serveUrl: bundleLocation,
    inputProps: { scene: options.scene },
    frame,
    output: options.outputPath,
    imageFormat: "jpeg",
    jpegQuality: options.jpegQuality ?? 85,
  });

  const bytes = readFileSync(options.outputPath).length;
  return {
    outputPath: options.outputPath,
    bundleLocation,
    frame,
    bytes,
  };
}
