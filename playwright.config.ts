import { defineConfig } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const require = createRequire(import.meta.url);

// @sparticuz/chromium ships a Linux (Al2023) build only. It is the right
// choice for the containerised CI run, but cannot launch on Windows or macOS,
// where every spec would otherwise fail at browser launch rather than at an
// assertion. Off Linux we fall back to Playwright's own bundled Chromium.
const useSparticuz = process.platform === "linux";
const launchOptions = await (async () => {
  if (!useSparticuz) return {};
  const { default: chromium, inflate } = await import("@sparticuz/chromium");
  const binaryRoot = resolve(
    dirname(require.resolve("@sparticuz/chromium")),
    "../bin",
  );
  await inflate(resolve(binaryRoot, "al2023.tar.br"));
  return {
    executablePath: await chromium.executablePath(),
    args: chromium.args.filter(
      (a) => !a.includes("disable-web-security") && a !== "--single-process",
    ),
    env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023/lib" },
  };
})();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    launchOptions,
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
