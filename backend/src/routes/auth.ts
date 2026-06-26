import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { RoleName } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { authMiddleware, signToken, type AuthedRequest } from "../middleware/auth.js";
import { ROLE_LABELS } from "../lib/types.js";

const router = Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const demoMode = process.env.DEMO_MODE === "true";

router.get("/config", (_req, res) => {
  res.json({
    demoMode,
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  });
});

router.post("/google", async (req, res) => {
  const { credential } = req.body as { credential?: string };
  if (!credential) {
    res.status(400).json({ error: "Missing credential" });
    return;
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    res.status(400).json({ error: "Google sign-in not configured" });
    return;
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      res.status(401).json({ error: "Invalid Google token" });
      return;
    }

    let user = await prisma.user.findUnique({
      where: { email: payload.email },
      include: { roles: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: payload.email,
          name: payload.name ?? payload.email,
          avatarUrl: payload.picture,
          googleId: payload.sub,
          roles: { create: { role: RoleName.MAPPING_INSPECTOR } },
        },
        include: { roles: true },
      });
    } else if (!user.googleId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId: payload.sub, avatarUrl: payload.picture ?? user.avatarUrl },
        include: { roles: true },
      });
    }

    const authUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      roles: user.roles.map((r) => r.role),
    };

    res.json({ token: signToken(authUser), user: authUser });
  } catch {
    res.status(401).json({ error: "Google authentication failed" });
  }
});

router.post("/demo", async (req, res) => {
  if (!demoMode) {
    res.status(403).json({ error: "Demo login disabled" });
    return;
  }

  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: "Email required" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { roles: true },
  });

  if (!user) {
    res.status(404).json({ error: "Demo user not found. Run db:seed first." });
    return;
  }

  const authUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    roles: user.roles.map((r) => r.role),
  };

  res.json({ token: signToken(authUser), user: authUser });
});

router.get("/demo-users", async (_req, res) => {
  if (!demoMode) {
    res.json([]);
    return;
  }

  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@ops-demo.local" } },
    include: { roles: true },
    orderBy: { name: "asc" },
  });

  res.json(
    users.map((u) => ({
      email: u.email,
      name: u.name,
      roles: u.roles.map((r) => ({ role: r.role, label: ROLE_LABELS[r.role] })),
    }))
  );
});

router.get("/me", authMiddleware, (req, res) => {
  res.json({ user: (req as AuthedRequest).user });
});

export default router;
