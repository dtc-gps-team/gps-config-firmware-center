// ส่งงานในคิวให้กล่องที่ออนไลน์ ทีละงานต่อเครื่อง ทีละ step และยืนยันผล 3 ระดับ (docs/33 D4)
//   ack      — กล่องตอบ OK พอ
//   readback — ส่งคำสั่งเปล่าอ่านค่ากลับมาเทียบ
//   interval — ดูช่วงห่างของรายงานรอบเวลา (event 35) จริงจากกล่อง
// สายหลุด / ไม่ตอบ → กลับเข้าคิวส่งใหม่ (สูงสุด maxAttempts ครั้ง)
'use strict';
const { isDeepStrictEqual } = require('node:util');

const TRACK_BY_TIME = 35;
const HINT_EVENTS = new Set([21, 81]); // ออกนอก geofence / กล่องถูกถอด → กล่องใช้รอบส่งอื่นแทน A12
const CLOCK_SKEW_MS = 5000; // ยอมให้นาฬิกากล่องกับเครื่องเราต่างกันได้
const MISMATCHES_TO_FAIL = 3; // ช่วงห่างไม่ตรงติดกันกี่ช่วงจึงตัดสินว่าล้ม (กันช่องว่างจากกล่องต่อสายใหม่)

function createExecutor({ queue, tcp, parseReadback, now = Date.now, log = () => {}, maxAttempts = 3, toleranceSec = 5 }) {
  const running = new Set(); // deviceId ที่กำลังทำงานอยู่
  const watches = new Map(); // deviceId -> การรอยืนยันรอบส่ง

  class Retry extends Error {}

  async function send(deviceId, command) {
    try {
      return await tcp.sendCommand(deviceId, command);
    } catch (err) {
      if (err.code === 'DEVICE_OFFLINE' || err.code === 'DEVICE_NO_REPLY') throw new Retry(err.message);
      throw err;
    }
  }

  function waitInterval(deviceId, targetSec) {
    return new Promise((resolve) => {
      watches.set(deviceId, {
        targetSec,
        ackAt: now(),
        deadline: now() + Math.max(3 * targetSec, 120) * 1000,
        times: [],
        hint: false,
        resolve: (result) => {
          watches.delete(deviceId);
          resolve(result);
        },
      });
    });
  }

  const hintText = (w) => (w.hint ? ' — กล่องอยู่นอก geofence หรือถูกถอด กล่องจึงใช้รอบส่งอื่นแทน A12' : '');

  function onPacket(deviceId, packet, meta) {
    const w = watches.get(deviceId);
    if (!w) return;
    if (HINT_EVENTS.has(packet.eventCode)) w.hint = true;
    if (packet.eventCode !== TRACK_BY_TIME || !packet.time) return;
    const t = Date.parse(packet.time);
    // ตัดสินจากเวลาของกล่อง ไม่ใช่ remainingCache: รอบที่กล่องส่งย้อนหลังหลังต่อสายใหม่ก็เป็นหลักฐานได้
    // ถ้าเวลาอยู่หลังการตั้งค่า · ข้อมูลที่เวลาก่อนตั้งค่าไม่นับ
    if (!(t >= w.ackAt - CLOCK_SKEW_MS) || w.times.includes(t)) return;
    w.times.push(t);
    w.times.sort((a, b) => a - b);
    // แพ็กเก็ตแรกหลังตั้งค่าเป็นรายงานทันทีจากการตั้งค่า ไม่ใช่รอบปกติ → ดูช่วงห่างของแพ็กเก็ตถัดๆ ไป
    const gaps = [];
    for (let i = 2; i < w.times.length; i++) gaps.push(Math.round((w.times[i] - w.times[i - 1]) / 1000));
    const match = gaps.find((g) => Math.abs(g - w.targetSec) <= toleranceSec);
    if (match !== undefined) {
      w.resolve({ ok: true, detail: `ยืนยันจากรอบส่งจริง ${match} วิ` });
    } else if (gaps.length >= MISMATCHES_TO_FAIL) {
      w.resolve({ ok: false, message: `กล่องตอบรับแต่รอบส่งจริงไม่ตรง (ตั้ง ${w.targetSec} วิ ได้ ${gaps.join(', ')} วิ)${hintText(w)}` });
    }
  }

  function checkDeadlines() {
    for (const w of [...watches.values()]) {
      if (now() >= w.deadline) {
        w.resolve({ ok: false, message: `กล่องตอบรับแต่ไม่เห็นรอบส่ง ${w.targetSec} วิ ภายในเวลาที่รอ${hintText(w)}` });
      }
    }
  }

  async function runStep(job, step) {
    const id = job.command_id;
    const dev = job.device_id;
    queue.transition(id, 'SENT', { details: `ส่ง ${step.command} แล้ว` });
    const reply = await send(dev, step.command);
    if (reply.body !== 'OK') {
      queue.transition(id, 'FAILED', {
        errorCode: 'DEVICE_REJECTED',
        errorMessage: `กล่องไม่รับคำสั่ง ${step.command} ของกลุ่ม ${step.group} (ตอบ ${reply.body || 'ว่าง'})`,
        details: step.group,
      });
      return false;
    }
    queue.transition(id, 'ACKED', { details: `กล่องตอบรับ ${step.command}` });
    if (step.verify === 'readback') {
      const back = await send(dev, step.readCommand);
      const actual = parseReadback(step.group, back.body);
      if (!isDeepStrictEqual(actual, step.expected)) {
        queue.transition(id, 'FAILED', {
          errorCode: 'NOT_VERIFIED',
          errorMessage: `กล่องตอบรับแต่ค่าที่อ่านกลับไม่ตรงของกลุ่ม ${step.group} (ได้ ${back.body || 'ว่าง'})`,
          details: step.group,
        });
        return false;
      }
    } else if (step.verify === 'interval') {
      const result = await waitInterval(dev, step.expected.track_interval_sec);
      if (!result.ok) {
        queue.transition(id, 'FAILED', { errorCode: 'NOT_VERIFIED', errorMessage: result.message, details: step.group });
        return false;
      }
      queue.transition(id, 'ACKED', { details: result.detail });
    }
    return true;
  }

  async function runJob(job) {
    try {
      for (const step of job.steps) {
        if (!(await runStep(job, step))) return;
      }
      const last = queue.get(job.command_id).events.at(-1).details;
      queue.transition(job.command_id, 'SUCCESS', { details: last });
    } catch (err) {
      if (!(err instanceof Retry)) {
        log(`งาน ${job.command_id} ผิดพลาด: ${err.message}`);
        queue.transition(job.command_id, 'FAILED', { errorCode: 'HUB_ERROR', errorMessage: 'device-hub ทำงานผิดพลาด', details: err.message });
        return;
      }
      const attempts = queue.get(job.command_id).attempts + 1;
      queue.update(job.command_id, { attempts });
      if (attempts >= maxAttempts) {
        queue.transition(job.command_id, 'FAILED', {
          errorCode: 'DEVICE_NO_REPLY', errorMessage: `กล่องไม่ตอบหลังลองส่ง ${attempts} ครั้ง`, details: err.message,
        });
      } else {
        queue.transition(job.command_id, 'QUEUED', { details: `รอกล่องต่อกลับมา (ส่งไม่สำเร็จครั้งที่ ${attempts}: ${err.message})` });
      }
    }
  }

  async function tick() {
    queue.expireOld();
    checkDeadlines();
    for (const deviceId of queue.deviceIds()) {
      if (running.has(deviceId) || !tcp.isOnline(deviceId)) continue;
      const job = queue.nextRunnable(deviceId);
      if (!job) continue;
      running.add(deviceId);
      runJob(job)
        .catch((err) => log(`งาน ${job.command_id} หยุดกลางทาง (บันทึกคิวไม่ได้?): ${err.message}`))
        .finally(() => running.delete(deviceId)); // ไม่รอ: การยืนยันรอบส่งใช้เวลาหลายนาที
    }
  }

  // ห้าม throw ออกไป — error ที่หลุดจาก setInterval ทำให้ hub ทั้งตัวล่ม (เช่นไฟล์คิวถูก OneDrive/antivirus ล็อกชั่วคราว)
  async function safeTick() {
    try {
      await tick();
    } catch (err) {
      log(`รอบตรวจคิวผิดพลาด: ${err.message}`);
    }
  }

  return { tick: safeTick, onPacket };
}

module.exports = { createExecutor };
