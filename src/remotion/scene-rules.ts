import type { VisualSegmentPlan } from "../compose/visual-planner";

export function isVoiceoverOnlySegment(segment: VisualSegmentPlan | null | undefined): boolean {
  return segment?.voiceoverOnly === true;
}

export function getSegmentRole(segment: VisualSegmentPlan | null | undefined): string {
  return segment?.role ?? "analysis";
}

export function getSegmentTone(segment: VisualSegmentPlan | null | undefined): string {
  return segment?.tone ?? "brand";
}
