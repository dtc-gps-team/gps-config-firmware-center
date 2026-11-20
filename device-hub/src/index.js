// จุดเริ่มของ device-hub — ประกอบทุกส่วนเข้าด้วยกัน (docs/33)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, loadDevices } = require('./config');
const { createTcpServer } = require('./core/tcp-server');
const { createTelemetryForwarder } = require('./core/telemetry-forwarder');
const { createCommandQueue } = require('./core/command-queue');
const { createExecutor } = require('./core/executor');
const { startHttpApi } = require('./core/http-api');
const { toTelemetryReport } = require('./protocols/meitrack/telemetry');
const fields = require('./protocols/meitrack/fields');

function createLogger(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const day = () => new Date().toISOString().slice(0, 10);
  return {
    // log อ่านง่าย (เวลาเป็น UTC)
    log(line) {
      const ts = new Date().toISOString();
      console.log(`${ts.slice(11, 19)} ${line}`);
      fs.appendFileSync(path.join(logDir, `${day()}.log`), `${ts} ${line}\n`);
    },
    // ทุกข้อความเข้า/ออกเป็น hex ไว้แกะย้อนหลัง
    rawLog(dir, imei, buf) {
      fs.appendFileSync(path.join(logDir, `${day()}.raw.log`), `${new Date().toISOString()} ${dir} ${imei || '?'} ${buf.toString('hex')}\n`);
    },
  };
}

async function main() {
  const config = loadConfig();
  const devices = loadDevices(config.devicesFile);
  const { log, rawLog } = createLogger(config.logDir);

  const forwarder = createTelemetryForwarder({ backendUrl: config.backendUrl, devices, log });
  if (!config.backendUrl) log('ไม่ได้ตั้ง DEVICE_HUB_BACKEND_URL — รับพิกัดแต่ไม่ส่งเข้า backend');

  // ส่วนรับ Config (ช่วง B) เปิดเฉพาะเมื่อตั้งชื่อผู้ใช้/รหัสผ่านของ API แล้ว
  const commandsEnabled = Boolean(config.adminUsername && config.adminPassword);
  const queue = commandsEnabled
    ? createCommandQueue({ file: path.join(config.dataDir, 'queue.json'), ttlHours: config.queueTtlHours })
    : null;
  let executor = null;

  const tcp = createTcpServer({
    port: config.tcpPort, devices, log, rawLog, idleMinMs: config.idleMinSec * 1000,
    onPacket: (imei, packet, meta) => {
      log(`พิกัดจาก ${imei}: ${packet.event ?? ''} ${packet.time ?? ''} lat ${packet.lat} lng ${packet.lng}` +
        (meta.remainingCache ? ` (ค้างในกล่อง ${meta.remainingCache})` : ''));
      forwarder.enqueue(imei, toTelemetryReport(packet, { imei, firmwareVersion: tcp.firmwareVersion(imei) }));
      executor?.onPacket(imei, packet, meta);
    },
  });
  const port = await tcp.listen();
  log(`device-hub รอกล่องที่ TCP port ${port} (ทะเบียน ${devices.size} เครื่อง)`);
  setInterval(() => { forwarder.pump(); }, 1000);

  if (!commandsEnabled) {
    log('ไม่ได้ตั้ง DEVICE_HUB_ADMIN_USERNAME / DEVICE_HUB_ADMIN_PASSWORD — ปิดส่วนรับ Config (รับพิกัดอย่างเดียว)');
    return;
  }
  executor = createExecutor({ queue, tcp, parseReadback: fields.parseReadback, log });
  setInterval(() => { executor.tick(); }, 1000);
  const http = await startHttpApi({ config, devices, tcp, queue, fieldsByModel: new Map([[fields.MODEL, fields]]) });
  log(`device-hub รับ Config ที่ http://${config.httpHost}:${http.port}`);
}

main().catch((err) => {
  console.error(`device-hub เริ่มทำงานไม่ได้: ${err.message}`);
  process.exit(1);
});
