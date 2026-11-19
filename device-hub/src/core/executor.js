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
    if (packet.eventCode !== TRACK_BY_TIME || meta.remainingCache > 0 || !packet.time) return;
    const t = Date.parse(packet.time);
    if (!(t >= w.ackAt - CLOCK_SKEW_MS)) return; // ข้อมูลเก่าก่อนกล่องตอบรับ
    w.times.push(t);
    // แพ็กเก็ตแรกหลังตั้งค่าเป็นรายงานทันทีจากการตั้งค่า ไม่ใช่รอบปกติ → ใช้ช่วงห่างของแพ็กเก็ตที่ 2 กับ 3
    if (w.times.length < 3) return;
    const gap = Math.round((w.times[2] - w.times[1]) / 1000);
    if (Math.abs(gap - w.targetSec) <= toleranceSec) w.resolve({ ok: true, detail: `ยืนยันจากรอบส่งจริง ${gap} วิ` });
    else w.resolve({ ok: false, message: `กล่องตอบรับแต่รอบส่งจริงไม่ตรง (ตั้ง ${w.targetSec} วิ ได้ ${gap} วิ)${hintText(w)}` });
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
      runJob(job).finally(() => running.delete(deviceId)); // ไม่รอ: การยืนยันรอบส่งใช้เวลาหลายนาที
    }
  }

  return { tick, onPacket };
}

module.exports = { createExecutor };
