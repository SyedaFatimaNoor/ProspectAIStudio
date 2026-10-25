import { chromium } from "@playwright/test";
import binary from "@sparticuz/chromium";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: await binary.executablePath(),
  args: binary.args.filter((a) => a !== "--single-process"),
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023/lib" },
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
await mkdir("test-results/ui-review", { recursive: true });
for (const path of [
  "/",
  "/overview",
  "/discovery",
  "/leads",
  "/verification",
  "/studio",
  "/outreach",
  "/settings",
  "/sign-in",
]) {
  await page.goto(`http://127.0.0.1:3000${path}`, { waitUntil: "networkidle" });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  console.log(
    path,
    JSON.stringify(
      result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes
          .slice(0, 4)
          .map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    ),
  );
  await page.screenshot({
    path: `test-results/ui-review/${path.slice(1) || "home"}.png`,
    fullPage: true,
  });
}
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("http://127.0.0.1:3000/discovery", {
  waitUntil: "networkidle",
});
await page.screenshot({
  path: "test-results/ui-review/mobile-discovery.png",
  fullPage: true,
});
await browser.close();
