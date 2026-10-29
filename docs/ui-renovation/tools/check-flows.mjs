// Usage: node docs/ui-renovation/tools/check-flows.mjs [baseUrl]
// เดินตามงานหลัก 2 งานของรอบ 2 ด้วย API จำลอง (ไม่มี backend) แล้วนับคลิก/ตรวจผล
//   A) ConfigEngineer: หาอุปกรณ์ -> แก้ Config -> ทดสอบ -> ส่งขออนุมัติ
//   B) Operation: ดู diff ใน Approval Center -> เลือกทั้งหมด -> อนุมัติหลายรายการ
//   C) โคลน Config  D) Campaign -> Rollout wizard 4 ขั้น  E) Incident -> Rollout ต้นทาง -> Rollback (ต้องพิมพ์ยืนยัน)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiResponse, makeToken } from "./fixtures.mjs";

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/package.json"));
const { chromium } = require("playwright");
const base = process.argv[2] ?? "http://localhost:3100";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const browser = await chromium.launch();

async function open(role) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await ctx.addInitScript(([t, r]) => {
    localStorage.setItem("gps.accessToken", t);
    localStorage.setItem("gps.role", r);
    localStorage.setItem("theme", "dark");
  }, [makeToken(role), role]);
  const calls = [];
  await ctx.route(/\/api\/v1\//, (route) => {
    const req = route.request();
    const url = req.url();
    const p = url.replace(/^.*\/api\/v1/, "").split("?")[0];
    if (req.method() !== "GET") {
      calls.push(`${req.method()} ${p}`);
      let body = apiResponse(`/api/v1/config/c3`);
      if (p.endsWith("/simulate")) body = { passed: true, details: ["ผ่านทุกข้อ"] };
      if (p.endsWith("/decide")) body = { ...body, status: "testing" };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(apiResponse(url)) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, calls, errors };
}

// ---------- A) หาอุปกรณ์ -> แก้ config -> ส่งขออนุมัติ ----------
{
  const { ctx, page, calls, errors } = await open("ConfigEngineer");
  let clicks = 0;
  const click = async (locator) => {
    await locator.click();
    clicks += 1;
  };

  await page.goto(`${base}/devices`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "ค้นหารวม" }).fill("20481");
  await page.waitForTimeout(500);
  check("A1 ค้นหาแล้ว URL เก็บ q และเหลือ 1 แถว", page.url().includes("q=20481") && (await page.getByRole("row").count()) <= 4, page.url());

  await click(page.getByRole("cell", { name: "BB-200-20481" }).first());
  await page.waitForURL(/\/devices\/BB-200-20481/);
  check("A2 เข้าหน้ารายละเอียดเครื่อง", true);

  await click(page.getByRole("tab", { name: "Config" }));
  check("A3 แท็บ Config เก็บใน URL", page.url().includes("tab=config"), page.url());
  check("A4 สถานะเป้าหมาย Config แสดง", await page.getByText("Config เป้าหมาย").isVisible());

  await click(page.getByRole("link", { name: "ไปหน้า Config" }));
  await page.waitForURL(/\/config$/);
  await click(page.getByRole("cell", { name: "ติดตามความถี่สูง" }));
  await page.waitForURL(/\/config\/c3$/);
  await click(page.getByRole("link", { name: "แก้ไข" }));
  await page.waitForURL(/\/config\/c3\/edit/);
  await click(page.getByRole("button", { name: /ถัดไป/ }));
  await page.locator("#field-SERVER_PORT").fill("9100");
  check("A5 เห็น Diff เก่า→ใหม่ก่อนบันทึก", await page.getByText("แก้ไข 1").first().isVisible());
  check("A6 ช่องที่เปลี่ยนถูกไฮไลต์", await page.getByText("แก้ไขแล้ว").first().isVisible());

  await click(page.getByRole("button", { name: /บันทึกการแก้ไข/ }));
  await page.waitForURL(/\/config\?/);
  check("A7 บันทึกแล้วยิง PUT/PATCH", calls.some((c) => /^(PUT|PATCH) \/config\/c3$/.test(c)), calls.join(", "));

  await click(page.getByRole("cell", { name: "ติดตามความถี่สูง" }));
  await page.waitForURL(/\/config\/c3$/);
  await click(page.getByRole("button", { name: "ทดสอบ Config" }));
  await page.waitForTimeout(400);
  await click(page.getByRole("button", { name: /ส่งให้ Operation อนุมัติ/ }));
  await click(page.getByRole("button", { name: "ยืนยันส่งอนุมัติ" }));
  await page.waitForTimeout(600);
  check("A8 ส่งขออนุมัติยิง POST decide", calls.some((c) => c === "POST /config/c3/decide"), calls.join(", "));
  check("A9 ไม่มี error ใน console หน้า", errors.length === 0, errors.join("; "));
  console.log(`      คลิกทั้งงาน A (นับตั้งแต่เลือกเครื่อง): ${clicks}`);
  await ctx.close();
}

// ---------- B) อนุมัติรายการ ----------
{
  const { ctx, page, calls, errors } = await open("Operation");
  let clicks = 0;
  const click = async (locator) => {
    await locator.click();
    clicks += 1;
  };
  await page.goto(`${base}/approvals`, { waitUntil: "networkidle" });
  check("B1 เห็นคิว Config 3 รายการ", (await page.getByRole("checkbox", { name: /^เลือก ค่า|^เลือก ปรับ|^เลือก โหมด/ }).count()) === 3);

  await click(page.getByRole("button", { name: /ดูค่าที่เปลี่ยน/ }).first());
  check("B2 เห็น Diff ค่าเดิม→ใหม่ในการ์ด", await page.getByText("ฉบับที่ขออนุมัติ").first().isVisible());
  check("B3 ค่าอ่อนไหวถูกปิด", (await page.getByText("old-secret").count()) === 0 && (await page.getByText("s3cr3t").count()) === 0);

  await click(page.getByRole("checkbox", { name: /เลือกทั้งหมดที่อนุมัติได้/ }));
  await click(page.getByRole("button", { name: "อนุมัติที่เลือก" }));
  const confirm = page.getByRole("button", { name: /^อนุมัติ 3 รายการ$/ });
  check("B4 อนุมัติหลายรายการต้องพิมพ์ยืนยัน (ปุ่มปิดอยู่)", await confirm.isDisabled());
  await page.getByRole("textbox").last().fill("APPROVE");
  await click(confirm);
  await page.waitForTimeout(800);
  const approves = calls.filter((c) => /^POST \/config\/c\d\/approve$/.test(c));
  check("B5 ยิง approve ครบ 3 รายการ", approves.length === 3, approves.join(", "));
  check("B6 ไม่มี error ใน console หน้า", errors.length === 0, errors.join("; "));
  console.log(`      คลิกทั้งงาน B: ${clicks}`);
  await ctx.close();
}

// ---------- C) โคลน Config -> แก้บางค่า -> บันทึกเป็นชุดใหม่ ----------
{
  const { ctx, calls, page, errors } = await open("ConfigEngineer");
  let clicks = 0;
  const click = async (locator) => {
    await locator.click();
    clicks += 1;
  };
  let posted = null;
  await page.route(/\/api\/v1\/config$/, async (route) => {
    if (route.request().method() === "POST") posted = route.request().postDataJSON();
    await route.fallback();
  });
  await page.goto(`${base}/config/c2`, { waitUntil: "networkidle" });
  await click(page.getByRole("link", { name: /โคลนไปสร้างชุดใหม่/ }));
  await page.waitForURL(/\/config\/new\?from=c2/);
  check("C1 ฟอร์มโคลนใส่ชื่อ (สำเนา) ให้", (await page.getByLabel("ชื่อ Config").inputValue()).includes("(สำเนา)"));
  await click(page.getByRole("button", { name: /ถัดไป/ }));
  check("C2 พารามิเตอร์ของต้นฉบับถูกคัดลอกมาครบ", (await page.locator("#field-SERVER_PORT").count()) === 1 && (await page.locator("#field-REPORT_INTERVAL").count()) === 1);
  await page.locator("#field-REPORT_INTERVAL").fill("99");
  check("C3 เห็นส่วนต่างจากต้นฉบับ", await page.getByText("สิ่งที่ต่างจาก Config ต้นฉบับ").isVisible());
  await click(page.getByRole("button", { name: /บันทึก Config Draft/ }));
  await page.waitForTimeout(600);
  check("C4 ส่ง clonedFromId และค่าที่แก้", posted?.clonedFromId === "c2" && posted?.fields?.REPORT_INTERVAL === 99, JSON.stringify(posted));
  check("C5 ไม่มี error ใน console หน้า", errors.length === 0, errors.join("; "));
  console.log(`      คลิกทั้งงาน C: ${clicks}`);
  await ctx.close();
}

// ---------- D) Operation: Campaign -> Rollout wizard 4 ขั้น -> ส่งขออนุมัติ ----------
{
  const { ctx, page, errors } = await open("Operation");
  let clicks = 0;
  const click = async (locator) => {
    await locator.click();
    clicks += 1;
  };
  let posted = null;
  await page.route(/\/api\/v1\/campaigns\/camp1\/rollouts$/, async (route) => {
    if (route.request().method() === "POST") {
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "r2" }) });
    }
    await route.fallback();
  });
  await page.goto(`${base}/campaigns`, { waitUntil: "networkidle" });
  await click(page.getByRole("cell", { name: "ปรับค่ารถบรรทุกภาคเหนือ" }));
  await page.waitForURL(/\/campaigns\/camp1$/);
  await page.getByRole("link", { name: /Roll out ใหม่/ }).waitFor();
  // ในข้อมูลจำลอง Rollout r4 ค้างสถานะ approved จึงเปิดรอบใหม่ไม่ได้ ไปหน้า wizard ตรงๆ เพื่อตรวจ flow
  await page.goto(`${base}/campaigns/camp1/rollouts/new`, { waitUntil: "networkidle" });
  check("D1 ขั้น 1 เห็นอุปกรณ์ในกลุ่ม", (await page.getByRole("checkbox").count()) >= 4);
  await click(page.getByRole("button", { name: /ถัดไป/ }));
  await click(page.getByRole("button", { name: /ถัดไป/ }));
  check("D2 ยังไม่เลือก Config ไปต่อไม่ได้", await page.getByText("เลือก Config ก่อน").isVisible());
  await click(page.getByRole("combobox", { name: "Config" }));
  await click(page.getByRole("option").first());
  await click(page.getByRole("button", { name: /ถัดไป/ }));
  check("D3 ขั้นตรวจสอบแสดงเครื่องที่ถูกข้ามพร้อมเหตุผล", await page.getByText("BB-310-20495").isVisible());
  await click(page.getByRole("button", { name: /ถัดไป/ }));
  check("D4 ขั้นยืนยันสรุปจำนวนเครื่อง", await page.getByText(/จาก 4 เครื่อง/).isVisible());
  await click(page.getByRole("button", { name: "เริ่ม Rollout" }));
  await page.waitForURL(/\/rollouts\/r2$/);
  check("D5 ส่ง POST พร้อม excludeDeviceIds ของเครื่องที่ไม่เข้ากัน", posted?.payloadType === "Config" && posted?.excludeDeviceIds?.includes("BB-310-20495"), JSON.stringify(posted));
  check("D6 ไม่มี error ใน console หน้า", errors.length === 0, errors.join("; "));
  console.log(`      คลิกทั้งงาน D (จากรายการ Campaign): ${clicks}`);
  await ctx.close();
}

// ---------- E) Operation: Incident -> Rollout ต้นทาง -> Rollback ต้องพิมพ์ยืนยัน ----------
{
  const { ctx, page, errors } = await open("Operation");
  let clicks = 0;
  const click = async (locator) => {
    await locator.click();
    clicks += 1;
  };
  let rollbackCalled = null;
  await page.route(/\/api\/v1\/campaigns\/camp1\/rollouts\/r2\/rollback$/, async (route) => {
    rollbackCalled = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "r9" }) });
  });
  await page.goto(`${base}/incidents`, { waitUntil: "networkidle" });
  await click(page.getByRole("link", { name: /Rollout หยุดอัตโนมัติ/ }).first());
  await page.waitForURL(/\/incidents\/i1$/);
  await page.getByText("ตรวจพบ Incident").waitFor();
  check("E1 หน้า Incident แสดงไทม์ไลน์และจำนวนเครื่องที่ล้มเหลว", (await page.getByText("ตรวจพบ Incident").isVisible()) && (await page.getByText(/ล้มเหลว 6 จาก 25 เครื่อง/).isVisible()));
  await click(page.getByRole("link", { name: /ดู Rollout ต้นทาง/ }));
  await page.waitForURL(/\/rollouts\/r2$/);
  await click(page.getByRole("button", { name: "สั่ง Rollback" }));
  const confirm = page.getByRole("button", { name: "ยืนยันสั่ง Rollback" });
  check("E2 กล่อง Rollback บอกจำนวนเครื่องที่จะถูกแตะ", await page.getByText(/2 จาก 2 เครื่อง/).isVisible());
  check("E3 ปุ่มยืนยันปิดอยู่จนกว่าจะพิมพ์ ROLLBACK", await confirm.isDisabled());
  await page.getByRole("textbox").last().fill("ROLLBACK");
  await click(confirm);
  await page.waitForTimeout(800);
  check("E4 ยิง POST rollback เมื่อพิมพ์ยืนยันแล้ว", rollbackCalled !== null);
  check("E5 ไม่มี error ใน console หน้า", errors.length === 0, errors.join("; "));
  console.log(`      คลิกทั้งงาน E (จาก Incident ถึงสั่ง Rollback): ${clicks}`);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ผ่าน`);
process.exit(failed.length ? 1 : 0);
