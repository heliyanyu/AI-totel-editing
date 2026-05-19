export const closedLoopBoardPrompt = [
  "Family: closed_loop_board",
  "Demo sources: SVU05Motion.tsx, SVU05PlanDemo.tsx, svu05-motion-plan.ts.",
  "Use when one topic/behavior is corrected or explained through a closed loop.",
  "Composition: left side = structure/board; right side = subject/evidence material.",
  "Motion: StackReveal for nodes; MagicMove for persistent subject; Fold old board when critical evidence/data enters; active node highlight.",
  "Required planning fields: board_title, loop_nodes, active_node_by_beat, main_subject, fold_rules, evidence_slot, motion_script.",
  "Forbidden: do not make every beat a new card page; do not cover evidence material with text; do not use equal-size sentence cards.",
].join("\n");
