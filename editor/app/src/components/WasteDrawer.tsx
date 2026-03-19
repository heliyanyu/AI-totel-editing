import React from "react";
import { useEditorStore } from "../store/blueprint-store";

interface Props {
  onClose: () => void;
}

export const WasteDrawer: React.FC<Props> = ({ onClose }) => {
  const blueprint = useEditorStore((s) => s.blueprint);
  const toggleAtomStatus = useEditorStore((s) => s.toggleAtomStatus);

  if (!blueprint) return null;

  // 收集所有 discard atoms
  const wasteGroups: {
    sceneId: string;
    sceneTitle: string;
    segmentId: string;
    atoms: { id: number; text: string; reason: string }[];
  }[] = [];

  for (const scene of blueprint.scenes) {
    for (const seg of scene.logic_segments) {
      const discards = seg.atoms.filter((a) => a.status === "discard");
      if (discards.length > 0) {
        wasteGroups.push({
          sceneId: scene.id,
          sceneTitle: scene.title,
          segmentId: seg.id,
          atoms: discards.map((a) => ({
            id: a.id,
            text: a.text,
            reason: a.status === "discard" ? a.reason : "",
          })),
        });
      }
    }
  }

  return (
    <div className="waste-drawer-overlay" onClick={onClose}>
      <div className="waste-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="waste-drawer-header">
          <span>废料抽屉</span>
          <button className="waste-drawer-close" onClick={onClose}>
            ×
          </button>
        </div>

        {wasteGroups.length === 0 ? (
          <div className="panel-empty">没有废料</div>
        ) : (
          wasteGroups.map((group) => (
            <div key={`${group.sceneId}-${group.segmentId}`} className="waste-group">
              <div className="waste-group-title">
                {group.sceneId} {group.sceneTitle} → {group.segmentId}
              </div>
              {group.atoms.map((atom) => (
                <div key={atom.id} className="waste-atom">
                  <button
                    className="waste-restore-btn"
                    onClick={() =>
                      toggleAtomStatus(group.segmentId, atom.id)
                    }
                  >
                    恢复
                  </button>
                  <div>
                    <div style={{ color: "var(--text-secondary)" }}>
                      #{atom.id} {atom.text}
                    </div>
                    {atom.reason && (
                      <div style={{ fontSize: 10, color: "var(--red)" }}>
                        {atom.reason}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
