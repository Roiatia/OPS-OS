import type { MapPhase, MapRecord } from "../types";

export type PipelineStage = "UPLOAD" | "MAPPING" | "POLISH" | "ACTIVATION";

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  UPLOAD: "Upload",
  MAPPING: "Mapping",
  POLISH: "Polish",
  ACTIVATION: "Activation",
};

export function getPipelineStage(phase: MapPhase): PipelineStage {
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

export function isUploadStageComplete(map: MapRecord): boolean {
  return map.uploadApproved && map.uploadCompletedAt != null;
}

export function getPipelineStageLabel(map: MapRecord): string {
  const stage = getPipelineStage(map.phase);
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
