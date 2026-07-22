import type { MapPhase, MapRecord } from "../types";

export type PipelineStage = "UPLOAD" | "MAPPING" | "POLISH" | "ACTIVATION";

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  UPLOAD: "Upload",
  MAPPING: "Mapping",
  POLISH: "Polish",
  ACTIVATION: "Activation",
};

/** CSV Polish column — "Done" means polish work is complete. */
export function isPolishStageDone(polishStage: string | null | undefined): boolean {
  return (polishStage ?? "").trim().toLowerCase() === "done";
}

/** True when Activation date is today or earlier (date-only compare). */
export function isActivationDatePast(
  activationAt: string | Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!activationAt) return false;
  const act = new Date(activationAt);
  if (Number.isNaN(act.getTime())) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  act.setHours(0, 0, 0, 0);
  return act.getTime() <= today.getTime();
}

export function getPipelineStageFromPhase(phase: MapPhase): PipelineStage {
  switch (phase) {
    case "INTAKE":
    case "PREP":
    case "UPLOAD_REVIEW":
      return "UPLOAD";
    case "FIELD":
      return "MAPPING";
    case "POLISH":
    case "QA_REVIEW":
      return "POLISH";
    case "APPROVED":
      return "ACTIVATION";
    default:
      return "UPLOAD";
  }
}

/**
 * Pipeline for board display / dropdown:
 * - Activation date today/past → Activation
 * - Polish "Done" and no activation date → Polish
 * - else from map phase
 */
export function getPipelineStage(mapOrPhase: MapRecord | MapPhase): PipelineStage {
  if (typeof mapOrPhase === "string") {
    return getPipelineStageFromPhase(mapOrPhase);
  }
  const map = mapOrPhase;
  if (map.phase === "CANCELLED") return getPipelineStageFromPhase(map.phase);
  if (isActivationDatePast(map.activationAt)) return "ACTIVATION";
  if (isPolishStageDone(map.polishStage) && !map.activationAt) return "POLISH";
  return getPipelineStageFromPhase(map.phase);
}

export function isUploadStageComplete(map: MapRecord): boolean {
  return map.uploadApproved && map.uploadCompletedAt != null;
}


/** Field-work completion chip for Mapping stage only. */
export function getMappingCompletionLabel(map: MapRecord): "Complete" | "Incomplete" | null {
  if (getPipelineStage(map) !== "MAPPING") return null;
  return map.fieldWorkStatus === "COMPLETED" ? "Complete" : "Incomplete";
}

export function getPipelineStageLabel(map: MapRecord): string {
  if (map.phase === "CANCELLED") return "Cancelled";
  const stage = getPipelineStage(map);
  if (stage === "UPLOAD" && map.phase === "INTAKE") {
    return map.releasedToGraphics ? "Upload · with graphics" : "Upload · awaiting graphics";
  }
  if (stage === "MAPPING") {
    if (map.fieldWorkStatus === "COMPLETED") return "Mapping · complete";
    return "Mapping · in field";
  }
  if (stage === "POLISH") {
    return `Polish · ${map.phase === "QA_REVIEW" ? "QA review" : "graphics"}`;
  }
  if (stage === "ACTIVATION") return "Activation";
  return PIPELINE_STAGE_LABELS[stage];
}
