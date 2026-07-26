import { z } from "zod";

/**
 * Centralized, validated environment configuration.
 *
 * Parsed once at import time. In production the process fails fast (throws) if
 * required secrets like JWT_SECRET are missing. Outside production a dev
 * fallback secret is allowed but a warning is logged so it is never silently
 * relied upon.
 */

const DEV_JWT_SECRET = "dev-secret";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  JWT_SECRET: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  PORT: z.coerce.number().default(3001),
  DEMO_MODE: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  ALLOWED_EMAIL_DOMAINS: z.string().optional(),
  /**
   * Plaintext password required for Super Admin demo login (DEMO_MODE only).
   * Local/demo convenience — never commit a real value. Compared via SHA-256 +
   * timingSafeEqual. If unset, Super Admin demo login returns 503.
   */
  SUPER_ADMIN_PASSWORD: z.string().optional(),
});

const parsed = envSchema.parse(process.env);

const isProduction = parsed.NODE_ENV === "production";

/**
 * Resolve the JWT secret with fail-fast semantics:
 *  - production: JWT_SECRET is required and must be non-empty, otherwise throw.
 *  - non-production: fall back to a dev secret but warn loudly.
 */
function resolveJwtSecret(): string {
  const secret = parsed.JWT_SECRET?.trim();
  if (secret) return secret;

  if (isProduction) {
    throw new Error(
      "JWT_SECRET is required in production but is missing or empty. " +
        "Set JWT_SECRET to a strong random value before starting the server."
    );
  }

  console.warn(
    "[env] JWT_SECRET is not set — falling back to an insecure dev secret. " +
      "This is only allowed outside production."
  );
  return DEV_JWT_SECRET;
}

const jwtSecret = resolveJwtSecret();

/**
 * Demo mode is only ever active outside production, even if DEMO_MODE=true is
 * accidentally left set in a production environment.
 */
const demoMode = parsed.DEMO_MODE === "true" && !isProduction;

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Normalize a secret from .env: trim whitespace and strip a single pair of
 * surrounding quotes when a loader left them in the value.
 */
function normalizeEnvSecret(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  let v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }
  return v.length > 0 ? v : undefined;
}

export const env = {
  ...parsed,
  isProduction,
  JWT_SECRET: jwtSecret,
  jwtSecret,
  demoMode,
  SUPER_ADMIN_PASSWORD: normalizeEnvSecret(parsed.SUPER_ADMIN_PASSWORD),
  corsOrigins: parseCsv(parsed.CORS_ORIGINS),
  allowedEmailDomains: parseCsv(parsed.ALLOWED_EMAIL_DOMAINS).map((d) =>
    d.toLowerCase()
  ),
};

export type Env = typeof env;
