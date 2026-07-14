import { PrismaClient } from "@prisma/client";

/** Reuse one Prisma client across hot reloads in development. */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/** Shared database client for the API. */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
