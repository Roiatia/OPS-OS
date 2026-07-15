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
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    // 1 === WebSocket.OPEN
    if (ws.readyState === 1) ws.send(data);
  }
}

export function broadcastMapsInvalidate() {
  broadcast({ type: "maps:invalidate" });
}
