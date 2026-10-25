import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PRIVATE_PATHS, PUBLIC_PATHS, SITE_ORIGIN } from "../../src/lib/site";

test("robots, sitemap, favicon and sharing assets return real content without broken destinations", async ({
  request,
}) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(robots.headers()["content-type"]).toMatch(/text\/plain/);
  expect(await robots.text()).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  expect(urls).toEqual(
    PUBLIC_PATHS.map((path) => new URL(path, SITE_ORIGIN).href),
  );
  for (const [path, type] of [
    ["/favicon.ico", /image\//],
    ["/icon.svg", /image\/svg/],
    ["/apple-touch-icon.png", /image\/png/],
    ["/og-image.png", /image\/png/],
  ] as const) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"]).toMatch(type);
    expect((await response.body()).length).toBeGreaterThan(100);
  }
  const home = await request.get("/home", { maxRedirects: 0 });
  expect(home.status()).toBe(308);
  expect(new URL(home.headers().location, SITE_ORIGIN).pathname).toBe("/");
  const api = await request.get("/api/workspace");
  expect(api.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  const callback = await request.get("/auth/callback", { maxRedirects: 0 });
  expect(callback.headers()["x-robots-tag"]).toBe("noindex, nofollow");
});

test("public canonical and social metadata use production URLs and contain no fabricated structured claims", async ({
  page,
  request,
}) => {
  const broken: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400)
      broken.push(`${response.status()} ${response.url()}`);
  });
  for (const path of PUBLIC_PATHS) {
    const crawler = await request.get(path, {
      headers: { "user-agent": "Twitterbot/1.0" },
    });
    expect(crawler.status()).toBe(200);
    const head = (await crawler.text()).split("</head>")[0];
    expect(head).toContain('property="og:image"');
    expect(head).toContain(`${SITE_ORIGIN}/og-image.png`);
    await page.goto(path);
    // Next normalises the root origin without a trailing slash. Compare URL
    // semantics, while still requiring exactly the production origin + path.
    expect(
      new URL(
        (await page.locator('link[rel="canonical"]').getAttribute("href"))!,
      ).href,
    ).toBe(new URL(path, SITE_ORIGIN).href);
    expect(
      new URL(
        (await page
          .locator('meta[property="og:url"]')
          .getAttribute("content"))!,
      ).href,
    ).toBe(new URL(path, SITE_ORIGIN).href);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      `${SITE_ORIGIN}/og-image.png`,
    );
    await expect(
      page.locator('meta[property="og:image:width"]'),
    ).toHaveAttribute("content", "1200");
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/apple-touch-icon.png",
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "index, follow",
    );
  }
  await page.goto("/");
  const schema = JSON.parse(
    await page.locator('script[type="application/ld+json"]').innerText(),
  );
  expect(schema["@type"]).toBe("WebSite");
  expect(schema.url).toBe(`${SITE_ORIGIN}/`);
  expect(schema.offers).toBeUndefined();
  expect(schema.aggregateRating).toBeUndefined();
  expect(broken).toEqual([]);
});

test("all workspace and sign-in pages are noindex without a misleading homepage canonical", async ({
  page,
}) => {
  for (const path of PRIVATE_PATHS) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  }
});

test("footer policy destinations are real, keyboard-accessible pages", async ({
  page,
}) => {
  await page.goto("/");
  const privacy = page.getByRole("link", {
    name: "Privacy & data handling",
    exact: true,
  });
  await privacy.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.getByRole("heading", { name: "Privacy & data handling", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/dedicated privacy support address is not configured/),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Responsible use", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Responsible use", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "4. Outreach stays draft-only" }),
  ).toBeVisible();
});

for (const path of ["/privacy", "/responsible-use"]) {
  test(`policy accessibility and mobile layout: ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByRole("main")).toBeVisible();
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
  });
}

test("homepage footer wraps on mobile and workspace trust links use real canonical destinations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  // Sidebar trust links are intentionally hidden in the collapsed mobile shell.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/overview");
  await expect(
    page.getByRole("link", { name: "Our approach", exact: true }),
  ).toHaveAttribute("href", "/#trust");
  await expect(
    page.getByRole("link", { name: "Privacy first", exact: true }),
  ).toHaveAttribute("href", "/privacy");
});
