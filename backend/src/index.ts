import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import mapsRoutes from "./routes/maps.js";

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"], credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, demoMode: process.env.DEMO_MODE === "true" });
});

app.use("/api/auth", authRoutes);
app.use("/api/maps", mapsRoutes);

app.listen(port, () => {
  console.log(`OPS-OS API running on http://localhost:${port}`);
});
