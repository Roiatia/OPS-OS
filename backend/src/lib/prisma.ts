import { PrismaClient } from "@prisma/client";
import { broadcastMapsInvalidate } from "./realtimeBus.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const MAP_WRITE_OPS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  // Broadcast a "maps changed" signal after any Map write so connected
  // clients refresh immediately (polling remains as a backstop).
  return base.$extends({
    query: {
      map: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args);
          if (MAP_WRITE_OPS.has(operation)) {
            try {
              broadcastMapsInvalidate();
            } catch {
              /* never let broadcast failures break a DB write */
            }
          }
          return result;
        },
      },
    },
  });
}

// The runtime client is extended (broadcasts on Map writes), but we expose it
// typed as PrismaClient so existing call sites (e.g. interactive $transaction)
// keep their original types. The extension still runs at runtime.
export const prisma: PrismaClient =
  (globalForPrisma.prisma as PrismaClient | undefined) ??
  (createPrismaClient() as unknown as PrismaClient);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
