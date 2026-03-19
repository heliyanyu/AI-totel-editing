import React from "react";

interface BlueprintItem {
  text: string;
  emoji?: string;
}

interface CssPreviewProps {
  template: string;
  items: BlueprintItem[];
  title?: string;
  templateProps?: Record<string, unknown>;
}

const CATEGORICAL = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4"];

function esc(s: string): string {
  return s || "";
}

/**
 * CSS 即时预览：15 种模板的视觉近似
 * 选中 segment 后 0ms 渲染，Remotion still 加载完成后叠加在上层
 */
export const CssPreview: React.FC<CssPreviewProps> = ({
  template,
  items,
  title,
  templateProps,
}) => {
  const color = CATEGORICAL[0];

  const content = (() => {
    switch (template) {
      // ── hero_text ──
      case "hero_text":
        return (
          <div className="pv-safe pv-hero">
            <div className="pv-emoji">{items[0]?.emoji || "💡"}</div>
            <div className="pv-text-lg">{esc(items[0]?.text)}</div>
            {items[1] && <div className="pv-text-sm">{esc(items[1].text)}</div>}
          </div>
        );

      // ── number_center ──
      case "number_center": {
        const numText = items[0]?.text || "0";
        const unit = (templateProps?.unit as string) || "";
        const context = (templateProps?.context as string) || items[1]?.text || "";
        return (
          <div className="pv-safe pv-number">
            <div>
              <span className="pv-num">{numText}</span>
              {unit && <span className="pv-unit">{unit}</span>}
            </div>
            {context && (
              <div className="pv-card" style={{ marginTop: "3%", textAlign: "center" }}>
                <div className="pv-text">{context}</div>
              </div>
            )}
          </div>
        );
      }

      // ── warning_alert ──
      case "warning_alert":
        return (
          <div className="pv-safe pv-warning">
            <div className="pv-emoji">{items[0]?.emoji || "⚠️"}</div>
            <div className="pv-card">
              <div className="pv-text-lg">{esc(items[0]?.text)}</div>
              {items[1] && (
                <>
                  <div className="pv-divider" />
                  <div className="pv-text">{esc(items[1].text)}</div>
                </>
              )}
            </div>
          </div>
        );

      // ── term_card ──
      case "term_card": {
        const term = items[0]?.text || "";
        const def = items.slice(1).map((it) => it.text).join("；") || "";
        return (
          <div className="pv-safe pv-term">
            <div className="pv-card">
              {items[0]?.emoji && <div className="pv-emoji">{items[0].emoji}</div>}
              <div className="pv-text-lg">{term}</div>
              {def && (
                <>
                  <div className="pv-divider" />
                  <div className="pv-text">{def}</div>
                </>
              )}
            </div>
          </div>
        );
      }

      // ── image_overlay ──
      case "image_overlay":
        return (
          <div className="pv-safe pv-image">
            <div className="pv-overlay-box">
              <div className="pv-text" style={{ color: "rgba(255,255,255,0.9)" }}>
                {esc(items[0]?.text)}
              </div>
              {items[1] && (
                <div className="pv-text-sm" style={{ color: "rgba(255,255,255,0.6)", marginTop: "1%" }}>
                  {esc(items[1].text)}
                </div>
              )}
            </div>
          </div>
        );

      // ── list_fade ──
      case "list_fade":
        return (
          <div className="pv-safe pv-list">
            {title && <div className="pv-title">{title}</div>}
            {items.map((it, i) => (
              <div
                key={i}
                className="pv-list-item"
                style={{ borderLeftColor: CATEGORICAL[i % CATEGORICAL.length] }}
              >
                <span className="pv-emoji">{it.emoji || `${i + 1}`}</span>
                <span className="pv-text">{esc(it.text)}</span>
              </div>
            ))}
          </div>
        );

      // ── step_arrow ──
      case "step_arrow":
        return (
          <div className="pv-safe pv-step">
            {title && <div className="pv-title">{title}</div>}
            {items.map((it, i) => (
              <React.Fragment key={i}>
                {i > 0 && <div className="pv-step-arrow">▼</div>}
                <div
                  className={`pv-card pv-list-item ${i === items.length - 1 ? "pv-step-last" : ""}`}
                  style={{
                    borderLeftColor:
                      i === items.length - 1
                        ? "#ef4444"
                        : CATEGORICAL[i % CATEGORICAL.length],
                  }}
                >
                  <span className="pv-emoji">{it.emoji || `${i + 1}`}</span>
                  <span className="pv-text">{esc(it.text)}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
        );

      // ── color_grid ──
      case "color_grid":
        return (
          <div className="pv-safe pv-grid">
            {title && <div className="pv-title">{title}</div>}
            <div className="pv-grid-wrap">
              {items.map((it, i) => {
                const c = CATEGORICAL[i % CATEGORICAL.length];
                return (
                  <div
                    key={i}
                    className="pv-grid-cell"
                    style={{ background: `${c}12` }}
                  >
                    <span className="pv-emoji">{it.emoji || "📌"}</span>
                    <div className="pv-text">{esc(it.text)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );

      // ── brick_stack ──
      case "brick_stack": {
        const factors = items.slice(0, -1);
        const result = items[items.length - 1];
        return (
          <div className="pv-safe pv-brick">
            {title && <div className="pv-title">{title}</div>}
            <div className="pv-brick-grid">
              {factors.map((it, i) => (
                <div key={i} className="pv-card" style={{ textAlign: "center", padding: "2%" }}>
                  {it.emoji && <div className="pv-emoji">{it.emoji}</div>}
                  <div className="pv-text-sm">{esc(it.text)}</div>
                </div>
              ))}
            </div>
            <div className="pv-brick-arrow">▼</div>
            {result && (
              <div className="pv-brick-result">
                <div className="pv-text-lg" style={{ color: "#ef4444" }}>
                  {result.emoji && <span>{result.emoji} </span>}
                  {esc(result.text)}
                </div>
              </div>
            )}
          </div>
        );
      }

      // ── split_column ──
      case "split_column": {
        const leftLabel = (templateProps?.left_label as string) || "A";
        const rightLabel = (templateProps?.right_label as string) || "B";
        const leftItems = items.filter((_, i) => i % 2 === 0);
        const rightItems = items.filter((_, i) => i % 2 === 1);
        return (
          <div className="pv-safe pv-split">
            {title && <div className="pv-title">{title}</div>}
            <div className="pv-split-cols">
              <div className="pv-split-col" style={{ background: "rgba(59,130,246,0.06)", borderTop: "3px solid #3B82F6" }}>
                <div className="pv-split-col-header">{leftLabel}</div>
                {leftItems.map((it, i) => (
                  <div key={i} className="pv-split-row">{it.emoji ? `${it.emoji} ` : ""}{esc(it.text)}</div>
                ))}
              </div>
              <div className="pv-split-col" style={{ background: "rgba(34,197,94,0.06)", borderTop: "3px solid #22C55E" }}>
                <div className="pv-split-col-header">{rightLabel}</div>
                {rightItems.map((it, i) => (
                  <div key={i} className="pv-split-row">{it.emoji ? `${it.emoji} ` : ""}{esc(it.text)}</div>
                ))}
              </div>
            </div>
          </div>
        );
      }

      // ── myth_buster ──
      case "myth_buster": {
        const dosCount = (templateProps?.dosCount as number) || Math.ceil(items.length / 2);
        const myths = items.slice(0, dosCount);
        const truths = items.slice(dosCount);
        return (
          <div className="pv-safe pv-myth">
            {title && <div className="pv-title">{title}</div>}
            {myths.map((it, i) => (
              <div key={`m-${i}`} className="pv-myth-item pv-myth-bad">
                <span>❌</span>
                <span className="pv-text">{esc(it.text)}</span>
              </div>
            ))}
            <div className="pv-myth-arrow">↓</div>
            {truths.map((it, i) => (
              <div key={`t-${i}`} className="pv-myth-item pv-myth-good">
                <span>✅</span>
                <span className="pv-text">{esc(it.text)}</span>
              </div>
            ))}
          </div>
        );
      }

      // ── category_table ──
      case "category_table": {
        const SEVERITY = ["#16A34A", "#CA8A04", "#DC2626", "#991B1B"];
        const pairs: { label: string; value: string }[] = [];
        for (let i = 0; i < items.length; i += 2) {
          pairs.push({
            label: items[i]?.text || "",
            value: items[i + 1]?.text || "",
          });
        }
        return (
          <div className="pv-safe pv-category">
            {title && <div className="pv-title">{title}</div>}
            {pairs.map((p, i) => (
              <div key={i} className="pv-table-row">
                <div
                  className="pv-table-label"
                  style={{ background: SEVERITY[i % SEVERITY.length] }}
                >
                  {p.label}
                </div>
                <div className="pv-table-val">{p.value}</div>
              </div>
            ))}
          </div>
        );
      }

      // ── vertical_timeline ──
      case "vertical_timeline":
        return (
          <div className="pv-safe pv-vtimeline">
            {title && <div className="pv-title">{title}</div>}
            {items.map((it, i) => (
              <React.Fragment key={i}>
                <div className="pv-tl-node">
                  <div
                    className="pv-tl-dot"
                    style={{ background: CATEGORICAL[i % CATEGORICAL.length] }}
                  />
                  <div className="pv-text">{it.emoji ? `${it.emoji} ` : ""}{esc(it.text)}</div>
                </div>
                {i < items.length - 1 && <div className="pv-tl-line" />}
              </React.Fragment>
            ))}
          </div>
        );

      // ── branch_path ──
      case "branch_path": {
        const condition = items[0];
        const left = items[1];
        const right = items[2];
        return (
          <div className="pv-safe pv-branch">
            {condition && (
              <div className="pv-card" style={{ textAlign: "center", width: "80%" }}>
                <div className="pv-text">{condition.emoji ? `${condition.emoji} ` : ""}{esc(condition.text)}</div>
              </div>
            )}
            <div className="pv-branch-fork">↙ ↘</div>
            <div className="pv-branch-cols">
              <div className="pv-branch-left">
                <div className="pv-text" style={{ textAlign: "center" }}>
                  ✅ {left ? esc(left.text) : ""}
                </div>
              </div>
              <div className="pv-branch-right">
                <div className="pv-text" style={{ textAlign: "center" }}>
                  ❌ {right ? esc(right.text) : ""}
                </div>
              </div>
            </div>
          </div>
        );
      }

      // ── body_annotate ──
      case "body_annotate":
        return (
          <div className="pv-safe pv-body">
            {title && <div className="pv-title">{title}</div>}
            <div className="pv-body-figure">🧍</div>
            <div className="pv-body-points">
              {items.map((it, i) => (
                <div
                  key={i}
                  className="pv-body-point"
                  style={{ justifyContent: i % 2 === 0 ? "flex-start" : "flex-end" }}
                >
                  <div
                    className="pv-body-dot"
                    style={{ background: CATEGORICAL[i % CATEGORICAL.length] }}
                  />
                  <span className="pv-text">{it.emoji ? `${it.emoji} ` : ""}{esc(it.text)}</span>
                </div>
              ))}
            </div>
          </div>
        );

      // ── default fallback → list_fade ──
      default:
        return (
          <div className="pv-safe pv-list">
            {title && <div className="pv-title">{title}</div>}
            {items.map((it, i) => (
              <div
                key={i}
                className="pv-list-item"
                style={{ borderLeftColor: CATEGORICAL[i % CATEGORICAL.length] }}
              >
                <span className="pv-emoji">{it.emoji || `${i + 1}`}</span>
                <span className="pv-text">{esc(it.text)}</span>
              </div>
            ))}
          </div>
        );
    }
  })();

  return (
    <>
      <div className="pv-bg" />
      {content}
    </>
  );
};
