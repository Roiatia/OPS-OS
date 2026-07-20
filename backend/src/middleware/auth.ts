import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { isOpsManagerRole, OPS_MANAGER_ROLE_NAMES } from "../domain/roles.js";
import { effectivePermissions } from "../domain/permissions.js";
import type { AuthUser } from "../lib/types.js";
import { env } from "../lib/env.js";

const JWT_SECRET = env.JWT_SECRET;

export type AuthedRequest = Request & { user: AuthUser };

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

  const dbUser = await prisma.user.findUnique({
    where: { id: payload.id },
    include: { roles: true, permissionOverrides: true },
  });

  if (!dbUser) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const roles = dbUser.roles.map((r) => r.role);

  (req as AuthedRequest).user = {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    avatarUrl: dbUser.avatarUrl,
    roles,
    permissions: effectivePermissions(
      roles,
      dbUser.permissionOverrides.map((o) => ({
        permission: o.permission,
        granted: o.granted,
      }))
    ),
  };

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
    if (!allowed.some((r) => user.roles.includes(r))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
