import { PrismaClient } from "@prisma/client";
import { mapIncludes } from "./mapIncludes.js";
import {
  broadcastMapsUpsert,
  broadcastMapsDeleted,
  broadcastMapsInvalidate,
} from "./realtimeBus.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// Single-record writes → we can broadcast the exact shaped row.
const SINGLE_WRITE_OPS = new Set(["create", "update", "upsert"]);
// Bulk / ambiguous writes → clients refetch.
const BULK_WRITE_OPS = new Set(["createMany", "updateMany", "deleteMany"]);

/**
 * After a Map write, push the change to connected clients so they can patch
 * state without refetching. Uses the unextended `base` client for the reshape
 * read so it never recurses through this extension. Fire-and-forget: broadcast
 * failures must never break the DB write.
 */
function emitMapChange(
  base: PrismaClient,
  operation: string,
  result: unknown
): void {
  void (async () => {
    try {
      const id =
        result && typeof result === "object" ? (result as { id?: string }).id : undefined;

      if (operation === "delete") {
        if (id) broadcastMapsDeleted([id]);
        else broadcastMapsInvalidate();
        return;
      }

      if (SINGLE_WRITE_OPS.has(operation)) {
        if (!id) {
          broadcastMapsInvalidate();
          return;
        }
        const shaped = await base.map.findUnique({ where: { id }, include: mapIncludes });
        if (shaped) broadcastMapsUpsert([shaped]);
        else broadcastMapsInvalidate();
        return;
      }

      if (BULK_WRITE_OPS.has(operation)) {
        broadcastMapsInvalidate();
      }
    } catch {
      try {
        broadcastMapsInvalidate();
      } catch {
        /* ignore */
      }
    }
  })();
}

function createPrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  return base.$extends({
    query: {
      map: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args);
          if (SINGLE_WRITE_OPS.has(operation) || BULK_WRITE_OPS.has(operation) || operation === "delete") {
            emitMapChange(base, operation, result);
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
