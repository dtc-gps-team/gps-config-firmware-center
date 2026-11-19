// สร้างข้อมูลทดสอบรูปแบบ Meitrack TA255 — ใช้เฉพาะค่าตัวอย่างจากเอกสาร (IMEI 353358017784062, พิกัดเซินเจิ้น)
// ห้ามใส่ IMEI / พิกัด / log จากกล่องจริง (repo เป็น public)
'use strict';
const { checksum } = require('../../src/protocols/meitrack/frame');

const SAMPLE_IMEI = '353358017784062';
const Y2000 = Date.UTC(2000, 0, 1);

// แพ็กเก็ต CCE 1 ชุด · time = ISO string · ค่าตั้งต้นตามตารางตัวอย่างในเอกสาร
function ccePacket({
  eventCode = 35, gpsValid = 1, satellites = 10, lat = 22.513638, lng = 114.05719,
  time = '2018-06-04T07:16:26.000Z', speedKmh = 21, mileage = 0x0a0d0d0a, battery = null,
} = {}) {
  const p = [];
  const u8 = (v) => p.push(v & 0xff);
  const u16 = (v) => { u8(v); u8(v >> 8); };
  const u32 = (v) => { u16(v & 0xffff); u16((v >>> 16) & 0xffff); };
  const secs = Math.round((Date.parse(time) - Y2000) / 1000);
  u16(0); // จำนวน id ทั้งหมด (parser ไม่ใช้)
  u8(3); u8(0x05); u8(gpsValid); u8(0x06); u8(satellites); u8(0x07); u8(28);
  const twoByte = [[0x08, speedKmh], [0x1a, 1366], [0x40, eventCode]];
  u8(twoByte.length + (battery === null ? 0 : 1));
  for (const [id, v] of twoByte) { u8(id); u16(v); }
  if (battery !== null) { u8(0xfe); u8(0xa8); u16(battery); } // id 2 byte (0xFEA8)
  u8(4);
  u8(0x02); u32(Math.round(lat * 1e6)); u8(0x03); u32(Math.round(lng * 1e6));
  u8(0x04); u32(secs); u8(0x0c); u32(mileage); // ค่า mileage เริ่มต้นมี 0D 0A อยู่ข้างใน
  u8(0);
  return Buffer.from(p);
}

// frame $$…CCE…*CS\r\n หนึ่ง frame มีหลายแพ็กเก็ตได้
function cceFrame({ imei = SAMPLE_IMEI, identifier = 'G', remainingCache = 0, packets = [ccePacket()] } = {}) {
  const parts = [];
  const head6 = Buffer.alloc(6);
  head6.writeUInt32LE(remainingCache, 0);
  head6.writeUInt16LE(packets.length, 4);
  parts.push(head6);
  for (const pkt of packets) {
    const len = Buffer.alloc(2);
    len.writeUInt16LE(pkt.length, 0);
    parts.push(len, pkt);
  }
  const body = Buffer.concat(parts);
  const tail = Buffer.concat([Buffer.from(`,${imei},CCE,`, 'latin1'), body, Buffer.from('*', 'latin1')]);
  const head = Buffer.from(`$$${identifier}${tail.length + 4}`, 'latin1');
  const cs = checksum(Buffer.concat([head, tail]));
  return Buffer.concat([head, tail, Buffer.from(`${cs}\r\n`, 'latin1')]);
}

// คำตอบข้อความ เช่น replyFrame('X', 'A12', 'OK') → $$X..,IMEI,A12,OK*CS\r\n
function replyFrame(identifier, type, body, imei = SAMPLE_IMEI) {
  const tail = `,${imei},${type}${body === '' ? '' : `,${body}`}*`;
  const head = `$$${identifier}${tail.length + 4}`;
  return Buffer.from(head + tail + checksum(Buffer.from(head + tail, 'latin1')) + '\r\n', 'latin1');
}

module.exports = { SAMPLE_IMEI, ccePacket, cceFrame, replyFrame };
