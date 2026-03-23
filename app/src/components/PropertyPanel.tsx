import React from "react";
import {
  useEditorStore,
  useSelectedSegment,
  useSegmentDiagnostics,
} from "../store/blueprint-store";
import { TemplateSelect } from "./TemplateSelect";
import { ItemEditor } from "./ItemEditor";
import { AtomList } from "./AtomList";
import { TemplatePropsEditor } from "./TemplatePropsEditor";
import type { ReviewIssueTag, SegmentReviewStatus } from "@schemas/workflow";

const REVIEW_STATUS_OPTIONS: Array<{ value: SegmentReviewStatus; label: string }> = [
  { value: "todo", label: "待看" },
  { value: "needs_edit", label: "待修改" },
  { value: "accepted", label: "已确认" },
  { value: "accepted_after_edit", label: "修改后确认" },
];

const ISSUE_TAGS: ReviewIssueTag[] = [
  "template",
  "items",
  "scene_title",
  "view",
  "discard",
  "timing",
  "template_props",
  "other",
];

export const PropertyPanel: React.FC = () => {
  const selectedSegmentId = useEditorStore((s) => s.selectedSegmentId);
  const reviewState = useEditorStore((s) => s.reviewState);
  const updateSceneTitle = useEditorStore((s) => s.updateSceneTitle);
  const changeSceneView = useEditorStore((s) => s.changeSceneView);
  const updateTransitionType = useEditorStore((s) => s.updateTransitionType);
  const setReviewStatus = useEditorStore((s) => s.setReviewStatus);
  const toggleIssueTag = useEditorStore((s) => s.toggleIssueTag);
  const updateReviewNote = useEditorStore((s) => s.updateReviewNote);
  const result = useSelectedSegment();
  const diagnostics = useSegmentDiagnostics(selectedSegmentId);

  if (!result || !selectedSegmentId) {
    return (
      <div className="property-panel">
        <div className="panel-empty">选择一个逻辑段查看属性</div>
      </div>
    );
  }

  const { scene, segment } = result;
  const reviewEntry = reviewState?.segments[selectedSegmentId];

  return (
    <div className="property-panel">
      <div className="panel-section">
        <div className="panel-section-title">审核</div>
        <div className="panel-label">当前状态</div>
        <select
          className="panel-select"
          value={reviewEntry?.review_status ?? "todo"}
          onChange={(e) => setReviewStatus(selectedSegmentId, e.target.value as SegmentReviewStatus)}
        >
          {REVIEW_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="panel-label panel-label-spaced">问题标签</div>
        <div className="tag-chip-row">
          {ISSUE_TAGS.map((tag) => {
            const active = reviewEntry?.issue_tags.includes(tag) ?? false;
            return (
              <button
                key={tag}
                className={`tag-chip ${active ? "active" : ""}`}
                onClick={() => toggleIssueTag(selectedSegmentId, tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>

        <div className="panel-label panel-label-spaced">审核备注</div>
        <textarea
          className="panel-textarea"
          value={reviewEntry?.note ?? ""}
          onChange={(e) => updateReviewNote(selectedSegmentId, e.target.value)}
          rows={4}
          placeholder="记录这段为什么需要修改，或者修改后的判断。"
        />
      </div>

      <div className="panel-section">
        <div className="panel-section-title">Step2 风险</div>
        {diagnostics && diagnostics.issues.length > 0 ? (
          <div className="diagnostics-list">
            {diagnostics.issues.map((issue, index) => (
              <div key={`${issue.code}-${index}`} className={`diagnostic-card ${issue.severity}`}>
                <div className="diagnostic-code">{issue.code}</div>
                <div className="diagnostic-message">{issue.message}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel-empty-inline">当前逻辑段没有命中 Step2 风险提示。</div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">场景</div>
        <div className="panel-label">标题</div>
        <input
          className="panel-input"
          value={scene.title}
          onChange={(e) => updateSceneTitle(scene.id, e.target.value)}
          placeholder="场景标题"
        />
        <div className="panel-label panel-label-spaced">画面模式</div>
        <select
          className="panel-select"
          value={scene.view}
          onChange={(e) => changeSceneView(scene.id, e.target.value as "overlay" | "graphics")}
        >
          <option value="overlay">overlay</option>
          <option value="graphics">graphics</option>
        </select>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">逻辑段</div>
        <div className="panel-label">转场/语义描述</div>
        <textarea
          className="panel-textarea"
          value={segment.transition_type}
          onChange={(e) => updateTransitionType(selectedSegmentId, e.target.value)}
          rows={4}
        />
      </div>

      <div className="panel-section">
        <div className="panel-section-title">模板</div>
        <TemplateSelect
          segmentId={selectedSegmentId}
          currentTemplate={segment.template}
        />
      </div>

      <div className="panel-section">
        <div className="panel-section-title">Template Props</div>
        <TemplatePropsEditor
          segmentId={selectedSegmentId}
          template={segment.template}
          templateProps={segment.template_props}
        />
      </div>

      <div className="panel-section">
        <div className="panel-section-title">Items ({segment.items.length})</div>
        <ItemEditor segmentId={selectedSegmentId} items={segment.items} />
      </div>

      <div className="panel-section">
        <AtomList segmentId={selectedSegmentId} atoms={segment.atoms} />
      </div>
    </div>
  );
};
