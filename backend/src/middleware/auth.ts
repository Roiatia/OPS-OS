import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { AuthUser } from "../lib/types.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";

export type AuthedRequest = Request & { user: AuthUser };

/** Create a JWT for the signed-in user (7-day expiry). */
export function signToken(user: AuthUser) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, roles: user.roles },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/** Decode and validate a JWT; returns null if invalid/expired. */
export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    return payload;
  } catch {
    return null;
  }
}

/** Require Bearer JWT and attach a fresh user (with roles) to the request. */
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
    include: { roles: true },
  });

  if (!dbUser) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  (req as AuthedRequest).user = {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    avatarUrl: dbUser.avatarUrl,
    roles: dbUser.roles.map((r) => r.role),
  };

  next();
}

/** Middleware factory: allow the request only if the user has one of the given roles. */
export function requireRoles(...roles: RoleName[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    if (!roles.some((r) => user.roles.includes(r))) {
      res.status(403).json({ error: "Forbidden — leader or admin role required" });
      return;
    }
    next();
  };
}
