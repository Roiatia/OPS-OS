import type { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { verifyToken } from "./middleware/auth.js";

export type RealtimeMessage =
  | { type: "maps:upsert"; maps: unknown[] }
  | { type: "maps:deleted"; mapIds: string[] }
  | { type: "maps:invalidate" };

const clients = new Set<WebSocket>();

function send(ws: WebSocket, msg: RealtimeMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function broadcast(msg: RealtimeMessage) {
  for (const ws of clients) {
    send(ws, msg);
  }
}

export function broadcastMapsUpsert(maps: unknown[]) {
  if (maps.length === 0) return;
  broadcast({ type: "maps:upsert", maps });
}

export function broadcastMapsDeleted(mapIds: string[]) {
  if (mapIds.length === 0) return;
  broadcast({ type: "maps:deleted", mapIds });
}

export function broadcastMapsInvalidate() {
  broadcast({ type: "maps:invalidate" });
}

function tokenFromRequest(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? "", "http://localhost");
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;

  const proto = req.headers["sec-websocket-protocol"];
  if (typeof proto === "string" && proto.startsWith("bearer.")) {
    return proto.slice("bearer.".length);
  }
  return null;
}

export function attachRealtime(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", (ws, req) => {
    const token = tokenFromRequest(req);
    if (!token || !verifyToken(token)) {
      ws.close(4401, "Unauthorized");
      return;
    }

    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  return wss;
}
