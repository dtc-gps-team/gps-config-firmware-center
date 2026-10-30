// Usage: node docs/ui-renovation/tools/check-firmware-access.mjs [baseUrl]
// ตรวจว่า /firmware ไม่พัง (ไม่มี runtime error) และ ConfigEngineer ถูกปิดหน้า/ซ่อนเมนู ส่วน role อื่นเห็นปกติ
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiResponse, makeToken } from "./fixtures.mjs";

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/package.json"));
const { chromium } = require("playwright");
const base = process.argv[2] ?? "http://localhost:3100";
const browser = await chromium.launch();
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

for (const role of ["ConfigEngineer", "QAEngineer"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([t, r]) => {
    localStorage.setItem("gps.accessToken", t);
    localStorage.setItem("gps.role", r);
  }, [makeToken(role), role]);
  await ctx.route(/\/api\/v1\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(apiResponse(route.request().url())) }),
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/firmware`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const overlay = await page.getByText(/Functions cannot be passed/).count();
  check(`${role}: หน้า /firmware ไม่มี runtime error`, overlay === 0 && errors.length === 0, errors.join("; "));
  const menu = await page.getByRole("link", { name: "Firmware Repository" }).count();
  const table = await page.getByRole("heading", { name: "Firmware Repository" }).count();
  if (role === "ConfigEngineer") {
    check("ConfigEngineer: ไม่มีเมนู Firmware", menu === 0);
    check("ConfigEngineer: ไม่เห็นเนื้อหา Firmware", table === 0);
  } else {
    check("QAEngineer: มีเมนู Firmware", menu > 0);
    check("QAEngineer: เห็นหน้า Firmware", table > 0);
  }
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
