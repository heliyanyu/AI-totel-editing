export const actionPathPrompt = [
  "Family: action_path",
  "Demo sources: SVU08PlanDemo.tsx decision/path layout.",
  "Use for steps, rules, recommended actions, or numbered prohibitions.",
  "Composition: a drawn path with nodes; current node is prominent, completed nodes fold/turn green, pending nodes are dim.",
  "Motion: path drawing first, node pop-in, active step advance, completed step fold.",
  "Required planning fields: path_steps, active_step_by_beat, recommended_action, motion_script.",
  "Forbidden: do not make pure ordinal phrases like 第二呢/第三呢 into the main screen message.",
].join("\n");
