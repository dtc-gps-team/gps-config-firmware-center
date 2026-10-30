// Usage: node crop-brand.mjs  (ถ่ายเฉพาะหัว sidebar ขยาย 3 เท่า ไปที่ screenshots/brand-crop.png)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiResponse, makeToken } from "./fixtures.mjs";
const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/package.json"));
const { chromium } = require("playwright");
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../screenshots/brand-crop.png");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
await ctx.route(/\/api\/v1\//, (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(apiResponse(route.request().url())) }),
);
await ctx.addInitScript(([tok, rr]) => {
  localStorage.setItem("gps.accessToken", tok);
  localStorage.setItem("gps.role", rr);
}, [makeToken("Operation"), "Operation"]);
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 256, height: 70 } });
await browser.close();
