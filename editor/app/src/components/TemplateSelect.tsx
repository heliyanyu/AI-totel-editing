import React from "react";
import { useEditorStore } from "../store/blueprint-store";

const TEMPLATES = [
  { group: "强调", ids: ["hero_text", "number_center", "warning_alert", "term_card", "image_overlay"] },
  { group: "列举", ids: ["list_fade", "color_grid", "body_annotate"] },
  { group: "流程", ids: ["step_arrow", "branch_path", "vertical_timeline"] },
  { group: "对比", ids: ["split_column", "myth_buster", "brick_stack"] },
  { group: "分类", ids: ["category_table"] },
];

interface Props {
  segmentId: string;
  currentTemplate: string;
}

export const TemplateSelect: React.FC<Props> = ({
  segmentId,
  currentTemplate,
}) => {
  const changeTemplate = useEditorStore((s) => s.changeTemplate);

  return (
    <select
      className="template-select"
      value={currentTemplate}
      onChange={(e) => changeTemplate(segmentId, e.target.value)}
    >
      {TEMPLATES.map((group) => (
        <optgroup key={group.group} label={group.group}>
          {group.ids.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
};
