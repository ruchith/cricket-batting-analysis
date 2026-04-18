import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { readFileSync } from "fs";
import { resolve } from "path";

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

export default defineConfig(() => {
  const rootEnv = loadRootEnv();
  const backendPort = rootEnv.BACKEND_PORT ?? process.env.BACKEND_PORT ?? "8082";

  return {
    plugins: [react()],
    css: {
      postcss: {
        plugins: [
          tailwindcss({
            darkMode: "class",
            content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
            theme: {
              extend: {
                colors: {
                  pitch: {
                    50: "#f0fdf4",
                    100: "#dcfce7",
                    500: "#22c55e",
                    700: "#15803d",
                    900: "#14532d",
                  },
                },
              },
            },
            plugins: [],
          }),
          autoprefixer(),
        ],
      },
    },
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
