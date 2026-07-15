import { MapPhase } from "@prisma/client";

/** Business pipeline: Upload → Mapping → Polish → Activation */
export type PipelineStage = "UPLOAD" | "MAPPING" | "POLISH" | "ACTIVATION";

export const PIPELINE_STAGE_ORDER: PipelineStage[] = [
  "UPLOAD",
  "MAPPING",
  "POLISH",
  "ACTIVATION",
];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  UPLOAD: "Upload",
  MAPPING: "Mapping",
  POLISH: "Polish",
  ACTIVATION: "Activation",
};

export function getPipelineStage(phase: MapPhase): PipelineStage {
  switch (phase) {
    case MapPhase.INTAKE:
    case MapPhase.PREP:
    case MapPhase.UPLOAD_REVIEW:
      return "UPLOAD";
    case MapPhase.FIELD:
      return "MAPPING";
    case MapPhase.POLISH:
    case MapPhase.QA_REVIEW:
      return "POLISH";
    case MapPhase.APPROVED:
      return "ACTIVATION";
    default:
      return "UPLOAD";
  }
}

export function isUploadStageComplete(map: {
  uploadApproved: boolean;
  uploadCompletedAt?: Date | null;
}): boolean {
  return map.uploadApproved && map.uploadCompletedAt != null;
}

/** Mapping (field) is only valid after graphics upload is on the dashboard. */
export function assertUploadCompleteForMapping(map: {
  phase: MapPhase;
  uploadApproved: boolean;
  uploadCompletedAt?: Date | null;
  mapNumber?: string;
}): void {
  if (map.phase !== MapPhase.FIELD) return;
  if (isUploadStageComplete(map)) return;
  const label = map.mapNumber ? `Map ${map.mapNumber}` : "This map";
  throw new Error(
    `${label} cannot be in mapping until the upload stage is complete (dashboard upload approved by graphics).`
  );
}
