import { createHash, timingSafeEqual } from "crypto";
import { env } from "./env.js";

const SUPER_ADMIN_DEMO_EMAIL = "admin@ops-demo.local";

/**
 * Demo Super Admin gate uses a plaintext env secret for local simplicity.
 * Values are SHA-256 hashed before timingSafeEqual so length differences do not
 * short-circuit and comparison stays constant-time.
 *
 * Do not commit real passwords. Prefer rotating SUPER_ADMIN_PASSWORD locally.
 */
function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isSuperAdminDemoTarget(
  email: string,
  roles: Array<string>
): boolean {
  const normalized = email.trim().toLowerCase();
  if (normalized === SUPER_ADMIN_DEMO_EMAIL) return true;
  return roles.some((r) => r === "SUPER_ADMIN");
}

export function isSuperAdminPasswordConfigured(): boolean {
  return Boolean(env.SUPER_ADMIN_PASSWORD?.length);
}

/** Returns true only when configured and the provided password matches. */
export function verifySuperAdminPassword(provided: string | undefined): boolean {
  const expected = env.SUPER_ADMIN_PASSWORD;
  if (!expected) return false;
  if (typeof provided !== "string") return false;

  // Trim user input — env value is already normalized in env.ts.
  const candidate = provided.trim();
  if (!candidate) return false;

  const a = sha256(candidate);
  const b = sha256(expected);
  // SHA-256 digests are always 32 bytes; keep the length guard for safety.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export { SUPER_ADMIN_DEMO_EMAIL };
