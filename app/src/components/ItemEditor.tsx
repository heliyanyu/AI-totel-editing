import React from "react";
import { useEditorStore, type BlueprintItem } from "../store/blueprint-store";

interface Props {
  segmentId: string;
  items: BlueprintItem[];
}

export const ItemEditor: React.FC<Props> = ({ segmentId, items }) => {
  const updateItem = useEditorStore((s) => s.updateItem);
  const addItem = useEditorStore((s) => s.addItem);
  const removeItem = useEditorStore((s) => s.removeItem);
  const moveItem = useEditorStore((s) => s.moveItem);

  return (
    <div>
      {items.map((item, i) => {
        const tooLong = item.text.length > 18;
        return (
          <div key={i} className="item-row item-row-extended">
            <button
              className="item-order-btn"
              onClick={() => moveItem(segmentId, i, -1)}
              disabled={i === 0}
              title="上移"
            >
              ↑
            </button>
            <button
              className="item-order-btn"
              onClick={() => moveItem(segmentId, i, 1)}
              disabled={i === items.length - 1}
              title="下移"
            >
              ↓
            </button>
            <input
              className="item-emoji-input"
              value={item.emoji || ""}
              onChange={(e) =>
                updateItem(segmentId, i, item.text, e.target.value)
              }
              maxLength={4}
              placeholder="🔹"
            />
            <div className="item-text-wrap">
              <input
                className={`item-text-input ${tooLong ? "warn" : ""}`}
                value={item.text}
                onChange={(e) =>
                  updateItem(segmentId, i, e.target.value, item.emoji)
                }
                placeholder="item 文本"
              />
              <div className={`item-char-count ${tooLong ? "warn" : ""}`}>
                {item.text.length}/18
              </div>
            </div>
            <button
              className="item-delete-btn"
              onClick={() => removeItem(segmentId, i)}
              title="删除"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        className="add-item-btn"
        onClick={() => addItem(segmentId, "新 item", "💡")}
      >
        + 添加 item
      </button>
    </div>
  );
};
