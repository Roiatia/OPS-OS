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

/** CSV Polish column — "Done" means polish work is complete. */
export function isPolishStageDone(polishStage: string | null | undefined): boolean {
  return (polishStage ?? "").trim().toLowerCase() === "done";
}

/** True when Activation date is today or earlier (date-only compare). */
export function isActivationDatePast(
  activationAt: Date | string | null | undefined,
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

/**
 * Pipeline for a map, with spreadsheet overrides:
 * - Activation date today/past → Activation
 * - Polish "Done" and no activation date → Polish
 */
export function getPipelineStageForMap(map: {
  phase: MapPhase;
  polishStage?: string | null;
  activationAt?: Date | string | null;
}): PipelineStage {
  if (map.phase === MapPhase.CANCELLED) return getPipelineStageFromPhase(map.phase);
  if (isActivationDatePast(map.activationAt)) return "ACTIVATION";
  if (isPolishStageDone(map.polishStage) && !map.activationAt) return "POLISH";
  return getPipelineStageFromPhase(map.phase);
}

/** @deprecated Prefer getPipelineStageFromPhase / getPipelineStageForMap */
export function getPipelineStage(phase: MapPhase): PipelineStage {
  return getPipelineStageFromPhase(phase);
}

/**
 * After hub/CSV base phase is known, apply Polish Done / past Activation rules.
 * Past activation stays on the active board (POLISH phase) — LIVE alone archives.
 */
export function applyPolishActivationPhase(
  basePhase: MapPhase,
  opts: {
    polishStage?: string | null;
    activationAt?: Date | null;
    cancelled?: boolean;
    finished?: boolean;
  }
): MapPhase {
  if (opts.cancelled || basePhase === MapPhase.CANCELLED) return MapPhase.CANCELLED;
  if (opts.finished) return MapPhase.APPROVED;

  const polishDone = isPolishStageDone(opts.polishStage);
  const activationPast = isActivationDatePast(opts.activationAt);

  // Polish Done + no activation date → Polish pipeline
  if (polishDone && !opts.activationAt) return MapPhase.POLISH;

  // Activation date today/past → stay visible as POLISH (UI shows Activation)
  // when polish is done; otherwise leave base phase (UI still shows Activation).
  if (activationPast && polishDone) return MapPhase.POLISH;

  // Polish Done with a future activation date → still Polish
  if (polishDone && opts.activationAt && !activationPast) return MapPhase.POLISH;

  return basePhase;
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
