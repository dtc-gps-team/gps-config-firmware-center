const crypto = require('crypto');
const { describeError } = require('./errors');

const TERMINAL = new Set(['SUCCESS', 'FAILED', 'ROLLED_BACK', 'EXPIRED']);
// สถานะที่กล่องรายงานได้ (PENDING/DELIVERED/EXPIRED เป็นของ server)
const DEVICE_STATUSES = new Set(['ACKNOWLEDGED', 'DOWNLOADING', 'VALIDATING', 'INSTALLING', 'REBOOTING', 'SUCCESS', 'FAILED', 'ROLLED_BACK']);
// สถานะที่ยกเลิก/หมดอายุได้อย่างปลอดภัย (ยังไม่เริ่มดาวน์โหลด/ติดตั้ง)
const SAFE_TO_EXPIRE = new Set(['PENDING', 'DELIVERED', 'ACKNOWLEDGED']);
// สถานะที่กล่องต้องออนไลน์ตลอด ถ้าหลุดเกิน disconnectGraceSec = ล้มเหลว
// (INSTALLING/REBOOTING ใช้ rebootTimeoutSec แทน — กล่องเขียน flash แล้วรีบูตเองได้โดยไม่ต้องใช้เน็ต)
const NEEDS_CONNECTION = new Set(['DELIVERED', 'ACKNOWLEDGED', 'DOWNLOADING', 'VALIDATING']);

const isActive = (c) => !TERMINAL.has(c.status);

class CommandService {
  constructor(store, connections, cfg) {
    this.store = store;
    this.connections = connections; // Map device_id -> ws
    this.cfg = cfg;
  }

  get all() {
    return this.store.data.commands;
  }

  find(commandId) {
    return this.all.find((c) => c.command_id === commandId) || null;
  }

  forDevice(deviceId) {
    return this.all.filter((c) => c.device_id === deviceId);
  }

  activeFor(deviceId) {
    return this.forDevice(deviceId)
      .filter(isActive)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  addEvent(cmd, status, details = {}) {
    const now = new Date().toISOString();
    cmd.status = status;
    cmd.updated_at = now;
    cmd.events.push({ status, progress: details.progress_percent ?? null, time: now, details });
    if (TERMINAL.has(status)) {
      cmd.completed_at = now;
      this.notify(cmd);
    }
  }

  // ข้อมูลคำสั่งที่ส่งให้ผู้ใช้ (เพิ่มคำอธิบาย error ภาษาไทย + สถานะการส่ง)
  view(cmd) {
    const online = this.connections.has(cmd.device_id);
    return {
      ...cmd,
      error_message: describeError(cmd.error_code, cmd.error_detail),
      device_online: online,
      waiting_reason: cmd.status === 'PENDING' && cmd.action === 'UPDATE_FIRMWARE' && online
        ? this.firmwareReadiness(cmd.device_id).message
        : cmd.status === 'PENDING' ? (online ? 'กำลังส่ง' : 'กล่องออฟไลน์ — รอส่งเมื่อกล่องออนไลน์') : null,
    };
  }

  // แจ้งผลไป webhook เมื่อคำสั่งจบ (สำเร็จ / ล้มเหลว / หมดอายุ)
  notify(cmd) {
    const url = this.cfg.notifyWebhookUrl;
    if (!url) return;
    const { events, nonce, ...rest } = this.view(cmd);
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.cfg.notifyWebhookToken ? { Authorization: 'Bearer ' + this.cfg.notifyWebhookToken } : {}) },
      body: JSON.stringify({ event: 'COMMAND_FINISHED', success: cmd.status === 'SUCCESS', ...rest }),
      signal: AbortSignal.timeout(5000),
    }).catch((e) => console.warn(`[webhook] ส่งไม่สำเร็จ ${url}: ${e.message}`));
  }

  // ลบออกจากประวัติ: ลบได้เฉพาะคำสั่งที่จบแล้ว คำสั่งที่ยังทำงานอยู่ให้ยกเลิกก่อน
  // จำเวลางาน firmware ล่าสุดไว้ที่กล่อง เพื่อให้เวลารอพร้อม (settleRemainingSec) ยังนับถูก
  dropFinished(cmds) {
    const finished = cmds.filter((c) => !isActive(c));
    if (!finished.length) return 0;
    for (const c of finished) {
      const device = this.store.data.devices[c.device_id];
      if (device && c.action === 'UPDATE_FIRMWARE' && c.completed_at && c.completed_at > (device.last_firmware_done_at || '')) {
        device.last_firmware_done_at = c.completed_at;
      }
    }
    const gone = new Set(finished);
    this.store.data.commands = this.all.filter((c) => !gone.has(c));
    this.store.save();
    return finished.length;
  }

  remove(cmd) {
    return this.dropFinished([cmd]) === 1;
  }

  clearFinished(deviceId) {
    return this.dropFinished(this.forDevice(deviceId));
  }

  // บันทึกคำสั่งลง store ก่อน แล้วค่อยส่ง trigger
  create(deviceId, action, target, ttlSec) {
    if (action === 'UPDATE_FIRMWARE' && this.activeFor(deviceId).some((c) => c.action === 'UPDATE_FIRMWARE')) {
      return { error: 'FIRMWARE_UPDATE_IN_PROGRESS', message: this.firmwareReadiness(deviceId).message };
    }
    // สั่งอัปเดตเป็นเวอร์ชันที่กล่องรันอยู่แล้ว -> ไม่มีอะไรต้องทำ (กันเข้าใจผิดว่าอัปเดตสำเร็จ)
    const running = this.store.data.devices[deviceId]?.firmware_version_reported;
    if (action === 'UPDATE_FIRMWARE' && running && running === target.target_firmware_version) {
      return { error: 'ALREADY_ON_VERSION', message: `กล่อง ${deviceId} ใช้ firmware v${running} อยู่แล้ว ไม่ต้องอัปเดต` };
    }
    // config ใหม่แทนที่ config เก่าที่ยังไม่เริ่มทำ
    if (action === 'UPDATE_CONFIG') {
      for (const old of this.activeFor(deviceId)) {
        if (old.action === 'UPDATE_CONFIG' && SAFE_TO_EXPIRE.has(old.status)) {
          old.error_code = 'SUPERSEDED';
          this.addEvent(old, 'EXPIRED', { reason: 'SUPERSEDED' });
        }
      }
    }

    this.store.data.seq = (this.store.data.seq || 10000) + 1;
    const now = new Date();
    const cmd = {
      command_id: `CMD-${this.store.data.seq}`,
      device_id: deviceId,
      action,
      ...target,
      status: 'PENDING',
      created_at: now.toISOString(),
      delivered_at: null,
      completed_at: null,
      expires_at: new Date(now.getTime() + (ttlSec || this.cfg.commandTtlSec) * 1000).toISOString(),
      error_code: null,
      nonce: crypto.randomBytes(8).toString('hex'),
      events: [],
    };
    this.addEvent(cmd, 'PENDING');
    this.all.push(cmd);
    this.store.save();
    this.deliver(cmd);
    return { cmd };
  }

  message(cmd) {
    const msg = {
      type: 'COMMAND',
      command_id: cmd.command_id,
      device_id: cmd.device_id,
      action: cmd.action,
      issued_at: cmd.created_at,
      expires_at: cmd.expires_at,
      nonce: cmd.nonce,
    };
    if (cmd.target_config_version !== undefined) msg.target_config_version = cmd.target_config_version;
    if (cmd.target_firmware_version !== undefined) msg.target_firmware_version = cmd.target_firmware_version;
    return msg;
  }

  markDelivered(cmd) {
    if (cmd.status !== 'PENDING') return;
    cmd.delivered_at = new Date().toISOString();
    this.addEvent(cmd, 'DELIVERED');
  }

  // เวลาที่เหลือก่อนกล่องพร้อมรับงาน firmware ใหม่: นับจากตอนต่อ Gateway ล่าสุดและตอนงาน firmware ก่อนหน้าจบ
  // ช่วงหลังรีบูต/อัปเดตใหม่ๆ เจอ rollback ได้ (ดู FIRMWARE_SETTLE_SEC ใน .env.example)
  settleRemainingSec(deviceId) {
    const settleMs = (this.cfg.firmwareSettleSec || 0) * 1000;
    if (settleMs <= 0) return 0;
    const lastDone = this.forDevice(deviceId)
      .filter((c) => c.action === 'UPDATE_FIRMWARE' && c.completed_at)
      .reduce((latest, c) => Math.max(latest, new Date(c.completed_at).getTime()),
        new Date(this.store.data.devices[deviceId]?.last_firmware_done_at || 0).getTime());
    const since = Math.max(this.connections.get(deviceId)?.helloAt || 0, lastDone);
    return Math.max(0, Math.ceil((since + settleMs - Date.now()) / 1000));
  }

  // สถานะสำหรับหน้าจอ: READY / SETTLING / QUEUED / BUSY / OFFLINE
  firmwareReadiness(deviceId) {
    const ws = this.connections.get(deviceId);
    const online = Boolean(ws && ws.helloDone && ws.readyState === ws.OPEN);
    const remaining = online ? this.settleRemainingSec(deviceId) : 0;
    const cmd = this.activeFor(deviceId).find((c) => c.action === 'UPDATE_FIRMWARE');
    const base = { ready: false, online, remaining_sec: remaining, active: null };
    if (cmd) {
      const active = {
        command_id: cmd.command_id,
        status: cmd.status,
        target_firmware_version: cmd.target_firmware_version,
        progress: cmd.events.at(-1)?.progress ?? null,
      };
      if (cmd.status !== 'PENDING') {
        return { ...base, state: 'BUSY', active, message: `กำลังอัปเดตเป็น v${cmd.target_firmware_version} (${cmd.command_id}) รอให้เสร็จก่อน` };
      }
      return {
        ...base,
        state: 'QUEUED',
        active,
        message: online
          ? `รอกล่องพร้อมอีก ${remaining} วินาที แล้วจะส่ง v${cmd.target_firmware_version} ให้เอง`
          : `รอกล่องออนไลน์ แล้วจะส่ง v${cmd.target_firmware_version} ให้เอง`,
      };
    }
    if (!online) return { ...base, state: 'OFFLINE', message: 'กล่องออฟไลน์ สั่งไว้ได้ ระบบจะส่งเมื่อกล่องกลับมา' };
    if (remaining > 0) return { ...base, state: 'SETTLING', message: `อีก ${remaining} วินาทีกล่องจะพร้อม สั่งตอนนี้ได้ ระบบจะรอแล้วส่งเอง` };
    return { ...base, state: 'READY', ready: true, message: 'พร้อมอัปเดต' };
  }

  // ส่งให้กล่องถ้าออนไลน์และ HELLO แล้ว (ส่งซ้ำได้ กล่องต้อง dedupe ด้วย command_id)
  deliver(cmd) {
    const ws = this.connections.get(cmd.device_id);
    if (!ws || !ws.helloDone || ws.readyState !== ws.OPEN) return false;
    // หน่วงเฉพาะการส่งครั้งแรก คำสั่งเดิมที่ส่งซ้ำหลังรีบูตต้องไปทันที เพราะกล่องใช้ตัดสินผล OTA
    if (cmd.action === 'UPDATE_FIRMWARE' && cmd.status === 'PENDING' && this.settleRemainingSec(cmd.device_id) > 0) return false;
    ws.send(JSON.stringify(this.message(cmd)));
    this.markDelivered(cmd);
    this.store.save();
    return true;
  }

  deliverPending(deviceId) {
    for (const cmd of this.activeFor(deviceId)) this.deliver(cmd);
  }

  // รับ COMMAND_STATUS จากกล่อง; hello = ข้อมูล HELLO ล่าสุดของ connection นี้
  applyStatus(deviceId, msg, hello) {
    const cmd = this.find(msg.command_id);
    if (!cmd || cmd.device_id !== deviceId) return { error: 'UNKNOWN_COMMAND' };
    // คำสั่งจบไปแล้ว: ตอบสถานะเดิม (idempotent) แต่เก็บสิ่งที่กล่องรายงานมาช้าไว้ดูย้อนหลัง
    if (TERMINAL.has(cmd.status)) {
      this.recordLateReport(cmd, msg);
      return { cmd, duplicate: true };
    }
    if (!DEVICE_STATUSES.has(msg.status)) return { error: 'INVALID_STATUS' };

    if (msg.progress_percent !== undefined && msg.progress_percent !== null &&
        !(Number.isInteger(msg.progress_percent) && msg.progress_percent >= 0 && msg.progress_percent <= 100)) {
      return { error: 'INVALID_PROGRESS' };
    }

    // SUCCESS ต้องยืนยันจากเวอร์ชันที่รันจริง ไม่ใช่แค่รับคำสั่ง/ดาวน์โหลดเสร็จ
    if (msg.status === 'SUCCESS') {
      if (cmd.action === 'UPDATE_FIRMWARE') {
        if (msg.reported_firmware_version !== cmd.target_firmware_version || hello.firmware_version !== cmd.target_firmware_version) {
          return { error: 'SUCCESS_NOT_VERIFIED', message: 'firmware_version จาก HELLO หลังรีบูต และ reported_firmware_version ต้องตรงกับ target' };
        }
      } else if (cmd.action === 'UPDATE_CONFIG') {
        if (msg.reported_config_version !== cmd.target_config_version) {
          return { error: 'SUCCESS_NOT_VERIFIED', message: 'reported_config_version ต้องตรงกับ target_config_version' };
        }
      }
    }

    if (msg.status === cmd.status && (msg.progress_percent ?? null) === cmd.events.at(-1)?.progress) {
      return { cmd, duplicate: true };
    }

    cmd.error_code = msg.error_code ?? cmd.error_code;
    if (typeof msg.error_detail === 'string' && msg.error_detail) cmd.error_detail = msg.error_detail.slice(0, 300);
    this.addEvent(cmd, msg.status, {
      progress_percent: msg.progress_percent ?? null,
      reported_firmware_version: msg.reported_firmware_version ?? null,
      reported_config_version: msg.reported_config_version ?? null,
      error_code: msg.error_code ?? null,
    });

    const device = this.store.data.devices[deviceId];
    if (msg.status === 'SUCCESS' && cmd.action === 'UPDATE_CONFIG') device.config_version_reported = msg.reported_config_version;
    if (msg.status === 'SUCCESS' && cmd.action === 'UPDATE_FIRMWARE') device.firmware_version_reported = msg.reported_firmware_version;
    this.store.save();
    return { cmd };
  }

  // บันทึก event LATE_REPORT โดยไม่เปลี่ยน cmd.status (จึงไม่ใช้ addEvent)
  recordLateReport(cmd, msg) {
    if (!DEVICE_STATUSES.has(msg.status)) return;
    // กล่องส่งผลสุดท้ายของตัวเองซ้ำ (เช่น STATUS_ACK หาย) ไม่ใช่รายงานช้า
    const last = cmd.events.findLast((e) => e.status !== 'LATE_REPORT');
    if (last && last.status === msg.status && !last.details?.reason) return;
    const details = {
      reported_status: msg.status,
      progress_percent: msg.progress_percent ?? null,
      reported_firmware_version: msg.reported_firmware_version ?? null,
      reported_config_version: msg.reported_config_version ?? null,
      error_code: msg.error_code ?? null,
      error_detail: typeof msg.error_detail === 'string' ? msg.error_detail.slice(0, 300) : null,
    };
    // รายงานเดิมซ้ำทุกครั้งที่ reconnect -> เก็บครั้งเดียว
    const same = JSON.stringify(details);
    if (cmd.events.some((e) => e.status === 'LATE_REPORT' && JSON.stringify(e.details) === same)) return;
    cmd.events.push({ status: 'LATE_REPORT', progress: details.progress_percent, time: new Date().toISOString(), details });
    this.store.save();
  }

  cancel(cmd) {
    if (!SAFE_TO_EXPIRE.has(cmd.status)) return false;
    cmd.error_code = 'CANCELLED';
    this.addEvent(cmd, 'EXPIRED', { reason: 'CANCELLED' });
    this.store.save();
    return true;
  }

  expireSweep() {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const { deliveryTimeoutSec, responseTimeoutSec, rebootTimeoutSec, disconnectGraceSec } = this.cfg;
    let changed = false;
    for (const cmd of this.all) {
      if (!isActive(cmd)) continue;
      const idleSec = (nowMs - new Date(cmd.updated_at || cmd.created_at).getTime()) / 1000;
      const offlineSince = this.disconnectedSince(cmd);

      // กล่องหลุดระหว่างทำคำสั่ง (ก่อนรีบูต) และไม่กลับมาภายในเวลาที่กำหนด
      if (disconnectGraceSec > 0 && NEEDS_CONNECTION.has(cmd.status) && offlineSince !== null &&
          (nowMs - offlineSince) / 1000 > disconnectGraceSec) {
        cmd.error_code = 'DEVICE_DISCONNECTED';
        this.addEvent(cmd, 'FAILED', { reason: 'DEVICE_DISCONNECTED', last_status: cmd.status });
        changed = true;
      // ไปไม่ถึงกล่อง: กล่องออฟไลน์ตั้งแต่สร้างคำสั่งจนเกินเวลา
      } else if (cmd.status === 'PENDING' && deliveryTimeoutSec > 0 && idleSec > deliveryTimeoutSec) {
        cmd.error_code = 'DEVICE_OFFLINE';
        this.addEvent(cmd, 'FAILED', { reason: 'DEVICE_OFFLINE' });
        changed = true;
      // ส่งถึงแล้วแต่กล่องเงียบ (ไม่รายงานความคืบหน้า)
      } else if (cmd.status !== 'PENDING' && responseTimeoutSec > 0 &&
                 idleSec > (['REBOOTING', 'INSTALLING'].includes(cmd.status) ? rebootTimeoutSec : responseTimeoutSec)) {
        cmd.error_code = 'DEVICE_NO_RESPONSE';
        this.addEvent(cmd, 'FAILED', { reason: 'DEVICE_NO_RESPONSE', last_status: cmd.status });
        changed = true;
      } else if (SAFE_TO_EXPIRE.has(cmd.status) && cmd.expires_at < now) {
        cmd.error_code = 'TTL_EXPIRED';
        this.addEvent(cmd, 'EXPIRED', { reason: 'TTL_EXPIRED' });
        changed = true;
      }
    }
    if (changed) this.store.save();
    // งาน firmware ที่รอกล่องพร้อม: ครบเวลาแล้วส่งเอง
    for (const cmd of this.all) {
      if (cmd.action === 'UPDATE_FIRMWARE' && cmd.status === 'PENDING') this.deliver(cmd);
    }
  }

  // เวลา (ms) ที่กล่องหลุดหลังได้รับคำสั่งนี้แล้ว หรือ null
  // (ข้าม disconnected_at ที่เก่ากว่าตอนส่งคำสั่ง เช่น กล่องที่ดึงคำสั่งผ่าน REST)
  disconnectedSince(cmd) {
    const at = this.store.data.devices[cmd.device_id]?.disconnected_at;
    if (!at) return null;
    const ms = new Date(at).getTime();
    if (cmd.delivered_at && ms < new Date(cmd.delivered_at).getTime()) return null;
    return ms;
  }
}

module.exports = { CommandService, TERMINAL };
