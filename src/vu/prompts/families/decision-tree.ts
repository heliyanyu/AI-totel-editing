export const decisionTreePrompt = [
  "Family: decision_tree",
  "Demo source: SVU08PlanDemo.tsx.",
  "Use for if/then decisions or whether a viewer should do something.",
  "Composition: root question first; branches draw out left/right; branch cards reveal after lines; recommended branch highlights last.",
  "Motion: root pop-in, branch line drawing, branch reveal, recommendation pulse.",
  "Required planning fields: root_question, branches, recommended_branch, branch_results, motion_script.",
  "Forbidden: do not show both branch conclusions before drawing the branch logic.",
].join("\n");
