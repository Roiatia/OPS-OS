import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { MapPhase, RoleName, InspectorStatus, QaStatus } from "@prisma/client";
import * as workflow from "../workflow.js";
import { prisma } from "../../lib/prisma.js";
import { hasTestDb, resetDb, createUser, createMap } from "../../test/db.js";

// These integration tests need a real disposable Postgres. When DATABASE_URL_TEST
// is not set they skip, so the rest of the suite (pure logic) still runs.
const suite = hasTestDb ? describe : describe.skip;

suite("workflow map lifecycle", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("assignInspector", () => {
    it("moves an intake map to PREP with the inspector attached", async () => {
      const leader = await createUser([RoleName.GRAPHIC_TEAM_LEADER]);
      const inspector = await createUser([RoleName.MAPPING_INSPECTOR]);
      const map = await createMap({ phase: MapPhase.INTAKE });

      const updated = await workflow.assignInspector(map.id, inspector.id, leader);

      expect(updated?.phase).toBe(MapPhase.PREP);
      expect(updated?.assignedInspectorId).toBe(inspector.id);
      expect(updated?.inspectorStatus).toBeNull();
    });
  });

  describe("updateInspectorStatus", () => {
    it("DONE in PREP advances to UPLOAD_REVIEW", async () => {
      const inspector = await createUser([RoleName.MAPPING_INSPECTOR]);
      const map = await createMap({ phase: MapPhase.PREP, assignedInspectorId: inspector.id });

      const updated = await workflow.updateInspectorStatus(
        map.id,
        InspectorStatus.DONE,
        inspector
      );

      expect(updated?.phase).toBe(MapPhase.UPLOAD_REVIEW);
      expect(updated?.inspectorStatus).toBe(InspectorStatus.DONE);
    });

    it("DONE in POLISH advances to QA_REVIEW and clears qaStatus", async () => {
      const inspector = await createUser([RoleName.MAPPING_INSPECTOR]);
      const map = await createMap({ phase: MapPhase.POLISH, assignedInspectorId: inspector.id });

      const updated = await workflow.updateInspectorStatus(
        map.id,
        InspectorStatus.DONE,
        inspector
      );

      expect(updated?.phase).toBe(MapPhase.QA_REVIEW);
      expect(updated?.qaStatus).toBeNull();
    });

    it("rejects an inspector who is not assigned to the map", async () => {
      const owner = await createUser([RoleName.MAPPING_INSPECTOR]);
      const other = await createUser([RoleName.MAPPING_INSPECTOR]);
      const map = await createMap({ phase: MapPhase.PREP, assignedInspectorId: owner.id });

      await expect(
        workflow.updateInspectorStatus(map.id, InspectorStatus.PROCESSING, other)
      ).rejects.toThrow(/Not assigned/);
    });

    it("lets the graphics team leader override status on any map", async () => {
      const leader = await createUser([RoleName.GRAPHIC_TEAM_LEADER]);
      const inspector = await createUser([RoleName.MAPPING_INSPECTOR]);
      const map = await createMap({ phase: MapPhase.PREP, assignedInspectorId: inspector.id });

      const updated = await workflow.updateInspectorStatus(
        map.id,
        InspectorStatus.PROCESSING,
        leader
      );

      expect(updated?.inspectorStatus).toBe(InspectorStatus.PROCESSING);
    });
  });

  describe("qaUploadDecision", () => {
    it("approval sends the map to FIELD and marks the upload complete", async () => {
      const qa = await createUser([RoleName.GRAPHIC_QA]);
      const map = await createMap({ phase: MapPhase.UPLOAD_REVIEW });

      const updated = await workflow.qaUploadDecision(map.id, true, qa);

      expect(updated?.phase).toBe(MapPhase.FIELD);
      expect(updated?.uploadApproved).toBe(true);
      expect(updated?.uploadCompletedAt).not.toBeNull();
    });

    it("rejection sends the map back to PREP", async () => {
      const qa = await createUser([RoleName.GRAPHIC_QA]);
      const map = await createMap({ phase: MapPhase.UPLOAD_REVIEW });

      const updated = await workflow.qaUploadDecision(map.id, false, qa);

      expect(updated?.phase).toBe(MapPhase.PREP);
      expect(updated?.uploadApproved).toBe(false);
    });
  });

  describe("qaPolishDecision", () => {
    it("fix returns the map to POLISH with an open fix request", async () => {
      const qa = await createUser([RoleName.GRAPHIC_QA]);
      const map = await createMap({ phase: MapPhase.QA_REVIEW });

      const updated = await workflow.qaPolishDecision(map.id, "fix", qa);

      expect(updated?.phase).toBe(MapPhase.POLISH);
      expect(updated?.qaStatus).toBe(QaStatus.FIX);
      expect(updated?.inspectorStatus).toBe(InspectorStatus.ACCEPTED);
    });

    it("fix_done moves an open fix back into QA_REVIEW", async () => {
      const inspector = await createUser([RoleName.MAPPING_INSPECTOR]);
      const map = await createMap({
        phase: MapPhase.POLISH,
        assignedInspectorId: inspector.id,
      });
      await prisma.map.update({ where: { id: map.id }, data: { qaStatus: QaStatus.FIX } });

      const updated = await workflow.qaPolishDecision(map.id, "fix_done", inspector);

      expect(updated?.phase).toBe(MapPhase.QA_REVIEW);
      expect(updated?.qaStatus).toBe(QaStatus.FIX_DONE);
    });

    it("approved finalizes the map", async () => {
      const qa = await createUser([RoleName.GRAPHIC_QA]);
      const map = await createMap({ phase: MapPhase.QA_REVIEW });

      const updated = await workflow.qaPolishDecision(map.id, "approved", qa);

      expect(updated?.phase).toBe(MapPhase.APPROVED);
      expect(updated?.qaStatus).toBe(QaStatus.APPROVED);
    });
  });

  describe("setMapStatusAsLeader", () => {
    it("dispatches an inspector action as the leader override", async () => {
      const leader = await createUser([RoleName.GRAPHIC_TEAM_LEADER]);
      const inspector = await createUser([RoleName.MAPPING_INSPECTOR]);
      const map = await createMap({ phase: MapPhase.PREP, assignedInspectorId: inspector.id });

      const updated = await workflow.setMapStatusAsLeader(
        map.id,
        { kind: "inspector", status: InspectorStatus.DONE },
        leader
      );

      expect(updated?.phase).toBe(MapPhase.UPLOAD_REVIEW);
      expect(updated?.inspectorStatus).toBe(InspectorStatus.DONE);
    });

    it("rejects a non-leader caller", async () => {
      const qa = await createUser([RoleName.GRAPHIC_QA]);
      const map = await createMap({ phase: MapPhase.PREP });

      await expect(
        workflow.setMapStatusAsLeader(
          map.id,
          { kind: "inspector", status: InspectorStatus.ACCEPTED },
          qa
        )
      ).rejects.toThrow(/graphics team leader/i);
    });
  });

  describe("cancelMap", () => {
    it("moves any active map to CANCELLED", async () => {
      const leader = await createUser([RoleName.GRAPHIC_TEAM_LEADER]);
      const map = await createMap({ phase: MapPhase.PREP });

      const updated = await workflow.cancelMap(map.id, leader, "no longer needed");

      expect(updated?.phase).toBe(MapPhase.CANCELLED);
    });
  });
});
