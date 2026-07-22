import { RoleName, MapPhase } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../lib/types.js";

/** Layer 2 tests only run when a disposable test database is configured. */
export const hasTestDb = Boolean(process.env.DATABASE_URL_TEST);

/**
 * Wipe every table the workflow touches, children before parents, so each test
 * starts from a clean slate. Cheap on the tiny per-test datasets we create.
 */
export async function resetDb() {
  await prisma.mapEvent.deleteMany();
  await prisma.mapPhaseHistory.deleteMany();
  await prisma.mapAttachment.deleteMany();
  await prisma.mapNote.deleteMany();
  await prisma.task.deleteMany();
  await prisma.map.deleteMany();
  await prisma.user.deleteMany();
}

let userSeq = 0;

/** Create a user with the given roles and return an AuthUser view of them. */
export async function createUser(roles: RoleName[], name?: string): Promise<AuthUser> {
  userSeq += 1;
  const label = name ?? `user${userSeq}`;
  const user = await prisma.user.create({
    data: {
      email: `${label}-${userSeq}@test.local`,
      name: label,
      roles: { create: roles.map((role) => ({ role })) },
    },
  });
  return { id: user.id, email: user.email, name: user.name, avatarUrl: null, roles };
}

/** Create a map in the requested phase (INTAKE by default). */
export async function createMap(
  overrides: Partial<{
    mapNumber: string;
    client: string;
    phase: MapPhase;
    assignedInspectorId: string | null;
    assignedQaId: string | null;
    uploadApproved: boolean;
    uploadCompletedAt: Date | null;
  }> = {}
) {
  const seq = Math.floor(Math.random() * 1_000_000);
  return prisma.map.create({
    data: {
      mapNumber: overrides.mapNumber ?? `MAP-TEST-${seq}`,
      client: overrides.client ?? "Acme",
      phase: overrides.phase ?? MapPhase.INTAKE,
      assignedInspectorId: overrides.assignedInspectorId ?? null,
      assignedQaId: overrides.assignedQaId ?? null,
      uploadApproved: overrides.uploadApproved ?? false,
      uploadCompletedAt: overrides.uploadCompletedAt ?? null,
    },
  });
}
