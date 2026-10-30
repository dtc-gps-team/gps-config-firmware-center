// Usage: FLEET=300 node docs/ui-renovation/tools/check-virtual.mjs [baseUrl]
// ตรวจ virtualization ของ Device Search: แถวเกิน 200 ต้อง render เฉพาะช่วงที่เห็น และเลื่อนแล้วเห็นแถวท้ายสุดได้
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiResponse, makeToken } from "./fixtures.mjs";

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/package.json"));
const { chromium } = require("playwright");
const base = process.argv[2] ?? "http://localhost:3100";
const total = Number(process.env.FLEET ?? 10);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([t]) => {
  localStorage.setItem("gps.accessToken", t);
  localStorage.setItem("gps.role", "Operation");
}, [makeToken("Operation")]);
await ctx.route(/\/api\/v1\//, (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(apiResponse(route.request().url())) }),
);
const page = await ctx.newPage();
await page.goto(`${base}/devices`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

const rowsNow = () => page.locator("tbody tr[role=button]").count();
const first = await rowsNow();
console.log(`devices=${total} rendered rows at top=${first}`);
const virtual = total > 200;
console.log(virtual ? (first < total && first > 0 ? "PASS  render เฉพาะช่วงที่เห็น" : "FAIL  ควรเป็น windowing") : first === total ? "PASS  ไม่เกิน 200 ไม่ทำ virtualization" : "FAIL");

if (virtual) {
  await page.locator("div[class*=\"max-h-[70vh]\"]").first().evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(400);
  const last = await rowsNow();
  const lastId = await page.locator("tbody tr[role=button]").last().innerText();
  console.log(`after scroll to bottom rendered=${last}, last row: ${lastId.split("\n")[0]}`);
  console.log(last < total ? "PASS  เลื่อนถึงท้ายยัง render แค่ช่วงที่เห็น" : "FAIL");
}
await browser.close();
