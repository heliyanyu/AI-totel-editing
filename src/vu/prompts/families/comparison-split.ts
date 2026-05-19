export const comparisonSplitPrompt = [
  "Family: comparison_split / replacement_compare",
  "Demo source: SVU01PlanDemo.tsx.",
  "Use for normal vs patient, wrong vs right, before vs after, or spending/behavior contrasts.",
  "Composition: two symmetric panels enter from opposite sides; central connector/VS; final conclusion lock.",
  "Motion: mirrored slide-in, VS pop, warning pulse on losing/risk side, conclusion lock.",
  "Required planning fields: left_subject, right_subject, comparison_axis, winner_or_warning, motion_script.",
  "Forbidden: do not let either side cross the midline; do not stack comparison items vertically if split-screen is clearer.",
].join("\n");
