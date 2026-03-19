import React, { useState } from "react";
import { useEditorStore } from "../store/blueprint-store";
import { WasteDrawer } from "./WasteDrawer";
import type { SegmentReviewStatus } from "@schemas/workflow";

const FILTER_OPTIONS: Array<{ value: "all" | SegmentReviewStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "todo", label: "待看" },
  { value: "needs_edit", label: "待改" },
  { value: "accepted", label: "已确认" },
  { value: "accepted_after_edit", label: "改后确认" },
];

export const SceneTree: React.FC = () => {
  const blueprint = useEditorStore((s) => s.blueprint);
  const step2Diagnostics = useEditorStore((s) => s.step2Diagnostics);
  const reviewState = useEditorStore((s) => s.reviewState);
  const reviewFilter = useEditorStore((s) => s.reviewFilter);
  const setReviewFilter = useEditorStore((s) => s.setReviewFilter);
  const selectedSegmentId = useEditorStore((s) => s.selectedSegmentId);
  const selectSegment = useEditorStore((s) => s.selectSegment);

  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(
    new Set(blueprint?.scenes.map((s) => s.id) || [])
  );
  const [showWaste, setShowWaste] = useState(false);

  React.useEffect(() => {
    if (blueprint) {
      setExpandedScenes(new Set(blueprint.scenes.map((s) => s.id)));
    }
  }, [blueprint?.scenes.length]);

  if (!blueprint) {
    return (
      <div className="scene-tree">
        <div className="scene-tree-header">加载中...</div>
      </div>
    );
  }

  const toggleScene = (sceneId: string) => {
    setExpandedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  };

  let totalDiscard = 0;
  for (const scene of blueprint.scenes) {
    for (const seg of scene.logic_segments) {
      for (const atom of seg.atoms) {
        if (atom.status === "discard") totalDiscard++;
      }
    }
  }

  return (
    <div className="scene-tree">
      <div className="scene-tree-header">场景结构</div>
      <div className="scene-tree-filters">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`scene-filter-chip ${reviewFilter === option.value ? "active" : ""}`}
            onClick={() => setReviewFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {blueprint.scenes.map((scene) => {
        const isExpanded = expandedScenes.has(scene.id);
        const visibleSegments = scene.logic_segments.filter((seg) => {
          if (reviewFilter === "all") return true;
          const status = reviewState?.segments?.[seg.id]?.review_status ?? "todo";
          return status === reviewFilter;
        });

        if (visibleSegments.length === 0) {
          return null;
        }

        return (
          <div key={scene.id} className="scene-node">
            <div
              className="scene-header"
              onClick={() => toggleScene(scene.id)}
            >
              <span className={`chevron ${isExpanded ? "open" : ""}`}>▶</span>
              <span>
                {scene.id} {scene.title}
              </span>
              <span className="scene-view-badge">{scene.view}</span>
            </div>

            {isExpanded &&
              visibleSegments.map((seg) => {
                const keepCount = seg.atoms.filter((a) => a.status === "keep").length;
                const totalCount = seg.atoms.length;
                const keepClass =
                  keepCount === totalCount
                    ? "all-keep"
                    : keepCount === 0
                      ? "all-discard"
                      : "partial";
                const diagCount = step2Diagnostics?.segments?.[seg.id]?.issues.length ?? 0;
                const reviewStatus = reviewState?.segments?.[seg.id]?.review_status ?? "todo";

                return (
                  <div
                    key={seg.id}
                    className={`segment-row ${selectedSegmentId === seg.id ? "selected" : ""}`}
                    onClick={() => selectSegment(seg.id)}
                  >
                    <span>{seg.id}</span>
                    <span className="segment-template">{seg.template}</span>
                    <span className={`segment-review-badge ${reviewStatus}`}>{reviewStatus}</span>
                    {diagCount > 0 && <span className="segment-diag-badge">{diagCount}</span>}
                    <span className={`segment-keep-count ${keepClass}`}>
                      {keepCount}/{totalCount}
                    </span>
                  </div>
                );
              })}
          </div>
        );
      })}

      {totalDiscard > 0 && (
        <div className="waste-row" onClick={() => setShowWaste(true)}>
          🗑️ 废料 ({totalDiscard} 个 discard atoms)
        </div>
      )}

      {showWaste && <WasteDrawer onClose={() => setShowWaste(false)} />}
    </div>
  );
};
