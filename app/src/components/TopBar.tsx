import React from "react";
import { useEditorStore, useStats } from "../store/blueprint-store";

function formatTime(sec: number | null): string {
  if (sec === null || Number.isNaN(sec)) return "--:--";
  const whole = Math.max(0, Math.floor(sec));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const TopBar: React.FC = () => {
  const blueprint = useEditorStore((s) => s.blueprint);
  const meta = useEditorStore((s) => s.meta);
  const reviewState = useEditorStore((s) => s.reviewState);
  const isDirty = useEditorStore((s) => s.isDirty);
  const saveStatus = useEditorStore((s) => s.saveStatus);
  const finalizeStatus = useEditorStore((s) => s.finalizeStatus);
  const renderStatus = useEditorStore((s) => s.renderStatus);
  const saveBlueprint = useEditorStore((s) => s.saveBlueprint);
  const finalizeBlueprint = useEditorStore((s) => s.finalizeBlueprint);
  const triggerRender = useEditorStore((s) => s.triggerRender);
  const stats = useStats();

  const reviewSummary = stats?.reviewSummary ?? meta?.reviewSummary;

  const statusText = () => {
    if (saveStatus === "saving") return "保存中...";
    if (saveStatus === "saved") return "已保存 ✓";
    if (saveStatus === "error") return "保存失败";
    if (finalizeStatus === "finalizing") return "定稿中...";
    if (finalizeStatus === "done") return "已更新定稿 ✓";
    if (finalizeStatus === "error") return "定稿失败";
    if (renderStatus === "rendering") return "渲染中...";
    if (renderStatus === "done") return "渲染完成 ✓";
    if (renderStatus === "error") return "渲染失败";
    if (meta?.isFinalStale) return "定稿已过期，需重新确认";
    return "";
  };

  return (
    <div className="topbar">
      <div>
        <div className="topbar-title">{meta?.jobName || "Blueprint Editor"}</div>
        <div className="topbar-subtitle">{blueprint?.title || "中间预览与人工调试"}</div>
      </div>

      {stats && (
        <div className="topbar-stats">
          {stats.sceneCount} 场景 · {stats.segmentCount} 段 · {stats.keepCount} keep / {stats.keepCount + stats.discardCount} total · 成片 {formatTime(stats.outputDuration)}
        </div>
      )}

      {reviewSummary && (
        <div className="topbar-review-summary">
          <span>待看 {reviewSummary.todo}</span>
          <span>待改 {reviewSummary.needs_edit}</span>
          <span>已确认 {reviewSummary.accepted + reviewSummary.accepted_after_edit}</span>
        </div>
      )}

      <div className="topbar-spacer" />

      <div className="topbar-flags">
        <span className={`topbar-flag ${meta?.renderMode === "source_direct" ? "ok" : "warn"}`}>
          {meta?.renderMode ?? "cut_video"}
        </span>
        <span className={`topbar-flag ${meta?.planningStrategy === "media_range_v2" ? "ok" : "warn"}`}>
          {meta?.planningStrategy ?? "legacy_time"}
        </span>
        <span className={`topbar-flag ${meta?.sourceVideoReady ? "ok" : "warn"}`}>source_video</span>
        <span className={`topbar-flag ${meta?.hasCutVideo ? "ok" : "warn"}`}>cut_video</span>
        <span className={`topbar-flag ${meta?.hasTranscript ? "ok" : "warn"}`}>transcript</span>
        <span className={`topbar-flag ${meta?.hasTimingMap ? "ok" : "warn"}`}>timing_map</span>
        <span className={`topbar-flag ${meta?.hasTimingValidationReport ? (meta?.isTimingHealthy ? "ok" : "warn") : "warn"}`}>
          timing_check{meta?.timingValidationWarnings ? `:${meta.timingValidationWarnings}` : ""}
        </span>
        <span className={`topbar-flag ${meta?.hasStep2Diagnostics ? "ok" : "warn"}`}>step2_diag</span>
        <span className={`topbar-flag ${meta?.hasJobManifest ? "ok" : "warn"}`}>manifest</span>
        <span className={`topbar-flag ${meta?.hasBlueprintFinal && !meta?.isFinalStale ? "ok" : "warn"}`}>final</span>
      </div>

      <span className="topbar-status">{statusText()}</span>

      <button
        className={`topbar-btn save ${isDirty ? "dirty" : ""}`}
        onClick={saveBlueprint}
        title="Ctrl+S"
      >
        {isDirty ? "保存 *" : "保存"}
      </button>

      <button
        className="topbar-btn finalize"
        onClick={finalizeBlueprint}
        disabled={finalizeStatus === "finalizing" || saveStatus === "saving"}
      >
        {meta?.hasBlueprintFinal && !meta?.isFinalStale
          ? finalizeStatus === "finalizing"
            ? "更新定稿中..."
            : "更新定稿"
          : finalizeStatus === "finalizing"
            ? "定稿中..."
            : "确认定稿"}
      </button>

      <button
        className="topbar-btn render"
        onClick={triggerRender}
        disabled={renderStatus === "rendering" || !meta?.isRenderable || isDirty}
      >
        {renderStatus === "rendering" ? "渲染中..." : "渲染最终版"}
      </button>
    </div>
  );
};



