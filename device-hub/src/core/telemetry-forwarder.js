// ส่งพิกัดเข้า backend ทีละจุด ตามลำดับของแต่ละเครื่อง (docs/33 D6)
// - ไม่เกินเพดานของ backend: ต่อเครื่อง 60/นาที, รวม 240/นาที (ต่ำกว่า 300/นาที/IP ของ backend เผื่อไว้)
// - 5xx / 429 / เครือข่ายล่ม → เก็บไว้ลองใหม่ · 4xx อื่น → ทิ้งพร้อม log (ข้อมูลผิด ส่งซ้ำก็ไม่ผ่าน)
// - เก็บรอได้สูงสุด maxBufferPerDevice จุดต่อเครื่อง เกินแล้วทิ้งจุดเก่าสุด
'use strict';

const WINDOW_MS = 60_000;

function createWindow() {
  return { startedAt: -Infinity, count: 0 };
}

function createTelemetryForwarder({
  backendUrl, devices, fetchImpl = fetch, now = Date.now,
  perDevicePerMin = 60, globalPerMin = 240, maxBufferPerDevice = 5000, log = () => {},
}) {
  const queues = new Map(); // imei -> report[]
  const windows = new Map(); // imei -> window
  const globalWindow = createWindow();
  let pumping = null;

  function allowed(win, limit, t) {
    if (t - win.startedAt >= WINDOW_MS) {
      win.startedAt = t;
      win.count = 0;
    }
    return win.count < limit;
  }

  function enqueue(imei, report) {
    if (!backendUrl) return;
    if (!devices.has(imei)) {
      log(`ไม่ส่งพิกัดของ IMEI ${imei}: ไม่อยู่ในทะเบียนเครื่อง`);
      return;
    }
    const q = queues.get(imei) ?? [];
    q.push(report);
    if (q.length > maxBufferPerDevice) {
      q.shift();
      log(`พิกัดของ ${imei} ค้างเกิน ${maxBufferPerDevice} จุด ทิ้งจุดเก่าสุด`);
    }
    queues.set(imei, q);
  }

  // ส่ง 1 จุด → 'sent' | 'dropped' | 'retry'
  async function sendOne(imei, report) {
    const { telemetryKey } = devices.get(imei);
    const url = `${backendUrl}/device-sync/${encodeURIComponent(imei)}/telemetry/${encodeURIComponent(telemetryKey)}`;
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      if (res.ok) return 'sent';
      if (res.status >= 500 || res.status === 429) {
        log(`ส่งพิกัดของ ${imei} ไม่สำเร็จ (HTTP ${res.status}) จะลองใหม่`);
        return 'retry';
      }
      log(`backend ปฏิเสธพิกัดของ ${imei} (HTTP ${res.status}) ทิ้งจุดนี้`);
      return 'dropped';
    } catch (err) {
      log(`ส่งพิกัดของ ${imei} ไม่สำเร็จ (${err.message}) จะลองใหม่`);
      return 'retry';
    }
  }

  async function pumpOnce() {
    const blocked = new Set(); // เครื่องที่ต้องรอรอบถัดไป (โควตาหมด / backend ล่ม)
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [imei, q] of queues) {
        if (q.length === 0 || blocked.has(imei)) continue;
        const t = now();
        if (!allowed(globalWindow, globalPerMin, t)) return;
        const win = windows.get(imei) ?? createWindow();
        windows.set(imei, win);
        if (!allowed(win, perDevicePerMin, t)) {
          blocked.add(imei);
          continue;
        }
        win.count += 1;
        globalWindow.count += 1;
        const result = await sendOne(imei, q[0]);
        if (result === 'retry') {
          blocked.add(imei);
          continue;
        }
        q.shift();
        progressed = true;
      }
    }
  }

  // เรียกซ้อนกันได้ (จาก setInterval) — รอบที่ซ้อนจะรอรอบที่กำลังวิ่ง ไม่ส่งซ้ำ
  function pump() {
    pumping ??= pumpOnce().finally(() => { pumping = null; });
    return pumping;
  }

  function size(imei) {
    if (imei !== undefined) return queues.get(imei)?.length ?? 0;
    let total = 0;
    for (const q of queues.values()) total += q.length;
    return total;
  }

  return { enqueue, pump, size };
}

module.exports = { createTelemetryForwarder };
