import type { Blueprint, LogicSegment, BlueprintScene } from "../schemas/blueprint.js";
import type {
  Step2DiagnosticIssue,
  Step2Diagnostics,
  Step2SegmentDiagnostics,
} from "../schemas/workflow.js";

interface TemplateRule {
  min?: number;
  max?: number;
  exact?: number;
  even?: boolean;
  requiredProps?: string[];
  preferredView?: "overlay" | "graphics";
}

const TEMPLATE_RULES: Record<string, TemplateRule> = {
  hero_text: { exact: 1, preferredView: "overlay" },
  number_center: { exact: 1, requiredProps: ["context", "unit"], preferredView: "graphics" },
  warning_alert: { min: 1, max: 2, preferredView: "graphics" },
  term_card: { exact: 2, preferredView: "graphics" },
  image_overlay: { min: 1, max: 2, preferredView: "overlay" },
  list_fade: { min: 2, max: 6, preferredView: "graphics" },
  color_grid: { min: 2, max: 4, preferredView: "graphics" },
  body_annotate: { min: 2, max: 5, preferredView: "graphics" },
  step_arrow: { min: 2, max: 5, preferredView: "graphics" },
  branch_path: { exact: 3, preferredView: "graphics" },
  brick_stack: { min: 3, max: 6, preferredView: "graphics" },
  split_column: { even: true, requiredProps: ["left_label", "right_label"], preferredView: "graphics" },
  myth_buster: { even: true, requiredProps: ["dosCount"], preferredView: "graphics" },
  category_table: { even: true, preferredView: "graphics" },
  vertical_timeline: { min: 2, max: 6, preferredView: "graphics" },
};

function pushIssue(
  issues: Step2DiagnosticIssue[],
  code: string,
  severity: "info" | "warn",
  message: string,
  field?: string
) {
  issues.push({ code, severity, message, field });
}

function validateItems(segment: LogicSegment, issues: Step2DiagnosticIssue[]) {
  const rule = TEMPLATE_RULES[segment.template] ?? {};
  const itemCount = segment.items.length;

  if (itemCount === 0) {
    pushIssue(issues, "items.empty", "warn", "当前逻辑段没有可渲染 items。", "items");
  }

  if (rule.exact !== undefined && itemCount !== rule.exact) {
    pushIssue(
      issues,
      "items.count_exact",
      "warn",
      `${segment.template} 期望 ${rule.exact} 个 items，当前是 ${itemCount} 个。`,
      "items"
    );
  }

  if (rule.min !== undefined && itemCount < rule.min) {
    pushIssue(
      issues,
      "items.count_min",
      "warn",
      `${segment.template} 至少需要 ${rule.min} 个 items，当前只有 ${itemCount} 个。`,
      "items"
    );
  }

  if (rule.max !== undefined && itemCount > rule.max) {
    pushIssue(
      issues,
      "items.count_max",
      "warn",
      `${segment.template} 最多建议 ${rule.max} 个 items，当前有 ${itemCount} 个。`,
      "items"
    );
  }

  if (rule.even && itemCount % 2 !== 0) {
    pushIssue(
      issues,
      "items.count_even",
      "warn",
      `${segment.template} 需要偶数个 items，当前是 ${itemCount} 个。`,
      "items"
    );
  }

  segment.items.forEach((item, index) => {
    if (!item.text.trim()) {
      pushIssue(
        issues,
        "items.blank_text",
        "warn",
        `item ${index + 1} 文本为空。`,
        `items[${index}].text`
      );
      return;
    }

    if (item.text.length > 18) {
      pushIssue(
        issues,
        "items.text_too_long",
        "warn",
        `item ${index + 1} 超过 18 字：${item.text}`,
        `items[${index}].text`
      );
    }

    if (segment.template === "hero_text" && !item.emoji?.trim()) {
      pushIssue(
        issues,
        "items.hero_missing_emoji",
        "info",
        "hero_text 通常建议带 emoji，当前未填写。",
        `items[${index}].emoji`
      );
    }
  });
}

function validateTemplateProps(segment: LogicSegment, issues: Step2DiagnosticIssue[]) {
  const rule = TEMPLATE_RULES[segment.template];
  const props = segment.template_props ?? {};
  if (!rule?.requiredProps?.length) return;

  for (const key of rule.requiredProps) {
    const value = props[key];
    if (value === undefined || value === null || value === "") {
      pushIssue(
        issues,
        "template_props.missing",
        "warn",
        `${segment.template} 缺少必要模板参数 ${key}。`,
        `template_props.${key}`
      );
    }
  }
}

function validateView(scene: BlueprintScene, segment: LogicSegment, issues: Step2DiagnosticIssue[]) {
  const rule = TEMPLATE_RULES[segment.template];
  if (!rule?.preferredView || scene.view === rule.preferredView) {
    return;
  }

  pushIssue(
    issues,
    "scene.view_mismatch",
    "info",
    `${segment.template} 通常更适合 ${rule.preferredView} 视图，当前场景是 ${scene.view}。`,
    "view"
  );
}

function validateFallback(segment: LogicSegment, issues: Step2DiagnosticIssue[]) {
  if (!segment.transition_type.includes("待人工确认") && !segment.transition_type.includes("Step2缺失")) {
    return;
  }

  pushIssue(
    issues,
    "step2.fallback_segment",
    "warn",
    "这个逻辑段是 Step2 fallback 产物，建议人工重点确认模板、items 和转场描述。"
  );
}

function validateKeepAtoms(segment: LogicSegment, issues: Step2DiagnosticIssue[]) {
  const keepCount = segment.atoms.filter((atom) => atom.status === "keep").length;
  if (keepCount === 0) {
    pushIssue(
      issues,
      "atoms.no_keep",
      "warn",
      "当前逻辑段没有 keep atoms，最终切片和渲染可能为空。",
      "atoms"
    );
  }
}

export function buildStep2Diagnostics(blueprint: Blueprint): Step2Diagnostics {
  const segments: Record<string, Step2SegmentDiagnostics> = {};
  let warnCount = 0;
  let infoCount = 0;
  let consecutiveSameView = 1;

  blueprint.scenes.forEach((scene, sceneIndex) => {
    if (sceneIndex > 0) {
      consecutiveSameView = blueprint.scenes[sceneIndex - 1].view === scene.view
        ? consecutiveSameView + 1
        : 1;
    }

    scene.logic_segments.forEach((segment, segmentIndex) => {
      const issues: Step2DiagnosticIssue[] = [];
      validateFallback(segment, issues);
      validateItems(segment, issues);
      validateTemplateProps(segment, issues);
      validateView(scene, segment, issues);
      validateKeepAtoms(segment, issues);

      if (segmentIndex === 0 && consecutiveSameView >= 3) {
        pushIssue(
          issues,
          "scene.view_run",
          "info",
          `从本场景开始，${scene.view} 已连续出现 ${consecutiveSameView} 个场景。`,
          "view"
        );
      }

      const keepAtomCount = segment.atoms.filter((atom) => atom.status === "keep").length;
      const discardAtomCount = segment.atoms.length - keepAtomCount;

      warnCount += issues.filter((issue) => issue.severity === "warn").length;
      infoCount += issues.filter((issue) => issue.severity === "info").length;

      segments[segment.id] = {
        scene_id: scene.id,
        segment_id: segment.id,
        template: segment.template,
        view: scene.view,
        keep_atom_count: keepAtomCount,
        discard_atom_count: discardAtomCount,
        item_count: segment.items.length,
        fallback: issues.some((issue) => issue.code === "step2.fallback_segment"),
        issues,
      };
    });
  });

  const flaggedSegmentCount = Object.values(segments).filter((segment) => segment.issues.length > 0).length;

  return {
    summary: {
      segment_count: Object.keys(segments).length,
      flagged_segment_count: flaggedSegmentCount,
      warn_count: warnCount,
      info_count: infoCount,
      generated_at: new Date().toISOString(),
    },
    segments,
  };
}
