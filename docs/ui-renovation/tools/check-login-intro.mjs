// Usage: node docs/ui-renovation/tools/check-login-intro.mjs [baseUrl]
// Captures the login intro timeline, then checks replay-skip, reduced motion and the error shake.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../web/package.json"));
const { chromium } = require("playwright");
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../screenshots");
const base = process.argv[2] ?? "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });
const browser = await chromium.launch();

// samples the card wrapper opacity every frame from page start (to tell "fade" from "pop in")
const SAMPLER = () => {
  window.__op = [];
  const tick = () => {
    const card = document.querySelector("[data-slot='card']");
    if (card) window.__op.push(Number(getComputedStyle(card.parentElement.parentElement).opacity));
    if (window.__op.length < 400) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const fadeFrames = (page) =>
  page.evaluate(() => window.__op.filter((o) => o > 0.04 && o < 0.96).length);

const cardOpacity = (page) =>
  page.evaluate(() => {
    const card = document.querySelector("[data-slot='card']");
    return card ? Number(getComputedStyle(card.parentElement.parentElement).opacity) : -1;
  });

// ---- first visit: timeline frames
{
  const ctx = await browser.newContext({ viewport: { width: 700, height: 560 } });
  const page = await ctx.newPage();
  await page.route(/\/api\/v1\/auth\/login/, (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" }) }),
  );
  await page.goto(base + "/login", { waitUntil: "commit" });
  const stamps = [150, 450, 750, 1050, 1500, 2200];
  const start = Date.now();
  for (const ms of stamps) {
    await page.waitForTimeout(Math.max(0, ms - (Date.now() - start)));
    await page.screenshot({ path: path.join(out, `login-intro-${ms}.png`), clip: { x: 130, y: 20, width: 440, height: 300 } });
  }
  const early = await (async () => {
    const p2 = await ctx.newPage();
    await p2.goto(base + "/login", { waitUntil: "commit" });
    await p2.waitForTimeout(120);
    const o = await cardOpacity(p2);
    await p2.close();
    return o;
  })();
  check("first visit: card is still fading in at ~120ms", early >= 0 && early < 1, `opacity ${early}`);
  // username focused without waiting
  check("username field is focused (usable during intro)", await page.evaluate(() => document.activeElement?.id === "username"));

  // caps lock hint appears while Caps Lock is on, disappears when it is off
  await page.focus("#password");
  await page.evaluate(() => document.querySelector("#password").dispatchEvent(new KeyboardEvent("keyup", { key: "a", modifierCapsLock: true, bubbles: true })));
  await page.waitForTimeout(300);
  check("caps lock hint shows when Caps Lock is on", (await page.getByText("Caps Lock เปิดอยู่").count()) === 1);
  await page.evaluate(() => document.querySelector("#password").dispatchEvent(new KeyboardEvent("keyup", { key: "a", modifierCapsLock: false, bubbles: true })));
  await page.waitForTimeout(400);
  check("caps lock hint hides when Caps Lock is off", (await page.getByText("Caps Lock เปิดอยู่").count()) === 0);

  // wrong credentials: error shown + card moves (shake)
  await page.fill("#username", "x");
  await page.fill("#password", "y");
  const xs = [];
  await page.evaluate(() => { window.__xs = []; const tick = () => { const el = document.querySelector("[data-slot='card']").parentElement; const m = new DOMMatrixReadOnly(getComputedStyle(el).transform === "none" ? undefined : getComputedStyle(el).transform); window.__xs.push(m.m41); if (window.__xs.length < 60) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await page.click("button[type=submit]");
  await page.waitForTimeout(700);
  const xsRes = await page.evaluate(() => window.__xs);
  check("error message appears", (await page.getByText("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง").count()) === 1);
  check("card shakes on wrong credentials", Math.max(...xsRes) - Math.min(...xsRes) > 3, `range ${(Math.max(...xsRes) - Math.min(...xsRes)).toFixed(1)}px`);

  // ---- replay: after the intro finished, a new load shows the final state without a fade
  await page.waitForTimeout(1500);
  const p3 = await ctx.newPage();
  await p3.addInitScript(SAMPLER);
  await p3.goto(base + "/login", { waitUntil: "networkidle" });
  await p3.waitForTimeout(500);
  const replayFade = await fadeFrames(p3);
  check("repeat visit / refresh: intro plays again", (await cardOpacity(p3)) === 1 && replayFade >= 5, `fade frames ${replayFade}`);
  // the very first load does fade
  const p4ctx = await browser.newContext({ viewport: { width: 700, height: 560 } });
  const p4 = await p4ctx.newPage();
  await p4.addInitScript(SAMPLER);
  await p4.goto(base + "/login", { waitUntil: "networkidle" });
  await p4.waitForTimeout(1200);
  const firstFade = await fadeFrames(p4);
  check("first visit: card fades in over several frames", firstFade >= 5, `fade frames ${firstFade}`);
  await p4ctx.close();
  await ctx.close();
}

// ---- remembered username: prefilled, focus moves to the password field
{
  const ctx = await browser.newContext({ viewport: { width: 700, height: 560 } });
  await ctx.addInitScript(() => localStorage.setItem("gps.lastUsername", "config.test"));
  const page = await ctx.newPage();
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  check("remembered username is prefilled", (await page.inputValue("#username")) === "config.test");
  check("focus moves to the password field", await page.evaluate(() => document.activeElement?.id === "password"));
  check("password is never remembered", (await page.inputValue("#password")) === "");
  await ctx.close();
}

// ---- reduced motion: no intro at all
{
  const ctx = await browser.newContext({ viewport: { width: 700, height: 560 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.addInitScript(SAMPLER);
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const f = await fadeFrames(page);
  check("reduced motion: no fade, card shown", (await cardOpacity(page)) === 1 && f === 0, `fade frames ${f}`);
  await ctx.close();
}

await browser.close();
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  (" + r.detail + ")" : ""}`);
process.exit(results.some((r) => !r.ok) ? 1 : 0);
