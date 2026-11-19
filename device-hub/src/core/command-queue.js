// คิวคำสั่งต่อเครื่อง + สถานะ Config ของเครื่อง เก็บลงไฟล์ JSON (docs/33 D5)
// - งาน (Job) มีรูปเดียวกับคำสั่งของ Server กลาง (RawCentralCommand) ให้ backend อ่านได้ด้วยตัวอ่านเดิม
// - สร้างงานใหม่ → งานเก่าของเครื่องเดียวกันที่ยัง QUEUED ถูกแทนที่ (SUPERSEDED) · งานที่กำลังส่งไม่ถูกแทนที่
// - QUEUED เกิน ttlHours → EXPIRED/TTL_EXPIRED (backend นับเป็น "ข้าม: กล่องออฟไลน์")
// - เริ่มระบบใหม่: งาน SENT/ACKED ไม่รู้ผล → กลับเป็น QUEUED ให้ส่งใหม่
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TERMINAL = new Set(['SUCCESS', 'FAILED', 'EXPIRED']);
const IN_FLIGHT = new Set(['SENT', 'ACKED']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, extra) {
  const out = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(extra ?? {})) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

function createCommandQueue({ file, ttlHours, now = Date.now, newId = () => `hub-${crypto.randomUUID()}` }) {
  let data = { jobs: [], devices: {} };
  if (fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`อ่านไฟล์คิวคำสั่ง ${file} ไม่ได้ (${err.message}) — แก้หรือย้ายไฟล์ออกก่อนเริ่มใหม่`);
    }
  }
  const iso = () => new Date(now()).toISOString();

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file); // กันไฟล์เสียครึ่งๆ ตอนเครื่องดับ
  }

  function state(deviceId) {
    data.devices[deviceId] ??= { desiredVersion: 0, reportedVersion: null, reportedSettings: null, reportedAt: null };
    return data.devices[deviceId];
  }

  function find(commandId) {
    return data.jobs.find((j) => j.command_id === commandId) ?? null;
  }

  function apply(job, status, { errorCode = null, errorMessage = null, details = null } = {}) {
    job.status = status;
    if (status === 'QUEUED' || status === 'SENT' || status === 'ACKED' || status === 'SUCCESS') {
      job.error_code = null;
      job.error_message = null;
    } else {
      job.error_code = errorCode;
      job.error_message = errorMessage;
    }
    job.waiting_reason = status === 'QUEUED' ? (details ?? job.waiting_reason) : null;
    job.events.push({ status, time: iso(), details });
    if (status === 'SUCCESS') {
      const s = state(job.device_id);
      s.reportedVersion = job.target_config_version;
      s.reportedSettings = deepMerge(s.reportedSettings, job.settings);
      s.reportedAt = iso();
    }
  }

  // เริ่มระบบใหม่: งานที่ค้างกลางทางไม่รู้ผล → ส่งใหม่
  let recovered = false;
  for (const job of data.jobs) {
    if (IN_FLIGHT.has(job.status)) {
      apply(job, 'QUEUED', { details: 'เริ่มระบบใหม่ระหว่างส่ง — จะส่งใหม่เมื่อกล่องเชื่อมต่อ' });
      recovered = true;
    }
  }
  if (recovered) save();

  function create(deviceId, settings, steps) {
    for (const job of data.jobs) {
      if (job.device_id === deviceId && job.status === 'QUEUED') {
        apply(job, 'FAILED', { errorCode: 'SUPERSEDED', errorMessage: 'มีคำสั่งใหม่ของกล่องนี้มาแทน', details: 'ถูกแทนที่ด้วยคำสั่งใหม่' });
      }
    }
    const s = state(deviceId);
    s.desiredVersion += 1;
    const created = now();
    const job = {
      command_id: newId(),
      device_id: deviceId,
      action: 'config',
      status: 'QUEUED',
      target_config_version: s.desiredVersion,
      error_code: null,
      error_message: null,
      waiting_reason: 'รอส่งให้กล่อง',
      events: [{ status: 'QUEUED', time: new Date(created).toISOString(), details: 'รับคำสั่งแล้ว' }],
      settings,
      steps,
      attempts: 0,
      created_at: new Date(created).toISOString(),
      expires_at: new Date(created + ttlHours * 3_600_000).toISOString(),
    };
    data.jobs.push(job);
    save();
    return job;
  }

  function transition(commandId, status, info) {
    const job = find(commandId);
    if (!job) throw new Error(`ไม่พบคำสั่ง ${commandId}`);
    if (TERMINAL.has(job.status)) throw new Error(`คำสั่ง ${commandId} จบแล้ว (${job.status})`);
    apply(job, status, info);
    save();
    return job;
  }

  function update(commandId, patch) {
    const job = find(commandId);
    if (!job) throw new Error(`ไม่พบคำสั่ง ${commandId}`);
    Object.assign(job, patch);
    save();
    return job;
  }

  function nextRunnable(deviceId) {
    const mine = data.jobs.filter((j) => j.device_id === deviceId);
    if (mine.some((j) => IN_FLIGHT.has(j.status))) return null;
    return mine.find((j) => j.status === 'QUEUED') ?? null;
  }

  function expireOld() {
    const t = now();
    const expired = [];
    for (const job of data.jobs) {
      if (job.status === 'QUEUED' && Date.parse(job.expires_at) <= t) {
        apply(job, 'EXPIRED', { errorCode: 'TTL_EXPIRED', errorMessage: 'กล่องไม่ได้เชื่อมต่อภายในเวลาที่กำหนด', details: 'หมดเวลารอกล่อง' });
        expired.push(job);
      }
    }
    if (expired.length) save();
    return expired;
  }

  return {
    create,
    get: find,
    listForDevice: (deviceId) => data.jobs.filter((j) => j.device_id === deviceId)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    nextRunnable,
    transition,
    update,
    expireOld,
    deviceState: (deviceId) => ({ ...state(deviceId) }),
    deviceIds: () => [...new Set(data.jobs.map((j) => j.device_id))],
  };
}

module.exports = { createCommandQueue };
