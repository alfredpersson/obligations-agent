import { defineConfig } from "@playwright/test";

// Starts the service and the web app, runs the browser tests against them, and stops both.
export default defineConfig({
  testDir: "e2e",
  // Vitest runs files named *.test.ts and *.spec.ts, so the browser tests use another name.
  testMatch: "*.e2e.ts",
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: [
    {
      command: "uv run uvicorn obligations_agent.server:app --port 8000",
      cwd: "../api",
      url: "http://127.0.0.1:8000/schema",
      reuseExistingServer: !process.env.CI,
    },
    {
      // Port 3100, so that the test does not collide with a running `pnpm dev` on port 3000.
      command: "pnpm build && pnpm start --port 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
