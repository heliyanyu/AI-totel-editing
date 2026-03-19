import React, { useMemo, useState } from "react";
import { useEditorStore } from "../store/blueprint-store";

interface Props {
  segmentId: string;
  template: string;
  templateProps?: Record<string, unknown>;
}

interface KnownField {
  key: string;
  label: string;
  type: "text" | "number";
  placeholder?: string;
}

const FIELD_MAP: Record<string, KnownField[]> = {
  split_column: [
    { key: "left_label", label: "左列标签", type: "text", placeholder: "坏习惯" },
    { key: "right_label", label: "右列标签", type: "text", placeholder: "正确做法" },
  ],
  myth_buster: [
    { key: "dosCount", label: "前半段条数", type: "number", placeholder: "2" },
  ],
  number_center: [
    { key: "context", label: "说明文本", type: "text", placeholder: "每天超过 8 小时" },
    { key: "unit", label: "单位", type: "text", placeholder: "% / 小时 / 倍" },
  ],
};

function parseLooseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return raw;
}

export const TemplatePropsEditor: React.FC<Props> = ({
  segmentId,
  template,
  templateProps,
}) => {
  const updateTemplateProp = useEditorStore((s) => s.updateTemplateProp);
  const removeTemplateProp = useEditorStore((s) => s.removeTemplateProp);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const knownFields = FIELD_MAP[template] ?? [];
  const knownKeys = useMemo(() => new Set(knownFields.map((field) => field.key)), [knownFields]);
  const extraEntries = Object.entries(templateProps ?? {}).filter(([key]) => !knownKeys.has(key));

  return (
    <div>
      {knownFields.length > 0 ? (
        <div className="template-props-grid">
          {knownFields.map((field) => {
            const rawValue = templateProps?.[field.key];
            return (
              <div key={field.key} className="template-prop-row">
                <div className="panel-label">{field.label}</div>
                <input
                  className="panel-input"
                  type={field.type}
                  value={rawValue === undefined || rawValue === null ? "" : String(rawValue)}
                  placeholder={field.placeholder}
                  onChange={(e) => {
                    const nextRaw = e.target.value;
                    if (!nextRaw.trim()) {
                      removeTemplateProp(segmentId, field.key);
                      return;
                    }
                    updateTemplateProp(
                      segmentId,
                      field.key,
                      field.type === "number" ? Number(nextRaw) : nextRaw
                    );
                  }}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel-empty-inline">当前模板没有预设参数。</div>
      )}

      {extraEntries.length > 0 && (
        <div className="template-props-extra">
          <div className="panel-label panel-label-spaced">自定义参数</div>
          {extraEntries.map(([key, value]) => (
            <div key={key} className="template-prop-extra-row">
              <div className="template-prop-key">{key}</div>
              <input
                className="panel-input"
                value={value === undefined || value === null ? "" : String(value)}
                onChange={(e) => updateTemplateProp(segmentId, key, parseLooseValue(e.target.value))}
              />
              <button
                className="item-delete-btn"
                onClick={() => removeTemplateProp(segmentId, key)}
                title="删除参数"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="template-prop-add-row">
        <input
          className="panel-input"
          value={newKey}
          placeholder="新增参数 key"
          onChange={(e) => setNewKey(e.target.value)}
        />
        <input
          className="panel-input"
          value={newValue}
          placeholder="value"
          onChange={(e) => setNewValue(e.target.value)}
        />
        <button
          className="topbar-btn"
          onClick={() => {
            if (!newKey.trim()) return;
            updateTemplateProp(segmentId, newKey.trim(), parseLooseValue(newValue));
            setNewKey("");
            setNewValue("");
          }}
        >
          添加
        </button>
      </div>
    </div>
  );
};
