// Reproducible brand assets, generated locally. No AI imagery, remote fonts,
// network requests, fabricated metrics, credentials or runtime asset dependencies.
import { chromium as playwright } from "@playwright/test";
import chromium, { inflate } from "@sparticuz/chromium";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const binaryRoot = resolve(
  dirname(require.resolve("@sparticuz/chromium")),
  "../bin",
);
await inflate(resolve(binaryRoot, "al2023.tar.br"));
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>ProspectAI</title><rect width="64" height="64" rx="15" fill="#141d30"/><g fill="none" stroke="#ffffff" stroke-width="2.5"><ellipse cx="32" cy="32" rx="23" ry="9" transform="rotate(-35 32 32)"/><ellipse cx="32" cy="32" rx="9" ry="23" transform="rotate(-35 32 32)"/></g><circle cx="32" cy="32" r="5" fill="#8fa7ff"/><circle cx="48.5" cy="18" r="3.5" fill="#8fa7ff"/></svg>`;
await mkdir("public", { recursive: true });
await writeFile("public/icon.svg", mark + "\n");
const font = await readFile(
  require.resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
);
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(
    (a) => !a.includes("disable-web-security") && a !== "--single-process",
  ),
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023/lib" },
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.route(/^https?:/, (route) => route.abort());
  const images = [];
  for (const size of [16, 32, 48, 64, 180]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${mark}`,
    );
    const png = await page.screenshot({ type: "png", omitBackground: true });
    if (size === 180) await writeFile("public/apple-touch-icon.png", png);
    else images.push({ size, png });
  }
  // ICO directory containing PNG-encoded images, supported by modern browsers.
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const at = 6 + i * 16;
    header[at] = size;
    header[at + 1] = size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  await writeFile(
    "public/favicon.ico",
    Buffer.concat([header, ...images.map((i) => i.png)]),
  );
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    @font-face{font-family:Inter;src:url(data:font/woff2;base64,${font.toString("base64")}) format('woff2');font-weight:100 900}
    *{box-sizing:border-box}body{margin:0;background:#141d30;color:#fff;font-family:Inter,sans-serif}
    main{height:630px;padding:54px 66px;position:relative;overflow:hidden}
    .brand{display:flex;align-items:center;gap:14px;font-size:32px;font-weight:650;letter-spacing:-1px}
    .brand svg{width:52px;height:52px}.brand span{color:#a8baff}
    .eyebrow{margin-top:42px;color:#b5c4ff;font-size:16px;font-weight:650;letter-spacing:2.4px}
    h1{margin:20px 0 24px;font-size:70px;line-height:1.1;letter-spacing:-3px;font-weight:650;position:relative;z-index:1}
    h1 span{color:#a8baff}.description{font-size:24px;line-height:1.5;color:#e0e5f0;max-width:840px;position:relative;z-index:1}
    footer{position:absolute;bottom:42px;left:66px;right:66px;display:flex;justify-content:space-between;border-top:1px solid #394358;padding-top:22px;color:#c4cede;font-size:17px}
    .orbit{position:absolute;right:-160px;top:75px;width:500px;height:500px;opacity:.14;transform:rotate(12deg)}
  </style></head><body><main>
    <div class="orbit">${mark}</div>
    <div class="brand">${mark}<div>Prospect<span>AI</span>.</div></div>
    <div class="eyebrow">EVIDENCE-FIRST BUSINESS RESEARCH</div>
    <h1>Find the overlooked.<br><span>See the opportunity.</span></h1>
    <div class="description">Real public sources. Human review.<br>Thoughtful proposals. Draft-only outreach.</div>
    <footer><span>Discover potential. Build real connections.</span><span>prospectaistudio.vercel.app</span></footer>
  </main></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "public/og-image.png", type: "png" });
  await page.close();
} finally {
  await browser.close();
}
console.log(
  "Generated icon.svg, multi-size favicon.ico, apple-touch-icon.png (180×180), og-image.png (1200×630).",
);
