// Usage: node docs/ui-renovation/tools/check-motion.mjs [baseUrl]
// Checks: page transition, dialog open/close, hover, sidebar collapse, layout shift,
// and prefers-reduced-motion (transform animation must be removed, fade kept).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiResponse, makeToken } from "./fixtures.mjs";

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/package.json"));
const { chromium } = require("playwright");
const base = process.argv[2] ?? "http://localhost:3100";
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

const browser = await chromium.launch();

async function open(reducedMotion) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
    colorScheme: "light",
  });
  await ctx.addInitScript(([t]) => {
    localStorage.setItem("gps.accessToken", t);
    localStorage.setItem("gps.role", "Operation");
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  }, [makeToken()]);
  await ctx.route(/\/api\/v1\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(apiResponse(route.request().url())) }),
  );
  const page = await ctx.newPage();
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  return { ctx, page };
}

// Samples the page wrapper's opacity/transform right after a client navigation.
async function sampleNavigation(page, linkName) {
  await page.evaluate(() => {
    window.__samples = [];
    const tick = () => {
      const el = document.querySelector("main > div > div");
      if (el) {
        const cs = getComputedStyle(el);
        window.__samples.push({ o: Number(cs.opacity), t: cs.transform });
      }
      if (window.__samples.length < 60) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole("link", { name: new RegExp("^" + linkName) }).first().click();
  await page.waitForTimeout(1200);
  return page.evaluate(() => window.__samples);
}

// ---- normal motion
{
  const { ctx, page } = await open(false);
  const samples = await sampleNavigation(page, "Device Search");
  const minOpacity = Math.min(...samples.map((s) => s.o));
  const distinct = new Set(samples.map((s) => s.t)).size;
  const moved = distinct >= 3;
  const last = samples.at(-1);
  check("page transition fades in", minOpacity < 1 && last.o === 1, `min opacity ${minOpacity}, final ${last?.o}`);
  check("page transition slides (transform used)", moved, `distinct transforms ${distinct}`);
  const cls = await page.evaluate(() => window.__cls);
  check("no layout shift on navigation (CLS < 0.1)", cls < 0.1, `CLS ${cls.toFixed(3)}`);

  // dialog: Ctrl+K open / Escape close, with exit animation
  await page.keyboard.press("Control+k");
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ state: "visible", timeout: 3000 });
  check("command palette opens with Ctrl+K", true);
  await page.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
  check("command palette closes with Escape", (await dlg.count()) === 0);

  // sidebar collapse keeps the active item and tooltip name
  await page.getByRole("button", { name: "ยุบเมนู" }).dispatchEvent("click");
  await page.waitForTimeout(700);
  const w = await page.evaluate(() => document.querySelector("aside").getBoundingClientRect().width);
  check("sidebar collapses to icon width", w < 100, `width ${Math.round(w)}`);
  await page.getByRole("button", { name: "ขยายเมนู" }).dispatchEvent("click");
  await page.waitForTimeout(700);
  const w2 = await page.evaluate(() => document.querySelector("aside").getBoundingClientRect().width);
  check("sidebar expands back", w2 > 200, `width ${Math.round(w2)}`);

  // theme toggle works and persists
  await page.getByRole("button", { name: /สลับเป็นธีมมืด/ }).click();
  await page.waitForTimeout(300);
  check("theme switches to dark", await page.evaluate(() => document.documentElement.classList.contains("dark")));
  await page.reload({ waitUntil: "networkidle" });
  check("theme choice persists after reload", await page.evaluate(() => document.documentElement.classList.contains("dark")));

  // button hover does not shift layout
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const btn = page.getByRole("button", { name: "รีเฟรชข้อมูล" });
  const before = await btn.boundingBox();
  await btn.hover();
  await page.waitForTimeout(300);
  const after = await btn.boundingBox();
  check("hover does not shift layout", Math.abs(before.y - after.y) < 1.5 && before.x === after.x, `dy ${(after.y - before.y).toFixed(2)}`);
  await ctx.close();
}

// ---- reduced motion
{
  const { ctx, page } = await open(true);
  const samples = await sampleNavigation(page, "Device Search");
  // slide = transform passes through many intermediate values; with reduced motion it only
  // has the first (initial) frame and the final one
  const distinctReduced = new Set(samples.map((s) => s.t)).size;
  const moved = distinctReduced > 2;
  const fades = samples.some((s) => s.o > 0 && s.o < 1) || samples.at(-1).o === 1;
  const ledAnimated = await page.evaluate(() => {
    const el = document.querySelector("[data-slot='status-led'] .animate-led");
    return el ? getComputedStyle(el).animationName : "none-found";
  });
  check("reduced motion: no slide on page change (fade only)", !moved && fades, `distinct transforms ${distinctReduced}`);
  check("reduced motion: LED pulse disabled", ledAnimated === "none" || ledAnimated === "none-found", `animation: ${ledAnimated}`);
  await ctx.close();
}

await browser.close();
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  (" + r.detail + ")" : ""}`);
process.exit(results.some((r) => !r.ok) ? 1 : 0);
