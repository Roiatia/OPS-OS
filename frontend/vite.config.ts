import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code into its own long-cacheable chunk
        // so the app bundle stays small and dependency updates don't bust it.
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "query-vendor": ["@tanstack/react-query"],
          "google-oauth": ["@react-oauth/google"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
      "/api": "http://localhost:3001",
    },
  },
});
