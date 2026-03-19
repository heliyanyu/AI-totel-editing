import React from "react";
import { useEditorStore, type BlueprintAtom, type KeepAtom, type TimeRange } from "../store/blueprint-store";

interface Props {
  segmentId: string;
  atoms: BlueprintAtom[];
}

function formatRange(range: TimeRange | undefined): string {
  if (!range) return "-";
  return `${range.start.toFixed(2)}-${range.end.toFixed(2)}s`;
}

function wordRange(atom: KeepAtom): TimeRange | undefined {
  if (!atom.words || atom.words.length === 0) return undefined;
  return {
    start: atom.words[0].start,
    end: atom.words[atom.words.length - 1].end,
  };
}

export const AtomList: React.FC<Props> = ({ segmentId, atoms }) => {
  const toggleAtomStatus = useEditorStore((s) => s.toggleAtomStatus);

  const keepCount = atoms.filter((a) => a.status === "keep").length;

  return (
    <div>
      <div className="panel-section-title">
        Atoms ({keepCount} keep / {atoms.length} total)
      </div>
      {atoms.map((atom) => {
        const subtitleRange = atom.status === "keep" ? wordRange(atom) : undefined;

        return (
          <React.Fragment key={atom.id}>
            <div className="atom-row">
              <button
                className={`atom-toggle ${atom.status}`}
                onClick={() => toggleAtomStatus(segmentId, atom.id)}
                title={atom.status === "keep" ? "点击标记为废料" : "点击恢复"}
              >
                {atom.status === "keep" ? "✓" : "×"}
              </button>
              <span className="atom-id">#{atom.id}</span>
              <span className={`atom-text ${atom.status === "discard" ? "discard" : ""}`}>
                {atom.text.length > 30 ? atom.text.slice(0, 30) + "..." : atom.text}
              </span>
              <span className="atom-time">{atom.time.start.toFixed(1)}s</span>
            </div>
            {atom.status === "keep" ? (
              <div className="atom-meta-grid">
                <div><span>semantic</span><strong>{formatRange(atom.time)}</strong></div>
                <div><span>subtitle</span><strong>{formatRange(subtitleRange)}</strong></div>
                <div><span>media</span><strong>{formatRange(atom.media_range)}</strong></div>
                <div><span>align</span><strong>{atom.alignment_mode ?? "-"}</strong></div>
                <div><span>media mode</span><strong>{atom.media_mode ?? "-"}</strong></div>
                <div><span>occurrence</span><strong>{atom.media_occurrence ?? "-"}</strong></div>
                <div><span>conf</span><strong>{typeof atom.media_confidence === "number" ? atom.media_confidence.toFixed(2) : "-"}</strong></div>
              </div>
            ) : (
              <div className="atom-reason">{atom.reason}</div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
