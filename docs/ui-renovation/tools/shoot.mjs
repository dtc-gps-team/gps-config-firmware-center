// Usage: node docs/ui-renovation/tools/shoot.mjs <label> [baseUrl]
// Screenshots go to docs/ui-renovation/screenshots/ (gitignored).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiResponse, makeToken } from "./fixtures.mjs";

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/package.json"));
const { chromium } = require("playwright");
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../screenshots");
const label = process.argv[2] ?? "after";
const base = process.argv[3] ?? "http://localhost:3100";

const shots = (process.argv[4] ?? "dashboard").split(",");
const targets = {
  dashboard: { url: "/", w: 1440, h: 900 },
  config: { url: "/config", w: 1440, h: 900 },
  devices: { url: "/devices", w: 1440, h: 900 },
};

const browser = await chromium.launch();
async function newPage(w, h, theme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  await ctx.addInitScript(([t]) => {
    localStorage.setItem("gps.accessToken", t);
    localStorage.setItem("gps.role", "Operation");
    if (window.__theme) localStorage.setItem("theme", window.__theme);
  }, [makeToken()]);
  await ctx.route(/\/api\/v1\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(apiResponse(route.request().url())) }),
  );
  return { ctx, page: await ctx.newPage() };
}

for (const name of shots) {
  const t = targets[name];
  for (const theme of label === "before" ? ["light"] : ["light", "dark"]) {
    const { ctx, page } = await newPage(t.w, t.h, theme);
    await page.addInitScript((th) => { try { localStorage.setItem("theme", th); } catch {} }, theme);
    await page.goto(base + t.url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, `${label}-${name}-${t.w}-${theme}.png`) });
    if (label !== "before" && name === "dashboard" && theme === "light") {
      const m = await newPage(390, 844, theme);
      await m.page.goto(base + t.url, { waitUntil: "networkidle" });
      await m.page.waitForTimeout(1200);
      await m.page.screenshot({ path: path.join(out, `${label}-dashboard-390-light.png`), fullPage: true });
      await m.page.getByRole("button", { name: "เปิดเมนู" }).click();
      await m.page.waitForTimeout(600);
      await m.page.screenshot({ path: path.join(out, `${label}-shell-390-menu.png`) });
      await m.ctx.close();
    }
    await ctx.close();
  }
}
await browser.close();
