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

export function broadcast(msg: RealtimeMessage) {
  if (clients.size === 0) return;
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    // 1 === WebSocket.OPEN
    if (ws.readyState === 1) ws.send(data);
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
