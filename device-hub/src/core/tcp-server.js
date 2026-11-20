// รับการเชื่อมต่อ TCP จากกล่อง Meitrack ส่งคำสั่ง และจับคู่คำตอบด้วย data identifier (docs/33 D7/D8)
// ยกตรรกะจาก gateway ทดลอง (17 พ.ย. 2569) — ไม่มีช่องรับคำสั่งดิบจากคน: คำสั่งมาจาก executor เท่านั้น
'use strict';
const net = require('node:net');
const { buildCommand, extractFrames, parseFrame, parseCCE } = require('../protocols/meitrack/frame');

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// 'TA255L-V028,<SN>' → 'V028'
function parseFirmwareVersion(body) {
  const first = body.split(',')[0].trim();
  if (!first) return null;
  const dash = first.lastIndexOf('-');
  return dash >= 0 ? first.slice(dash + 1) : first;
}

function createTcpServer({
  port, host, devices, // host ไม่ระบุ = ฟังทั้ง IPv4 และ IPv6 (ssh tunnel บน Windows ต่อ localhost ทาง ::1)
  log = () => {}, rawLog = () => {},
  onPacket = () => {}, onOnline = () => {}, onOffline = () => {},
  commandTimeoutMs = 30000, maxConnectionsPerIp = 5, maxJunkBytes = 64 * 1024,
  // สายเงียบนานเกิน max(idleMinMs, 3 × ช่วงห่างที่ยาวที่สุดที่เห็นจากกล่อง) = สายตายแบบเงียบ → ตัดเอง (docs/33 §11.6 ข้อ 4)
  idleMinMs = 120000,
}) {
  const sessions = new Map(); // imei -> conn
  const lastSeen = new Map(); // imei -> ISO
  const firmware = new Map(); // imei -> version
  // คำสั่งที่รอคำตอบ ผูกกับกล่อง ไม่ใช่สาย: สายหลุดแล้วกล่องต่อใหม่ตอบด้วย identifier เดิมยังนับ (docs/33 §11.6 ข้อ 3)
  const pendingByImei = new Map(); // imei -> Map<identifier, { code, timer, resolve, reject }>
  // ช่วงห่าง (ms) ระหว่างข้อมูลจากกล่องล่าสุด — ติดไปกับกล่องข้ามสาย จะได้ไม่เริ่มนับจากค่าต่ำสุดทุกครั้งที่ต่อใหม่
  const gapsByImei = new Map(); // imei -> number[]
  // เวลาข้อมูลล่าสุดของกล่อง (ข้ามสาย): ช่วงห่างจากสายเก่าถึงสายใหม่ก็นับ — กล่องที่ตั้งรอบส่งนานกว่า idleMinMs
  // ถูกตัดสายผิดได้ครั้งเดียว ต่อกลับมาแล้วเกณฑ์ปรับตามรอบจริง ไม่วนถูกตัดทุกรอบ
  const lastDataAtByImei = new Map(); // imei -> ms
  const IDLE_FACTOR = 3;
  const GAP_WINDOW = 10;
  // ช่วงห่างสั้นมาก (ข้อมูลค้างที่กล่องส่งรวดหลังต่อสาย) ไม่บอกรอบส่ง ไม่เก็บ ไม่งั้นจะไล่ช่วงห่างจริงออกจากหน้าต่าง
  const minCountedGapMs = idleMinMs / 100;
  // ip -> จำนวนสายที่ยังไม่ระบุตัว · สายที่ระบุตัวเป็นกล่องในทะเบียนแล้วไม่นับ (ซิมหลายเครื่องอาจออก IP เดียวกันหลัง CGNAT)
  const perIp = new Map();
  const sockets = new Set(); // ทุกสายที่เปิดอยู่ (รวมสายที่ยังไม่ระบุตัว) — ปิดให้หมดตอน close()
  let nextId = 0x41;

  function newIdentifier() {
    const c = String.fromCharCode(nextId);
    nextId = nextId >= 0x7a ? 0x41 : nextId + 1;
    if (nextId > 0x5a && nextId < 0x61) nextId = 0x61; // ข้าม [ \ ] ^ _ `
    return c;
  }

  function pendingOf(imei) {
    let pending = pendingByImei.get(imei);
    if (!pending) {
      pending = new Map();
      pendingByImei.set(imei, pending);
    }
    return pending;
  }

  function settle(imei, identifier, value) {
    const pending = pendingByImei.get(imei)?.get(identifier);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingByImei.get(imei).delete(identifier);
    pending.resolve(value);
  }

  function failAll(err) {
    for (const pending of pendingByImei.values()) {
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      pending.clear();
    }
  }

  function idleLimitMs(imei) {
    const gaps = imei ? gapsByImei.get(imei) ?? [] : [];
    return Math.max(idleMinMs, IDLE_FACTOR * Math.max(0, ...gaps));
  }

  // เรียกทุกครั้งที่ได้ข้อมูลจากกล่อง: เก็บช่วงห่าง แล้วตั้งเวลาตัดสายใหม่
  function noteActivity(conn) {
    const at = Date.now();
    if (conn.imei) {
      const last = lastDataAtByImei.get(conn.imei);
      const gap = last === undefined ? 0 : at - last;
      if (gap >= minCountedGapMs) {
        const gaps = gapsByImei.get(conn.imei) ?? [];
        gaps.push(gap);
        if (gaps.length > GAP_WINDOW) gaps.shift();
        gapsByImei.set(conn.imei, gaps);
      }
      lastDataAtByImei.set(conn.imei, at);
    }
    conn.socket.setTimeout(idleLimitMs(conn.imei));
  }

  function release(conn) {
    if (!conn.counted) return;
    conn.counted = false;
    const left = (perIp.get(conn.ip) ?? 1) - 1;
    if (left <= 0) perIp.delete(conn.ip);
    else perIp.set(conn.ip, left);
  }

  function goOnline(conn, imei) {
    conn.imei = imei;
    release(conn);
    const old = sessions.get(imei);
    sessions.set(imei, conn);
    if (old && old !== conn) old.socket.destroy(); // สายใหม่แทนสายเก่า
    log(`กล่อง IMEI ${imei} เชื่อมต่อแล้ว (${conn.remote})`);
    onOnline(imei);
    if (!firmware.has(imei)) {
      sendCommand(imei, 'E91')
        .then((r) => {
          const v = parseFirmwareVersion(r.body);
          if (v) firmware.set(imei, v);
        })
        .catch(() => {}); // ไม่ได้เวอร์ชันก็ทำงานต่อได้ ลองใหม่ตอนต่อครั้งหน้า
    }
  }

  function handleFrame(conn, frame) {
    const f = parseFrame(frame);
    rawLog('IN ', f.imei, frame);
    if (!f.checksumOk) log(`checksum ไม่ตรง (ได้ ${f.checksumGot} ควรเป็น ${f.checksumWant}) imei=${f.imei}`);
    if (!conn.imei) {
      if (!devices.has(f.imei)) {
        log(`ปฏิเสธกล่อง IMEI ${f.imei} (ไม่อยู่ในทะเบียนเครื่อง) ปิดการเชื่อมต่อ`);
        conn.socket.destroy();
        return;
      }
      goOnline(conn, f.imei);
    }
    lastSeen.set(conn.imei, new Date().toISOString());
    const pending = pendingByImei.get(conn.imei)?.get(f.identifier);
    if (pending && f.type === pending.code) {
      settle(conn.imei, f.identifier, { type: f.type, body: f.body.toString('latin1') });
      return;
    }
    if (f.type === 'CCE' || f.type === 'AAA') {
      if (pending) settle(conn.imei, f.identifier, { type: 'CCE', body: '' }); // เช่น A10 ตอบเป็นแพ็กเก็ตพิกัด
      if (f.type !== 'CCE') return;
      let cce;
      try {
        cce = parseCCE(f.body);
      } catch (err) {
        log(`แปลแพ็กเก็ต CCE ไม่ได้ (${err.message}) ดู hex ใน raw log`);
        return;
      }
      const receivedAt = Date.now();
      for (const packet of cce.packets) onPacket(conn.imei, packet, { remainingCache: cce.remainingCache, receivedAt });
      return;
    }
    log(`ข้อความจากกล่อง ${conn.imei}: ${f.type} ${f.body.toString('latin1')}`);
  }

  const server = net.createServer((socket) => {
    sockets.add(socket);
    const ip = socket.remoteAddress;
    const count = (perIp.get(ip) ?? 0) + 1;
    perIp.set(ip, count);
    const conn = { socket, ip, counted: true, imei: null, buf: Buffer.alloc(0), junk: 0, remote: `${ip}:${socket.remotePort}` };
    socket.on('close', () => {
      sockets.delete(socket);
      release(conn);
      // คำสั่งที่รอคำตอบไม่ตัดทิ้งตรงนี้ — รอจนครบ commandTimeoutMs เผื่อกล่องต่อสายใหม่แล้วตอบ
      if (conn.imei && sessions.get(conn.imei) === conn) {
        sessions.delete(conn.imei);
        log(`การเชื่อมต่อปิด IMEI ${conn.imei}`);
        onOffline(conn.imei);
      }
    });
    socket.on('error', (e) => log(`socket error ${e.message}`));
    if (count > maxConnectionsPerIp) {
      log(`ปฏิเสธการเชื่อมต่อจาก ${ip}: มีสายที่ยังไม่ระบุตัวค้างเกิน ${maxConnectionsPerIp} สาย`);
      socket.destroy();
      return;
    }
    socket.setKeepAlive(true, 60000);
    socket.setTimeout(idleLimitMs(null));
    socket.on('timeout', () => {
      log(`ตัดการเชื่อมต่อ ${conn.imei ?? conn.remote}: ไม่มีข้อมูลจากกล่องเกิน ${Math.round(idleLimitMs(conn.imei) / 1000)} วินาที (สายอาจตายแบบเงียบ)`);
      socket.destroy();
    });
    socket.on('data', (chunk) => {
      conn.buf = Buffer.concat([conn.buf, chunk]);
      const { frames, junk, rest } = extractFrames(conn.buf);
      conn.buf = Buffer.from(rest);
      for (const j of junk) {
        rawLog('JNK', conn.imei, j);
        conn.junk += j.length;
      }
      if (conn.junk > maxJunkBytes || conn.buf.length > maxJunkBytes) {
        log(`ตัดการเชื่อมต่อ ${conn.remote}: ข้อมูลที่ไม่ใช่ frame ของกล่องเกิน ${maxJunkBytes} ไบต์`);
        socket.destroy();
        return;
      }
      for (const fr of frames) {
        if (socket.destroyed) return;
        handleFrame(conn, fr);
      }
      if (frames.length > 0 && !socket.destroyed) noteActivity(conn);
    });
  });

  function sendCommand(imei, command) {
    const conn = sessions.get(imei);
    if (!conn) return Promise.reject(codedError('DEVICE_OFFLINE', `กล่อง ${imei} ไม่ได้เชื่อมต่ออยู่`));
    const code = command.split(',')[0];
    const id = newIdentifier();
    const pending = pendingOf(imei);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(codedError('DEVICE_NO_REPLY', `กล่องไม่ตอบ ${code} ภายใน ${commandTimeoutMs / 1000} วินาที`));
      }, commandTimeoutMs);
      pending.set(id, { code, timer, resolve, reject });
      const buf = buildCommand(id, imei, command);
      conn.socket.write(buf);
      rawLog('OUT', imei, buf);
      log(`ส่งคำสั่งถึง ${imei}: ${command}`);
    });
  }

  return {
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve(server.address().port));
    }),
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      failAll(codedError('DEVICE_NO_REPLY', 'device-hub ปิดก่อนกล่องตอบ'));
      server.close(() => resolve());
    }),
    isOnline: (imei) => sessions.has(imei),
    lastSeenAt: (imei) => lastSeen.get(imei) ?? null,
    firmwareVersion: (imei) => firmware.get(imei) ?? null,
    sendCommand,
  };
}

module.exports = { createTcpServer };
