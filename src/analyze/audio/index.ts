export {
  SYSTEM_PROMPT_TAKE_PASS,
  buildUserPromptTakePass,
  parseMarkedTakePass,
  normalizeTakePassResult,
  toLegacyTakePassResult,
  type TakePassDiscardRange,
  type TakePassResult,
  type TakePassTake,
} from "./take-pass.js";

export { applyTakePass } from "./span-builder.js";
