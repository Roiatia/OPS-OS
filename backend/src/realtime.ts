import type { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer } from "ws";
import { verifyToken } from "./middleware/auth.js";
import { addClient, removeClient } from "./lib/realtimeBus.js";

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

/** Attach the /api/ws WebSocket endpoint used for live map updates. */
export function attachRealtime(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", (ws, req) => {
    const token = tokenFromRequest(req);
    if (!token || !verifyToken(token)) {
      ws.close(4401, "Unauthorized");
      return;
    }

    addClient(ws);
    ws.on("close", () => removeClient(ws));
    ws.on("error", () => removeClient(ws));
  });

  return wss;
}
