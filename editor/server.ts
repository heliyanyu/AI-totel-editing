/**
 * editor/server.ts — Blueprint Editor API 服务器
 *
 * 提供：
 *   GET  /                → 编辑器 HTML（生产）或 302 到 Vite（开发）
 *   GET  /api/blueprint   → 读取 blueprint.json
 *   GET  /api/meta        → 工作区元信息
 *   GET  /api/review-state → 读取 review_state.json（自动补默认值）
 *   GET  /api/step2-diagnostics → 读取 step2_diagnostics.json
 *   PUT  /api/blueprint   → 保存修改后的 blueprint
 *   PUT  /api/review-state → 保存审核状态
 *   POST /api/finalize    → 生成 blueprint_final.json
 *   GET/POST /api/still   → Remotion renderStill JPEG 预览
 *   POST /api/render      → 基于 blueprint_final.json 重建媒体计划并渲染
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  createReadStream,
  copyFileSync,
} from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import type {
  LogicSegment,
  BlueprintScene,
  RenderScene,
  TemplateProps,
  Blueprint,
} from "../src/schemas/blueprint.js";
import type {
  JobManifest,
  PlanningStrategy,
  ReviewState,
  Step2Diagnostics,
  TimingValidationReport,
} from "../src/schemas/workflow.js";
import {
  ensureReviewState,
  summarizeReviewState,
  createEmptyRenderState,
} from "../src/schemas/workflow.js";
import { buildStep2Diagnostics } from "../src/analyze/step2-diagnostics.js";
import { bundleRemotionProject, renderSceneStill } from "../src/renderer/index.js";

const __dirname_e = dirname(fileURLToPath(import.meta.url));
const PORT = 3456;
const VITE_DEV_PORT = 5173;

const jobDir = resolve(process.argv[2] || ".");
if (!existsSync(jobDir)) {
  console.error(`错误: 目录不存在: ${jobDir}`);
  process.exit(1);
}

const blueprintPath = join(jobDir, "blueprint.json");
const blueprintInitialPath = join(jobDir, "blueprint_initial.json");
const blueprintFinalPath = join(jobDir, "blueprint_final.json");
const reviewStatePath = join(jobDir, "review_state.json");
const diagnosticsPath = join(jobDir, "step2_diagnostics.json");
const manifestPath = join(jobDir, "job_manifest.json");
const transcriptPath = join(jobDir, "transcript.json");
const timingMapPath = join(jobDir, "timing_map.json");
const cutVideoPath = join(jobDir, "cut_video.mp4");
const resultVideoPath = join(jobDir, "result.mp4");
const timingValidationPath = join(jobDir, "timing_validation_report.json");

if (!existsSync(blueprintPath)) {
  console.error(`错误: blueprint.json 不存在: ${blueprintPath}`);
  process.exit(1);
}

let stillRenderLock = false;

function warmupBundle(): Promise<string> {
  console.log("📦 Bundling Remotion project...");
  const t0 = Date.now();
  return bundleRemotionProject()
    .then((loc) => {
      console.log(`✅ Bundle ready (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      return loc;
    })
    .catch((err) => {
      console.error("❌ Bundle failed:", err.message);
      throw err;
    });
}

const stillCache = new Map<string, Buffer>();

function clearStillCache() {
  stillCache.clear();
  console.log("🗑️  Still cache cleared");
}

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function writeJsonFile(filePath: string, data: unknown) {
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function readBlueprint(): Blueprint {
  return JSON.parse(readFileSync(blueprintPath, "utf-8")) as Blueprint;
}

function hashText(text: string): string {
  return createHash("md5").update(text).digest("hex");
}

function hashObject(data: unknown): string {
  return hashText(JSON.stringify(data));
}

function ensureInitialBlueprintBackup() {
  if (!existsSync(blueprintInitialPath)) {
    copyFileSync(blueprintPath, blueprintInitialPath);
    console.log(`📋 保存初始版本: ${blueprintInitialPath}`);
  }
}

function readJobManifest(): JobManifest | null {
  return readJsonFile<JobManifest>(manifestPath);
}

function readDiagnostics(): Step2Diagnostics | null {
  const existing = readJsonFile<Step2Diagnostics>(diagnosticsPath);
  if (existing) return existing;

  const generated = buildStep2Diagnostics(readBlueprint());
  writeJsonFile(diagnosticsPath, generated);
  return generated;
}

function readTimingValidation(): TimingValidationReport | null {
  return readJsonFile<TimingValidationReport>(timingValidationPath);
}

function readReviewState(persist = false): ReviewState {
  const blueprint = readBlueprint();
  const raw = readJsonFile<ReviewState>(reviewStatePath);
  const ensured = ensureReviewState(raw, blueprint);
  const blueprintHash = hashObject(blueprint);
  ensured.last_saved_hash = ensured.last_saved_hash ?? blueprintHash;
  ensured.render = ensured.render ?? createEmptyRenderState();

  const currentText = JSON.stringify(raw ?? null);
  const nextText = JSON.stringify(ensured);
  if (persist || currentText !== nextText) {
    writeJsonFile(reviewStatePath, ensured);
  }
  return ensured;
}

function writeReviewState(reviewState: ReviewState) {
  writeJsonFile(reviewStatePath, reviewState);
}

function updateReviewState(mutator: (reviewState: ReviewState) => void): ReviewState {
  const reviewState = readReviewState();
  mutator(reviewState);
  writeReviewState(reviewState);
  return reviewState;
}

function isFinalStale(reviewState: ReviewState): boolean {
  if (!existsSync(blueprintFinalPath)) return false;
  if (!reviewState.finalized_snapshot_hash || !reviewState.last_saved_hash) return true;
  return reviewState.finalized_snapshot_hash !== reviewState.last_saved_hash;
}

function buildMeta() {
  const reviewState = readReviewState();
  const manifest = readJobManifest();
  const diagnostics = readDiagnostics();
  const timingValidation = readTimingValidation();
  const reviewSummary = summarizeReviewState(reviewState);
  const finalStale = isFinalStale(reviewState);
  const renderMode = manifest?.renderMode ?? "cut_video";
  const planningStrategy = manifest?.planningStrategy ?? (renderMode === "source_direct" ? "media_range_v2" : "legacy_time");
  const sourceVideoPath = manifest?.sourceVideoPath ?? null;
  const sourceVideoReady = Boolean(sourceVideoPath && existsSync(sourceVideoPath));

  return {
    jobDir,
    jobName: basename(jobDir) || jobDir,
    hasTimingMap: existsSync(timingMapPath),
    hasTranscript: existsSync(transcriptPath),
    hasCutVideo: existsSync(cutVideoPath),
    hasResultVideo: existsSync(resultVideoPath),
    hasReviewState: existsSync(reviewStatePath),
    hasStep2Diagnostics: Boolean(diagnostics),
    hasBlueprintFinal: existsSync(blueprintFinalPath),
    hasJobManifest: Boolean(manifest),
    hasTimingValidationReport: Boolean(timingValidation),
    renderMode,
    planningStrategy,
    sourceVideoReady,
    timingValidationErrors: timingValidation?.summary.error_count ?? 0,
    timingValidationWarnings: timingValidation?.summary.warn_count ?? 0,
    isTimingHealthy: (timingValidation?.summary.error_count ?? 0) === 0,
    isFinalStale: finalStale,
    isRenderable:
      existsSync(blueprintFinalPath) &&
      !finalStale &&
      sourceVideoReady &&
      reviewState.render.status !== "rendering",
    sourceVideoPath,
    sourceScriptPath: manifest?.sourceScriptPath ?? null,
    jobStatus: reviewState.job_status,
    renderStatus: reviewState.render.status,
    reviewSummary,
    media: {
      sourceVideoUrl: sourceVideoReady ? "/media/source-video" : null,
      cutVideoUrl: existsSync(cutVideoPath) ? "/media/cut-video" : null,
      resultVideoUrl: existsSync(resultVideoPath) ? "/media/result-video" : null,
    },
  };
}

function json(res: ServerResponse, data: unknown, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

function getContentType(filePath: string): string {
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function serveStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  contentType: string
) {
  if (!existsSync(filePath)) {
    json(res, { error: `File not found: ${filePath}` }, 404);
    return;
  }

  const stat = statSync(filePath);
  const rangeHeader = req.headers.range;

  if (!rangeHeader) {
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
    });
    createReadStream(filePath).pipe(res);
    return;
  }

  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  if (!match) {
    res.writeHead(416, {
      "Content-Range": `bytes */${stat.size}`,
      "Access-Control-Allow-Origin": "*",
    });
    res.end();
    return;
  }

  const start = Number.parseInt(match[1], 10);
  const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;

  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 0 ||
    end >= stat.size ||
    start > end
  ) {
    res.writeHead(416, {
      "Content-Range": `bytes */${stat.size}`,
      "Access-Control-Allow-Origin": "*",
    });
    res.end();
    return;
  }

  res.writeHead(206, {
    "Content-Type": contentType,
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
  });
  createReadStream(filePath, { start, end }).pipe(res);
}

function segmentHash(segment: LogicSegment, parentTitle: string): string {
  const h = createHash("md5");
  h.update(
    JSON.stringify({
      template: segment.template,
      title: parentTitle,
      items: segment.items,
      template_props: segment.template_props,
    })
  );
  return h.digest("hex");
}

function createSegmentPreview(
  segment: LogicSegment,
  parentScene: BlueprintScene
): RenderScene {
  const LEAD_MS = 600;
  const STAGGER_MS = 300;
  const DWELL_MS = 2000;
  const EXIT_MS = 300;

  const items = (segment.items || []).map((it: any, i: number) => ({
    text: it.text || "",
    emoji: it.emoji,
    anchor_offset_ms: LEAD_MS + i * STAGGER_MS,
  }));

  const itemCount = items.length || 1;
  const lastAnchor = LEAD_MS + (itemCount - 1) * STAGGER_MS;
  const dwellEnd = lastAnchor + DWELL_MS;
  const exitEnd = dwellEnd + EXIT_MS;

  return {
    id: segment.id,
    topic_id: parentScene.id,
    variant_id: segment.template,
    title: parentScene.title,
    timeline: {
      enter_ms: 0,
      first_anchor_ms: LEAD_MS,
      dwell_end_ms: dwellEnd,
      exit_end_ms: exitEnd,
    },
    items,
    template_props: (segment.template_props ?? {}) as TemplateProps,
  };
}

function findSegmentInBlueprint(
  blueprint: Blueprint,
  segmentId: string
): { segment: LogicSegment; parentScene: BlueprintScene } | null {
  for (const scene of blueprint.scenes) {
    for (const seg of scene.logic_segments) {
      if (seg.id === segmentId) {
        return { segment: seg, parentScene: scene };
      }
    }
  }
  return null;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    if (url === "/" && method === "GET") {
      const distIndex = join(__dirname_e, "dist", "index.html");
      if (existsSync(distIndex)) {
        const html = readFileSync(distIndex, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      } else {
        res.writeHead(302, { Location: `http://localhost:${VITE_DEV_PORT}` });
        res.end();
      }
      return;
    }

    if (url.startsWith("/assets/") && method === "GET") {
      const assetPath = join(__dirname_e, "dist", url.replace(/^\//, ""));
      serveStaticFile(req, res, assetPath, getContentType(assetPath));
      return;
    }

    if (url === "/api/blueprint" && method === "GET") {
      json(res, readBlueprint());
      return;
    }

    if (url === "/api/meta" && method === "GET") {
      json(res, buildMeta());
      return;
    }

    if (url === "/api/review-state" && method === "GET") {
      json(res, readReviewState(true));
      return;
    }

    if (url === "/api/step2-diagnostics" && method === "GET") {
      const diagnostics = readDiagnostics();
      if (!diagnostics) {
        json(res, { error: "step2_diagnostics.json not found" }, 404);
        return;
      }
      json(res, diagnostics);
      return;
    }

    if (url === "/api/timing-map" && method === "GET") {
      const timingMap = readJsonFile(timingMapPath);
      if (!timingMap) {
        json(res, { error: "timing_map.json not found" }, 404);
        return;
      }
      json(res, timingMap);
      return;
    }

    if (url === "/api/timing-validation" && method === "GET") {
      const report = readTimingValidation();
      if (!report) {
        json(res, { error: "timing_validation_report.json not found" }, 404);
        return;
      }
      json(res, report);
      return;
    }

    if (url === "/api/transcript" && method === "GET") {
      const transcript = readJsonFile(transcriptPath);
      if (!transcript) {
        json(res, { error: "transcript.json not found" }, 404);
        return;
      }
      json(res, transcript);
      return;
    }

    if (url === "/media/source-video" && method === "GET") {
      const manifest = readJobManifest();
      if (!manifest?.sourceVideoPath || !existsSync(manifest.sourceVideoPath)) {
        json(res, { error: "source video not found" }, 404);
        return;
      }
      serveStaticFile(req, res, manifest.sourceVideoPath, "video/mp4");
      return;
    }

    if (url === "/media/cut-video" && method === "GET") {
      serveStaticFile(req, res, cutVideoPath, "video/mp4");
      return;
    }

    if (url === "/media/result-video" && method === "GET") {
      serveStaticFile(req, res, resultVideoPath, "video/mp4");
      return;
    }

    if (url === "/api/blueprint" && method === "PUT") {
      const body = await readBody(req);
      const newBp = JSON.parse(body);
      ensureInitialBlueprintBackup();
      writeJsonFile(blueprintPath, newBp);

      updateReviewState((reviewState) => {
        const nextHash = hashObject(newBp);
        reviewState.last_saved_hash = nextHash;
        if (reviewState.finalized_snapshot_hash && reviewState.finalized_snapshot_hash !== nextHash) {
          reviewState.job_status = "in_review";
          reviewState.finalized_at = null;
        }
      });

      clearStillCache();
      console.log("💾 Blueprint 已保存");
      json(res, { ok: true, meta: buildMeta() });
      return;
    }

    if (url === "/api/review-state" && method === "PUT") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const next = ensureReviewState(payload, readBlueprint());
      writeReviewState(next);
      json(res, { ok: true, reviewState: next, meta: buildMeta() });
      return;
    }

    if (url === "/api/finalize" && method === "POST") {
      ensureInitialBlueprintBackup();
      const blueprintText = readFileSync(blueprintPath, "utf-8");
      writeFileSync(blueprintFinalPath, blueprintText, "utf-8");
      const snapshotHash = hashText(blueprintText);
      const finalizedAt = new Date().toISOString();

      const reviewState = updateReviewState((review) => {
        review.job_status = "finalized";
        review.finalized_at = finalizedAt;
        review.finalized_snapshot_hash = snapshotHash;
        review.last_saved_hash = snapshotHash;
      });

      console.log(`✅ 定稿完成: ${blueprintFinalPath}`);
      json(res, { ok: true, reviewState, meta: buildMeta() });
      return;
    }

    if (url.startsWith("/api/still") && (method === "GET" || method === "POST")) {
      let segment: LogicSegment;
      let parentScene: BlueprintScene;
      let segmentId = "";

      if (method === "POST") {
        const body = await readBody(req);
        const payload = JSON.parse(body || "{}");
        if (!payload?.segment || !payload?.parentScene) {
          json(res, { error: "Missing segment or parentScene payload" }, 400);
          return;
        }
        segment = payload.segment as LogicSegment;
        parentScene = payload.parentScene as BlueprintScene;
        segmentId = segment.id;
      } else {
        const urlObj = new URL(url, "http://localhost");
        segmentId = urlObj.searchParams.get("segment") || "";
        if (!segmentId) {
          json(res, { error: "Missing segment parameter" }, 400);
          return;
        }
        const found = findSegmentInBlueprint(readBlueprint(), segmentId);
        if (!found) {
          json(res, { error: `Segment not found: ${segmentId}` }, 404);
          return;
        }
        segment = found.segment;
        parentScene = found.parentScene;
      }

      const hash = segmentHash(segment, parentScene.title);
      const cached = stillCache.get(hash);
      if (cached) {
        res.writeHead(200, {
          "Content-Type": "image/jpeg",
          "Cache-Control": "no-cache",
          "X-Still-Cache": "hit",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(cached);
        return;
      }

      if (stillRenderLock) {
        json(res, { status: "rendering", message: "渲染中，请稍候" }, 202);
        return;
      }

      try {
        stillRenderLock = true;
        const t0 = Date.now();
        const loc = await warmupBundle();
        const previewScene = createSegmentPreview(segment, parentScene);

        const tmpDir = join(jobDir, ".stills");
        mkdirSync(tmpDir, { recursive: true });
        const tmpFile = join(tmpDir, `still_${segmentId}.jpeg`);

        await renderSceneStill({
          scene: previewScene,
          outputPath: tmpFile,
          bundleLocation: loc,
          jpegQuality: 85,
        });

        const buf = readFileSync(tmpFile);
        stillCache.set(hash, buf);
        const ms = Date.now() - t0;
        console.log(`🖼️  Still ${segmentId} rendered (${ms}ms, ${(buf.length / 1024).toFixed(0)}KB)`);

        res.writeHead(200, {
          "Content-Type": "image/jpeg",
          "Cache-Control": "no-cache",
          "X-Still-Cache": "miss",
          "X-Render-Ms": String(ms),
          "Access-Control-Allow-Origin": "*",
        });
        res.end(buf);
      } catch (err: any) {
        console.error("Still render error:", err.message);
        json(res, { error: err.message }, 500);
      } finally {
        stillRenderLock = false;
      }
      return;
    }

    if (url === "/api/render" && method === "POST") {
      const manifest = readJobManifest();
      const reviewState = readReviewState();
      const meta = buildMeta();

      if (!existsSync(blueprintFinalPath)) {
        json(res, { error: "请先定稿，生成 blueprint_final.json 后再渲染。" }, 409);
        return;
      }
      if (meta.isFinalStale) {
        json(res, { error: "当前 working blueprint 与定稿版本不一致，请重新定稿后再渲染。" }, 409);
        return;
      }
      if (!manifest?.sourceVideoPath) {
        json(res, { error: "缺少 job_manifest.json 或原始视频路径，无法重建媒体计划。" }, 409);
        return;
      }
      if (!existsSync(manifest.sourceVideoPath)) {
        json(res, { error: `原始视频不存在: ${manifest.sourceVideoPath}` }, 409);
        return;
      }
      if (reviewState.render.status === "rendering") {
        json(res, { error: "已有渲染任务在进行中。" }, 409);
        return;
      }

      updateReviewState((review) => {
        review.render = {
          status: "rendering",
          output_path: resultVideoPath,
          started_at: new Date().toISOString(),
          finished_at: null,
          error: null,
        };
      });

      json(res, { status: "rendering", message: "开始生成媒体计划并渲染最终版..." });

      (async () => {
        try {
          console.log("\n🎬 开始完整渲染...");
          const { cutVideo } = await import("../src/cut/index.js");
          const { buildDirectTimingMap } = await import("../src/timing/build-direct-timing-map.js");
          const { renderFinalVideo } = await import("../src/renderer/render.js");

          const blueprint = JSON.parse(readFileSync(blueprintFinalPath, "utf-8"));
          const transcript =
            manifest.transcriptPath && existsSync(manifest.transcriptPath)
              ? JSON.parse(readFileSync(manifest.transcriptPath, "utf-8"))
              : undefined;
          const renderMode = manifest.renderMode ?? "cut_video";
          const planningStrategy: PlanningStrategy = manifest.planningStrategy ?? (renderMode === "source_direct" ? "media_range_v2" : "legacy_time");

          if (renderMode === "source_direct") {
            console.log(`  Step 1: 生成 source_direct timing_map (${manifest.sourceVideoPath}) ...`);
            await buildDirectTimingMap(
              manifest.sourceVideoPath,
              blueprint,
              jobDir,
              planningStrategy,
              transcript
            );
            if (planningStrategy === "occurrence_reanchor_v1") {
              writeFileSync(
                blueprintFinalPath,
                JSON.stringify(blueprint, null, 2),
                "utf-8"
              );
            }
          } else {
            console.log(`  Step 1: 重新切割 (${manifest.sourceVideoPath}) ...`);
            await cutVideo(
              manifest.sourceVideoPath,
              blueprint,
              jobDir,
              planningStrategy,
              transcript
            );
          }

          console.log("  Step 2: 渲染视频...");
          await renderFinalVideo({
            blueprintPath: blueprintFinalPath,
            timingMapPath,
            cutVideoPath: renderMode === "cut_video" ? cutVideoPath : undefined,
            sourceVideoPath:
              renderMode === "source_direct" ? manifest.sourceVideoPath : undefined,
            outputPath: resultVideoPath,
          });

          updateReviewState((review) => {
            review.render = {
              status: "done",
              output_path: resultVideoPath,
              started_at: review.render.started_at,
              finished_at: new Date().toISOString(),
              error: null,
            };
          });
          console.log(`✅ 渲染完成: ${resultVideoPath}`);
        } catch (err: any) {
          updateReviewState((review) => {
            review.render = {
              status: "error",
              output_path: resultVideoPath,
              started_at: review.render.started_at,
              finished_at: new Date().toISOString(),
              error: err.message ?? String(err),
            };
          });
          console.error("❌ 渲染失败:", err.message);
        }
      })();
      return;
    }

    res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
    res.end("Not Found");
  } catch (err: any) {
    console.error("Server error:", err);
    json(res, { error: err.message }, 500);
  }
}

const server = createServer(handleRequest);
server.listen(PORT, () => {
  const distIndex = join(__dirname_e, "dist", "index.html");
  const hasDist = existsSync(distIndex);

  console.log("\n🎬 Blueprint Editor");
  console.log(`   工作区: ${jobDir}`);
  console.log(`   Blueprint: ${blueprintPath}`);
  console.log(`   API: http://localhost:${PORT}`);
  console.log(`   页面: http://localhost:${PORT}` + (hasDist ? " (内置静态页面)" : " (将跳转到 Vite dev)"));
  console.log(`   Vite: http://localhost:${VITE_DEV_PORT} (仅在手动启动前端后可用)`);
  console.log("");

  warmupBundle().catch(() => {});
});








