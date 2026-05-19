import type { PresentationFamily } from "../../schema";

import { actionPathPrompt } from "./action-path";
import { closedLoopBoardPrompt } from "./closed-loop-board";
import { comparisonSplitPrompt } from "./comparison-split";
import { conceptBalancePrompt } from "./concept-balance";
import { dataPopPrompt } from "./data-pop";
import { decisionTreePrompt } from "./decision-tree";
import { kineticTitlePrompt } from "./kinetic-title";
import { mechanismWarningPrompt } from "./mechanism-warning";

const fallbackPrompt = [
  "Family: fallback structural board",
  "Use the closest demo pattern. Keep one main reading goal, fold extra elements, avoid static page-by-page card decks.",
].join("\n");

export function familyPrompt(family: PresentationFamily): string {
  if (family === "closed_loop_board") return closedLoopBoardPrompt;
  if (family === "mechanism_warning" || family === "mechanism_chain" || family === "risk_stack") {
    return mechanismWarningPrompt;
  }
  if (family === "action_path" || family === "value_summary") return actionPathPrompt;
  if (family === "kinetic_title" || family === "object_shock_title" || family === "pivot_title") {
    return kineticTitlePrompt;
  }
  if (family === "data_pop" || family === "overview_data") return dataPopPrompt;
  if (family === "decision_tree") return decisionTreePrompt;
  if (family === "comparison_split" || family === "replacement_compare") return comparisonSplitPrompt;
  if (family === "concept_balance") return conceptBalancePrompt;
  return fallbackPrompt;
}
