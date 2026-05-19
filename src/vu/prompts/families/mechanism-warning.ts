export const mechanismWarningPrompt = [
  "Family: mechanism_warning",
  "Demo sources: SVU05Motion.tsx (+10% / Nucleus evidence), SVU07PlanDemo.tsx, svu07-motion-plan.ts.",
  "Use when abstract risk must become a body mechanism or damage path.",
  "Composition: mechanism path/stack is the main visual; warning styling supports the mechanism instead of replacing it.",
  "Motion: path drawing, warning pulse, red slash draw, stack/glow accumulation, risk bar rise.",
  "Required planning fields: risk_subject, mechanism_steps, warning_claim, evidence_or_source, asset_slots, motion_script.",
  "Forbidden: do not output a single red warning card; do not list risk words without causal arrows; do not put big text over evidence video.",
].join("\n");
