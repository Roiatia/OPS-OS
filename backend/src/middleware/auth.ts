import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  isOpsManagerRole,
  OPS_MANAGER_ROLE_NAMES,
  userHasSuperAdminRole,
} from "../domain/roles.js";
import type { AuthUser } from "../lib/types.js";
import { env } from "../lib/env.js";

const JWT_SECRET = env.JWT_SECRET;

export type AuthedRequest = Request & { user: AuthUser };

/** Read the authenticated user off a request (set by `authMiddleware`).
 * Centralizes the cast so param-typed routes don't each trip a TS cast error. */
export function getAuthUser(req: Request): AuthUser {
  return (req as AuthedRequest).user;
}

/**
 * Short-lived in-memory cache of resolved users (id → user + roles). Every
 * authed request previously hit the DB to re-resolve roles; on a remote pooler
 * (~250ms RTT) that tax landed on every call, including the large dashboard.
 * A short TTL keeps role changes propagating quickly while collapsing the
 * per-request lookup to at most once per user per window.
 */
const USER_CACHE_TTL_MS = 30_000;
const userCache = new Map<string, { user: AuthUser; expiresAt: number }>();

/** Drop a cached user (call after role/identity mutations if needed). */
export function invalidateUserCache(userId: string): void {
  userCache.delete(userId);
}

export function signToken(user: AuthUser) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, roles: user.roles },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    return payload;
  } catch {
    return null;
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const now = Date.now();
  const cached = userCache.get(payload.id);
  if (cached && cached.expiresAt > now) {
    (req as AuthedRequest).user = cached.user;
    next();
    return;
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: payload.id },
    include: { roles: true },
  });

  if (!dbUser) {
    userCache.delete(payload.id);
    res.status(401).json({ error: "User not found" });
    return;
  }

  if (dbUser.active === false) {
    userCache.delete(payload.id);
    res.status(403).json({ error: "Account disabled" });
    return;
  }

  const authUser: AuthUser = {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    avatarUrl: dbUser.avatarUrl,
    roles: dbUser.roles.map((r) => r.role),
  };

  userCache.set(payload.id, { user: authUser, expiresAt: now + USER_CACHE_TTL_MS });
  (req as AuthedRequest).user = authUser;

  next();
}

/** Expand OPS_ADMIN → all OPS manager roles so Manager 2 has the same access */
function expandAllowedRoles(roles: RoleName[]): RoleName[] {
  const expanded = new Set<RoleName>(roles);
  if (roles.some((r) => isOpsManagerRole(r) || r === RoleName.OPS_ADMIN)) {
    for (const r of OPS_MANAGER_ROLE_NAMES) expanded.add(r);
  }
  return [...expanded];
}

export function requireRoles(...roles: RoleName[]) {
  const allowed = expandAllowedRoles(roles);
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    // Super admin bypasses every role gate — all-access by design.
    if (userHasSuperAdminRole(user)) {
      next();
      return;
    }
    if (!allowed.some((r) => user.roles.includes(r))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

/** Guard for admin-only routes (user management, feature flags, metrics). */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthedRequest).user;
  if (!userHasSuperAdminRole(user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
