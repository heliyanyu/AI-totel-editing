export const conceptBalancePrompt = [
  "Family: concept_balance",
  "Demo source: SVU14PlanDemo.tsx.",
  "Use for balance/range concepts such as too high vs too low and stable target zones.",
  "Composition: gauge/balance model is the conceptual core; extremes sit left/right; safe zone glows center.",
  "Motion: gauge draw, needle sweep, safe zone glow, final settle.",
  "Required planning fields: left_extreme, right_extreme, safe_zone, needle_motion, final_message, motion_script.",
  "Forbidden: do not reduce the idea to a list; the model must carry the explanation.",
].join("\n");
