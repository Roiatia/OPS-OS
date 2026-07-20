import type { PrismaClient, RoleName } from "@prisma/client";
import { ROLE_PERMISSIONS } from "../../src/domain/permissions.js";

/**
 * Seeds the RolePermission table from the code-level ROLE_PERMISSIONS map so the
 * admin UI can display which permissions each role grants. Idempotent.
 */
export async function seedRolePermissions(prisma: PrismaClient) {
  console.log("Seeding role permissions...");
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: {
          role_permission: { role: role as RoleName, permission },
        },
        update: {},
        create: { role: role as RoleName, permission },
      });
    }
    console.log(`  ✓ ${role} → ${permissions.length} permissions`);
  }
}
