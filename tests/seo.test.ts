import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import {
  PRIVATE_PATHS,
  PRIVATE_ROBOTS,
  PUBLIC_PATHS,
  publicMetadata,
  SITE_ORIGIN,
  SOCIAL_IMAGE,
} from "../src/lib/site";

test("sitemap contains exactly the canonical public pages, no workspace, auth or aliases", () => {
  const urls = sitemap().map((entry) => entry.url);
  assert.deepEqual(
    urls,
    PUBLIC_PATHS.map((path) => new URL(path, SITE_ORIGIN).href),
  );
  assert.equal(new Set(urls).size, urls.length);
  for (const path of [
    ...PRIVATE_PATHS,
    "/home",
    "/api/workspace",
    "/auth/callback",
  ])
    assert.ok(!urls.includes(new URL(path, SITE_ORIGIN).href));
  assert.ok(sitemap().every((entry) => !entry.lastModified));
});

test("robots advertises the production sitemap and does not block crawlers from seeing page noindex", () => {
  const policy = robots();
  assert.equal(policy.sitemap, `${SITE_ORIGIN}/sitemap.xml`);
  assert.deepEqual(policy.rules, [
    { userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] },
  ]);
  assert.deepEqual(PRIVATE_ROBOTS, { index: false, follow: false });
});

test("each public page has distinct canonical/social URLs and an honest share image", () => {
  for (const path of PUBLIC_PATHS) {
    const metadata = publicMetadata(path, "Test page", "Test description");
    assert.equal(
      metadata.alternates?.canonical,
      new URL(path, SITE_ORIGIN).href,
    );
    assert.equal(metadata.openGraph?.url, new URL(path, SITE_ORIGIN).href);
    assert.deepEqual(metadata.robots, { index: true, follow: true });
    assert.deepEqual(metadata.twitter?.images, [SOCIAL_IMAGE]);
  }
});

test("social and Apple icons have actual PNG dimensions and favicon has valid multi-size PNG entries", async () => {
  for (const [path, width, height] of [
    ["public/og-image.png", 1200, 630],
    ["public/apple-touch-icon.png", 180, 180],
  ] as const) {
    const png = await readFile(path);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
  const ico = await readFile("public/favicon.ico");
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 4);
  for (let i = 0; i < 4; i++) {
    const offset = ico.readUInt32LE(6 + i * 16 + 12);
    assert.equal(
      ico.subarray(offset, offset + 8).toString("hex"),
      "89504e470d0a1a0a",
    );
  }
});
