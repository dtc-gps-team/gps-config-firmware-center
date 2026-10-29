// Usage: node docs/ui-renovation/tools/shoot.mjs <label> [baseUrl] [page,page,...]
// Screenshots go to docs/ui-renovation/screenshots/ (gitignored).
// THEMES=dark,light  เลือกธีม (ค่าเริ่มต้น light,dark)   ROLE=Operation  เลือกบทบาทใน token ปลอม
// หน้าที่ระบุ `extra: ["mobile", "light"]` จะถ่าย 390 (light) และ 1440 light เพิ่มเมื่อธีมที่เลือกเป็น dark อย่างเดียว
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiResponse, makeToken } from "./fixtures.mjs";

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/package.json"));
const { chromium } = require("playwright");
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../screenshots");
const role = process.env.ROLE ?? "Operation";
const label = (process.argv[2] ?? "after") + (role === "Operation" ? "" : `-${role}`);
const base = process.argv[3] ?? "http://localhost:3100";

const shots = (process.argv[4] ?? "dashboard").split(",");
const DEV = "/devices/BB-200-20481";

const targets = {
  dashboard: { url: "/", w: 1440, h: 900 },
  config: { url: "/config", w: 1440, h: 900, extra: ["mobile", "light"] },
  devices: { url: "/devices", w: 1440, h: 900, extra: ["mobile", "light"] },
  "devices-select": {
    url: "/devices",
    w: 1440,
    h: 900,
    act: async (page) => {
      await page.getByRole("checkbox", { name: "เลือกแถวนี้" }).nth(0).click();
      await page.getByRole("checkbox", { name: "เลือกแถวนี้" }).nth(1).click();
      await page.getByRole("checkbox", { name: "เลือกแถวนี้" }).nth(2).click();
    },
  },
  "device-detail": { url: DEV, w: 1440, h: 900 },
  "device-config-tab": { url: `${DEV}?tab=config`, w: 1440, h: 900 },
  approvals: { url: "/approvals", w: 1440, h: 900 },
  "approvals-diff": {
    url: "/approvals",
    w: 1440,
    h: 900,
    act: async (page) => {
      await page.getByRole("button", { name: /ดูค่าที่เปลี่ยน/ }).first().click();
      await page.getByRole("checkbox", { name: /เลือกทั้งหมดที่อนุมัติได้/ }).click();
    },
  },
  "config-edit": {
    url: "/config/c3/edit",
    w: 1440,
    h: 900,
    extra: ["mobile", "light"],
    act: async (page) => {
      await page.getByRole("button", { name: /ถัดไป/ }).click();
      await page.locator("#field-SERVER_PORT").fill("9100");
      await page.locator("#field-REPORT_INTERVAL").fill("45");
    },
  },
  "config-new-step1": {
    url: "/config/new",
    w: 1440,
    h: 900,
    extra: ["mobile"],
    act: async (page) => {
      await page.getByLabel("ชื่อ Config").fill("ติดตามรถบรรทุกภาคเหนือ");
      await page.getByRole("combobox", { name: "โมเดล" }).click();
      await page.getByRole("option", { name: "BB-200" }).click();
    },
  },
  "config-import": {
    url: "/config",
    w: 1440,
    h: 900,
    extra: ["mobile"],
    act: async (page) => {
      await page.getByRole("button", { name: /Import จากไฟล์/ }).click();
      await page.locator('input[type="file"]').setInputFiles({
        name: "gt06n-standard.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ name: "GT06N มาตรฐาน", deviceModel: "BB-200", protocol: "mqtt", settings: { SERVER_HOST: "gps.example.net", SERVER_PORT: 8080 } })),
      });
    },
  },
  "config-edit-json": {
    url: "/config/c3/edit",
    w: 1440,
    h: 900,
    act: async (page) => {
      await page.getByRole("button", { name: /ถัดไป/ }).click();
      await page.locator("#field-SERVER_PORT").fill("9100");
      await page.getByRole("button", { name: "JSON" }).click();
      await page.locator("#config-raw").click();
      await page.keyboard.press("Control+A");
    },
  },
  parameters: {
    url: "/parameters",
    w: 1440,
    h: 900,
    act: async (page) => {
      await page.getByRole("cell", { name: "SERVER_PORT" }).first().click();
    },
  },
  firmware: { url: "/firmware", w: 1440, h: 900 },
  "firmware-upload": {
    url: "/firmware",
    w: 1440,
    h: 900,
    role: "FirmwareEngineer",
    act: async (page) => {
      await page.getByRole("button", { name: /อัปโหลด Firmware/ }).first().click();
      await page.waitForTimeout(500);
    },
  },
  "parameter-new": {
    url: "/parameters/new",
    w: 1440,
    h: 900,
    extra: ["mobile"],
    act: async (page) => {
      await page.locator("#param-name").fill("report_interval");
      await page.locator("#param-desc").fill("ช่วงเวลารายงานตำแหน่ง");
      await page.locator("#param-unit").fill("วินาที");
      await page.locator("#param-allowed").fill("30\n60\n120");
      await page.getByRole("button", { name: /เลือกโมเดล/ }).click();
      await page.getByRole("checkbox", { name: /BB-200/ }).click();
      await page.keyboard.press("Escape");
      await page.getByRole("checkbox", { name: /ต้องกรอก/ }).click();
    },
  },
  "parameter-new-wide": {
    url: "/parameters/new",
    w: 2200,
    h: 900,
    act: async (page) => {
      await page.locator("#param-name").fill("report_interval");
      await page.locator("#param-desc").fill("ช่วงเวลารายงานตำแหน่ง");
      await page.locator("#param-unit").fill("วินาที");
      await page.locator("#param-allowed").fill("30\n60\n120");
      await page.getByRole("button", { name: /เลือกโมเดล/ }).click();
      await page.getByRole("checkbox", { name: /BB-200/ }).click();
      await page.keyboard.press("Escape");
      await page.getByRole("checkbox", { name: /ต้องกรอก/ }).click();
    },
  },
  "parameters-list": { url: "/parameters", w: 1440, h: 900 },
  "config-detail": { url: "/config/c2?tab=versions", w: 1440, h: 900, extra: ["mobile"] },
  "config-detail-params": { url: "/config/c2", w: 1440, h: 900 },
  "config-detail-draft": { url: "/config/c3", w: 1440, h: 900, extra: ["mobile"] },
  "firmware-detail": { url: "/firmware/f1", w: 1440, h: 900, extra: ["mobile"] },
  "device-new": { url: "/devices/new", w: 1440, h: 900, extra: ["mobile"] },
  "audit-log": { url: "/audit-log", w: 1440, h: 900, extra: ["mobile"] },
  "audit-log-detail": {
    url: "/audit-log",
    w: 1440,
    h: 900,
    act: async (page) => {
      await page.getByRole("cell", { name: "apply-config" }).first().click();
    },
  },
  incidents: { url: "/incidents", w: 1440, h: 900, extra: ["mobile"] },
  "incident-detail": { url: "/incidents/i1", w: 1440, h: 900, extra: ["mobile"] },
  "incident-detail-reviewed": { url: "/incidents/i3", w: 1440, h: 900 },
  campaigns: { url: "/campaigns", w: 1440, h: 900, extra: ["mobile"] },
  "campaign-detail": { url: "/campaigns/camp1", w: 1440, h: 900, extra: ["mobile"] },
  "device-history": {
    url: "/campaigns/camp1",
    w: 1440,
    h: 900,
    act: async (page) => {
      await page.getByRole("button", { name: "ดูประวัติ" }).first().click();
      await page.waitForTimeout(600);
    },
  },
  "rollout-new-1": { url: "/campaigns/camp1/rollouts/new", w: 1440, h: 900, extra: ["mobile"] },
  "rollout-new-3": {
    url: "/campaigns/camp1/rollouts/new",
    w: 1440,
    h: 900,
    act: async (page) => {
      await page.getByRole("button", { name: /ถัดไป/ }).click();
      await page.getByRole("combobox", { name: "Config" }).click();
      await page.getByRole("option").first().click();
      await page.getByRole("button", { name: /ถัดไป/ }).click();
    },
  },
  "rollout-new-4": {
    url: "/campaigns/camp1/rollouts/new",
    w: 1440,
    h: 900,
    act: async (page) => {
      await page.getByRole("button", { name: /ถัดไป/ }).click();
      await page.getByRole("combobox", { name: "Config" }).click();
      await page.getByRole("option").first().click();
      await page.getByRole("button", { name: /ถัดไป/ }).click();
      await page.getByRole("button", { name: "เอาเครื่องเหล่านี้ออกจากรอบนี้" }).click();
      await page.getByRole("button", { name: /ถัดไป/ }).click();
    },
  },
  "rollout-detail": { url: "/campaigns/camp1/rollouts/r2", w: 1440, h: 900, extra: ["mobile"] },
  "rollout-rollback": {
    url: "/campaigns/camp1/rollouts/r3",
    w: 1440,
    h: 900,
    act: async (page) => {
      await page.getByRole("button", { name: "สั่ง Rollback" }).click();
    },
  },
  users: { url: "/users", w: 1440, h: 900, role: "Admin", extra: ["mobile"] },
  "device-models": { url: "/device-models", w: 1440, h: 900, role: "Admin", extra: ["mobile"] },
  forbidden: { url: "/audit-log", w: 1440, h: 900, role: "ConfigEngineer" },
  "not-found": { url: "/no-such-page", w: 1440, h: 900 },
  login: { url: "/login", w: 1440, h: 900, anon: true, extra: ["mobile"] },
  "firmware-compare": {
    url: "/firmware",
    w: 1440,
    h: 900,
    act: async (page) => {
      await page.getByRole("checkbox", { name: "เลือกแถวนี้" }).nth(0).click();
      await page.getByRole("checkbox", { name: "เลือกแถวนี้" }).nth(2).click();
      await page.getByRole("button", { name: /เปรียบเทียบ 2 เวอร์ชัน/ }).click();
    },
  },
};

const browser = await chromium.launch();
async function newPage(w, h, theme, t = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  const r = t.role ?? role;
  if (!t.anon) {
    await ctx.addInitScript(([tok, rr]) => {
      localStorage.setItem("gps.accessToken", tok);
      localStorage.setItem("gps.role", rr);
    }, [makeToken(r), r]);
  }
  await ctx.route(/\/api\/v1\//, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(apiResponse(route.request().url())) }),
  );
  const page = await ctx.newPage();
  await page.addInitScript((th) => { try { localStorage.setItem("theme", th); } catch {} }, theme);
  return { ctx, page };
}

async function capture(name, t, w, h, theme, suffix, fullPage = false) {
  const { ctx, page } = await newPage(w, h, theme, t);
  await page.goto(base + t.url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  if (t.act) {
    await t.act(page);
    await page.waitForTimeout(700);
  }
  await page.screenshot({ path: path.join(out, `${label}-${name}-${suffix}.png`), fullPage });
  await ctx.close();
}

for (const name of shots) {
  const t = targets[name];
  if (!t) throw new Error(`unknown target ${name}`);
  const themes = label === "before" ? ["light"] : process.env.THEMES ? process.env.THEMES.split(",") : ["light", "dark"];
  for (const theme of themes) {
    await capture(name, t, t.w, t.h, theme, `${t.w}-${theme}`);
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
  }
  if (t.extra?.includes("mobile")) await capture(name, t, 390, 844, "light", "390-light", true);
  if (t.extra?.includes("light") && !themes.includes("light")) await capture(name, t, t.w, t.h, "light", `${t.w}-light`);
}
await browser.close();
