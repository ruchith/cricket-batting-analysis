import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load root .env for ports
function loadRootEnv() {
  try {
    const raw = readFileSync(resolve(__dirname, "../.env"), "utf-8");
    const env: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const idx = trimmed.indexOf("=");
        if (idx > 0) {
          env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
        }
      }
    }
    return env;
  } catch {
    return {};
  }
}

export default defineConfig(({ mode }) => {
  const rootEnv = loadRootEnv();
  const backendPort = rootEnv.BACKEND_PORT ?? process.env.BACKEND_PORT ?? "8082";

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
