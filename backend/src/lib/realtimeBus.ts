import type { WebSocket } from "ws";

export type RealtimeMessage =
  | { type: "maps:upsert"; maps: unknown[] }
  | { type: "maps:deleted"; mapIds: string[] }
  | { type: "maps:invalidate" };

/**
 * Dependency-free broadcast bus shared by the WebSocket server (realtime.ts)
 * and the Prisma client (lib/prisma.ts). Kept import-free to avoid cycles.
 */
const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket) {
  clients.add(ws);
}

export function removeClient(ws: WebSocket) {
  clients.delete(ws);
}

// Bulk mutations run many Map statements in one transaction. The Prisma
// extension (lib/prisma.ts) would fire a coarse `maps:invalidate` for each of
// them, forcing clients to refetch. When a caller intends to emit its own
// surgical upsert instead, it wraps the transaction in `withSuppressedBroadcasts`
// so those per-statement signals are dropped.
let suppressDepth = 0;

export function broadcast(msg: RealtimeMessage) {
  if (suppressDepth > 0) return;
  if (clients.size === 0) return;
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    // 1 === WebSocket.OPEN
    if (ws.readyState === 1) ws.send(data);
  }
}

/**
 * Run `fn` with the automatic per-statement Map broadcasts suppressed, then let
 * queued fire-and-forget emit microtasks flush (and be dropped) before lifting
 * the suppression. Callers are expected to emit a single surgical
 * `broadcastMapsUpsert` afterwards for the exact rows they changed.
 */
export async function withSuppressedBroadcasts<T>(fn: () => Promise<T>): Promise<T> {
  suppressDepth += 1;
  try {
    const result = await fn();
    // Give the extension's queued emit microtasks a tick to run while still
    // suppressed, so their invalidate signals are swallowed.
    await Promise.resolve();
    return result;
  } finally {
    suppressDepth = Math.max(0, suppressDepth - 1);
  }
}

/** Push fully-shaped changed maps so clients can patch state without refetching. */
export function broadcastMapsUpsert(maps: unknown[]) {
  if (maps.length === 0) return;
  broadcast({ type: "maps:upsert", maps });
}

export function broadcastMapsDeleted(mapIds: string[]) {
  if (mapIds.length === 0) return;
  broadcast({ type: "maps:deleted", mapIds });
}

/** Coarse signal: clients should refetch (used for bulk / ambiguous writes). */
export function broadcastMapsInvalidate() {
  broadcast({ type: "maps:invalidate" });
}
