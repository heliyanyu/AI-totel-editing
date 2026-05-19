import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROMPT_DOC_PATH = "docs/visual-unit-cutter-prompt-v1.md";

function section(markdown: string, heading: string, nextHeading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`Prompt section not found: ${heading}`);
  const bodyStart = start + heading.length;
  const end = markdown.indexOf(nextHeading, bodyStart);
  return markdown.slice(bodyStart, end < 0 ? undefined : end).trim();
}

export function loadVisualUnitCutterPromptDoc(projectRoot = process.cwd()): string {
  return readFileSync(resolve(projectRoot, PROMPT_DOC_PATH), "utf-8");
}

export function buildVisualUnitCutterMessages(blueprintSummary: unknown, projectRoot = process.cwd()) {
  const doc = loadVisualUnitCutterPromptDoc(projectRoot);
  const systemPrompt = section(doc, "## System Prompt", "---\n\n## User Prompt Template");
  const userTemplateAndRules = doc
    .slice(doc.indexOf("## User Prompt Template"))
    .replace("{{BLUEPRINT_SUMMARY_JSON}}", JSON.stringify(blueprintSummary, null, 2));

  return [
    {
      role: "system" as const,
      content: systemPrompt,
    },
    {
      role: "user" as const,
      content: userTemplateAndRules,
    },
  ];
}
