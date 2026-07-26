/**
 * Manual entrypoint: npm run db:fix-rolename
 * Same heal that runs on API boot — aligns columns onto RoleName_new
 * (preserves SUPER_ADMIN; restores admin@ops-demo.local if remapped).
 */
import { fixRoleNameEnumMismatch } from "../src/db/fixRoleNameEnum.ts";

const repaired = await fixRoleNameEnumMismatch();
console.log(
  repaired
    ? "Aligned role columns onto RoleName_new."
    : "RoleName_new already aligned — nothing to do."
);
process.exit(0);
