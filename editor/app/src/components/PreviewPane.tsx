import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useEditorStore,
  useSelectedSegmentContext,
} from "../store/blueprint-store";
import { useStillPreview } from "../hooks/useStillPreview";
import { CssPreview } from "./CssPreview";

type PreviewTab = "layout" | "video" | "context";

function formatTime(sec: number | null): string {
  if (sec === null || Number.isNaN(sec)) return "--:--";
  const whole = Math.max(0, Math.floor(sec));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const PreviewPane: React.FC = () => {
  const selectedSegmentId = useEditorStore((s) => s.selectedSegmentId);
  const context = useSelectedSegmentContext();
  const [activeTab, setActiveTab] = useState<PreviewTab>("layout");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const segment = context?.segment ?? null;
  const contentKey = useMemo(() => {
    if (!segment) return "";
    return JSON.stringify({
      t: segment.template,
      i: segment.items,
      p: segment.template_props,
      sceneTitle: context?.scene.title,
    });
  }, [segment, context?.scene.title]);

  const previewPayload = useMemo(() => {
    if (!segment || !context) return null;
    return {
      segment,
      parentScene: context.scene,
    };
  }, [segment, context?.scene]);

  const { stillUrl, loading } = useStillPreview(
    selectedSegmentId,
    previewPayload,
    contentKey
  );

  const previewMode =
    context?.meta?.renderMode === "source_direct" && context.meta.media.sourceVideoUrl
      ? "source_direct"
      : context?.meta?.media.cutVideoUrl
        ? "cut_video"
        : context?.meta?.media.sourceVideoUrl
          ? "source_direct"
          : null;

  const previewVideoUrl =
    previewMode === "source_direct"
      ? context?.meta?.media.sourceVideoUrl ?? null
      : context?.meta?.media.cutVideoUrl ?? null;

  const previewStart =
    previewMode === "source_direct" ? context?.originalStart ?? null : context?.outputStart ?? null;
  const previewEnd =
    previewMode === "source_direct" ? context?.originalEnd ?? null : context?.outputEnd ?? null;
  const previewTabLabel = previewMode === "source_direct" ? "源视频" : "切后视频";
  const previewRangeLabel =
    previewMode === "source_direct" ? "原视频位置" : "成片位置";

  useEffect(() => {
    if (activeTab !== "video") return;
    if (!videoRef.current || previewStart === null || previewStart === undefined) {
      return;
    }
    videoRef.current.currentTime = Math.max(0, previewStart - 0.2);
  }, [activeTab, previewStart, selectedSegmentId]);

  if (!selectedSegmentId || !segment || !context) {
    return (
      <div className="preview-pane">
        <div className="preview-empty">选择一个逻辑段查看中间预览</div>
      </div>
    );
  }

  const transcriptText = context.transcriptExcerpt.map((word) => word.text).join("");

  return (
    <div className="preview-pane preview-workbench">
      <div className="preview-header">
        <div>
          <div className="preview-kicker">
            {context.scene.id} · {context.scene.title} · {segment.id}
          </div>
          <div className="preview-title-row">
            <h2>{segment.transition_type}</h2>
            <span className="preview-template-chip">{segment.template}</span>
            {context.meta?.renderMode && (
              <span className={`preview-mode-chip ${context.meta.renderMode}`}>
                {context.meta.renderMode}
              </span>
            )}
            {context.reviewEntry && (
              <span className={`preview-review-chip ${context.reviewEntry.review_status}`}>
                {context.reviewEntry.review_status}
              </span>
            )}
            {context.diagnostics && context.diagnostics.issues.length > 0 && (
              <span className="preview-risk-chip">
                {context.diagnostics.issues.length} risk
              </span>
            )}
          </div>
        </div>
        <div className="preview-meta-grid">
          <div className="preview-meta-card">
            <span>原始时间</span>
            <strong>
              {formatTime(context.originalStart)} - {formatTime(context.originalEnd)}
            </strong>
          </div>
          <div className="preview-meta-card">
            <span>成片时间</span>
            <strong>
              {formatTime(context.outputStart)} - {formatTime(context.outputEnd)}
            </strong>
          </div>
          <div className="preview-meta-card">
            <span>原子块</span>
            <strong>
              {context.keepAtoms.length} keep / {context.keepAtoms.length + context.discardAtoms.length} total
            </strong>
          </div>
        </div>
      </div>

      <div className="preview-tabs">
        <button
          className={`preview-tab ${activeTab === "layout" ? "active" : ""}`}
          onClick={() => setActiveTab("layout")}
        >
          版式预览
        </button>
        <button
          className={`preview-tab ${activeTab === "video" ? "active" : ""}`}
          onClick={() => setActiveTab("video")}
        >
          {previewTabLabel}
        </button>
        <button
          className={`preview-tab ${activeTab === "context" ? "active" : ""}`}
          onClick={() => setActiveTab("context")}
        >
          文本上下文
        </button>
      </div>

      {activeTab === "layout" && (
        <div className="preview-layout-grid">
          <div className="preview-stage-card">
            <div className="preview-container">
              <CssPreview
                template={segment.template}
                items={segment.items}
                title={context.scene.title}
                templateProps={segment.template_props}
              />
              {stillUrl && (
                <div className="preview-still-overlay">
                  <img src={stillUrl} alt="Segment preview" />
                </div>
              )}
              {loading && (
                <div className="preview-loading">
                  <div className="spinner" />
                </div>
              )}
              {stillUrl && !loading && <div className="preview-badge">✓ Remotion</div>}
            </div>
          </div>

          <div className="preview-info-column">
            <div className="preview-note-card">
              <div className="preview-note-title">当前保留文案</div>
              <div className="preview-copy">{context.keepText || "当前逻辑段没有 keep 文案"}</div>
            </div>
            <div className="preview-note-card">
              <div className="preview-note-title">渲染 items</div>
              <ul className="preview-item-list">
                {segment.items.map((item, index) => (
                  <li key={`${item.text}-${index}`}>
                    <span>{item.emoji || "•"}</span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {activeTab === "video" && (
        <div className="preview-video-panel">
          {previewVideoUrl ? (
            <>
              <div className="preview-video-toolbar">
                <button
                  className="topbar-btn"
                  onClick={() => {
                    if (videoRef.current && previewStart !== null) {
                      videoRef.current.currentTime = Math.max(0, previewStart - 0.2);
                      void videoRef.current.play().catch(() => {});
                    }
                  }}
                >
                  跳到当前段
                </button>
                <span>
                  {previewRangeLabel}：{formatTime(previewStart)} - {formatTime(previewEnd)}
                </span>
              </div>
              <video
                ref={videoRef}
                className="preview-video"
                controls
                preload="metadata"
                src={previewVideoUrl}
                onTimeUpdate={() => {
                  if (!videoRef.current || previewEnd === null) return;
                  if (videoRef.current.currentTime >= previewEnd + 0.08) {
                    videoRef.current.pause();
                  }
                }}
              />
            </>
          ) : (
            <div className="preview-empty">
              {previewMode === "source_direct"
                ? "当前工作区还没有可用的原视频路径"
                : "当前工作区还没有 cut_video.mp4"}
            </div>
          )}
        </div>
      )}

      {activeTab === "context" && (
        <div className="preview-context-grid">
          <div className="preview-note-card">
            <div className="preview-note-title">保留原子块</div>
            <ul className="preview-atom-list keep">
              {context.keepAtoms.map((atom) => (
                <li key={atom.id}>
                  <span>#{atom.id}</span>
                  <span>{atom.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="preview-note-card">
            <div className="preview-note-title">已丢弃原子块</div>
            {context.discardAtoms.length > 0 ? (
              <ul className="preview-atom-list discard">
                {context.discardAtoms.map((atom) => (
                  <li key={atom.id}>
                    <div>
                      <span>#{atom.id}</span>
                      <strong>{atom.text}</strong>
                    </div>
                    <small>{atom.reason}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="preview-empty-inline">当前逻辑段没有 discard</div>
            )}
          </div>

          <div className="preview-note-card preview-note-span-2">
            <div className="preview-note-title">转录上下文</div>
            <div className="preview-copy transcript">
              {transcriptText || "当前工作区没有 transcript 或这段没有命中上下文"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
