import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    ...(
      {
        environmentMatchGlobs: [
          ["components/**", "jsdom"],
          ["app/**/*.test.tsx", "jsdom"],
        ],
      } as Record<string, unknown>
    ),
  },
});
