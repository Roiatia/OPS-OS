import "dotenv/config";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { env } from "./lib/env.js";
import authRoutes from "./routes/auth.js";
import mapsRoutes from "./routes/maps.js";
import reportsRoutes from "./routes/reports.js";
import availabilityRoutes from "./routes/availability.js";
import adminUsersRoutes from "./routes/admin/users.js";
import { attachRealtime } from "./lib/realtime.js";
import {
  catchUpDailyReportIfNeeded,
  runDailyReportSchedulerTick,
} from "./services/dailyReport.js";

const app = express();
const port = env.PORT;

// Localhost defaults for dev convenience; production origins come from CORS_ORIGINS.
const LOCALHOST_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
];
const allowedOrigins = [...new Set([...env.corsOrigins, ...LOCALHOST_ORIGINS])];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, demoMode: env.demoMode });
});

app.use("/api/auth", authRoutes);
app.use("/api/maps", mapsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/admin", adminUsersRoutes);

const REPORT_SCHEDULER_MS = 60_000;

void catchUpDailyReportIfNeeded().catch((err) => {
  console.error("Daily report catch-up failed:", err);
});

setInterval(() => {
  void runDailyReportSchedulerTick().catch((err) => {
    console.error("Daily report scheduler failed:", err);
  });
}, REPORT_SCHEDULER_MS);

const server = createServer(app);
attachRealtime(server);

server.listen(port, () => {
  console.log(`OPS-OS API running on http://localhost:${port}`);
  console.log(`Realtime WebSocket on ws://localhost:${port}/api/ws`);
  console.log("Daily reports scheduled for 08:00 local time (previous day)");
});

// Crash guards: log loudly and keep the server alive rather than letting a
// stray unhandled error take down the process. In dev this matters because a
// crash would leave port 3001 dead until the next file save restarts tsx watch.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
