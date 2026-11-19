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
  port, host = '0.0.0.0', devices, log = () => {}, rawLog = () => {},
  onPacket = () => {}, onOnline = () => {}, onOffline = () => {},
  commandTimeoutMs = 30000, maxConnectionsPerIp = 5, maxJunkBytes = 64 * 1024,
}) {
  const sessions = new Map(); // imei -> conn
  const lastSeen = new Map(); // imei -> ISO
  const firmware = new Map(); // imei -> version
  const perIp = new Map(); // ip -> จำนวนสายที่เปิดอยู่
  const sockets = new Set(); // ทุกสายที่เปิดอยู่ (รวมสายที่ยังไม่ระบุตัว) — ปิดให้หมดตอน close()
  let nextId = 0x41;

  function newIdentifier() {
    const c = String.fromCharCode(nextId);
    nextId = nextId >= 0x7a ? 0x41 : nextId + 1;
    if (nextId > 0x5a && nextId < 0x61) nextId = 0x61; // ข้าม [ \ ] ^ _ `
    return c;
  }

  function settle(conn, identifier, value) {
    const pending = conn.pending.get(identifier);
    if (!pending) return;
    clearTimeout(pending.timer);
    conn.pending.delete(identifier);
    pending.resolve(value);
  }

  function failAll(conn, err) {
    for (const p of conn.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    conn.pending.clear();
  }

  function goOnline(conn, imei) {
    conn.imei = imei;
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
    const pending = conn.pending.get(f.identifier);
    if (pending && f.type === pending.code) {
      settle(conn, f.identifier, { type: f.type, body: f.body.toString('latin1') });
      return;
    }
    if (f.type === 'CCE' || f.type === 'AAA') {
      if (pending) settle(conn, f.identifier, { type: 'CCE', body: '' }); // เช่น A10 ตอบเป็นแพ็กเก็ตพิกัด
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
    const conn = { socket, imei: null, pending: new Map(), buf: Buffer.alloc(0), junk: 0, remote: `${ip}:${socket.remotePort}` };
    socket.on('close', () => {
      sockets.delete(socket);
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left <= 0) perIp.delete(ip);
      else perIp.set(ip, left);
      failAll(conn, codedError('DEVICE_NO_REPLY', 'การเชื่อมต่อปิดก่อนกล่องตอบ'));
      if (conn.imei && sessions.get(conn.imei) === conn) {
        sessions.delete(conn.imei);
        log(`การเชื่อมต่อปิด IMEI ${conn.imei}`);
        onOffline(conn.imei);
      }
    });
    socket.on('error', (e) => log(`socket error ${e.message}`));
    if (count > maxConnectionsPerIp) {
      log(`ปฏิเสธการเชื่อมต่อจาก ${ip}: เปิดค้างเกิน ${maxConnectionsPerIp} สาย`);
      socket.destroy();
      return;
    }
    socket.setKeepAlive(true, 60000);
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
    });
  });

  function sendCommand(imei, command) {
    const conn = sessions.get(imei);
    if (!conn) return Promise.reject(codedError('DEVICE_OFFLINE', `กล่อง ${imei} ไม่ได้เชื่อมต่ออยู่`));
    const code = command.split(',')[0];
    const id = newIdentifier();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(codedError('DEVICE_NO_REPLY', `กล่องไม่ตอบ ${code} ภายใน ${commandTimeoutMs / 1000} วินาที`));
      }, commandTimeoutMs);
      conn.pending.set(id, { code, timer, resolve, reject });
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
      server.close(() => resolve());
    }),
    isOnline: (imei) => sessions.has(imei),
    lastSeenAt: (imei) => lastSeen.get(imei) ?? null,
    firmwareVersion: (imei) => firmware.get(imei) ?? null,
    sendCommand,
  };
}

module.exports = { createTcpServer };
