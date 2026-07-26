/**
 * Manual entrypoint: npm run db:fix-rolename
 * Same heal that runs on API boot when RoleName_new is detected.
 */
import { fixRoleNameEnumMismatch } from "../src/db/fixRoleNameEnum.ts";

const repaired = await fixRoleNameEnumMismatch();
console.log(repaired ? "Repaired RoleName_new mismatch." : "RoleName enum OK — nothing to do.");
process.exit(0);
