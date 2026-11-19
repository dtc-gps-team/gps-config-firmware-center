// ค่าที่ตั้งเข้ากล่อง TA255 ผ่าน GPRS ได้ — ที่เดียวที่กำหนดว่ารุ่นนี้ตั้งอะไรได้ (docs/33 D7, D9, §5)
// - schema() สร้างจากตารางนี้ → ใช้ตอบ backend และสร้าง schemas/TA255L-1.json สำหรับ import:central-schema
// - planCommands() แปลงค่าที่ backend ส่งมาเป็นคำสั่ง ตามลำดับกลุ่มในตาราง
// - ชื่อ field: "meitrack." + ตัวเล็กคั่นจุด (ไม่ชนกับ field ของ ESP32) · กลุ่มที่เป็นคำสั่งเดียวกันต้องส่งครบทุกค่า
// อ้างอิงเลขหัวข้อใน TA255 GPRS Protocol V1.0 — ห้ามคัดข้อความจากเอกสารมาใส่
'use strict';

const MODEL = 'TA255L';
const SCHEMA_VERSION = 1;
const MAX_VERIFIED_INTERVAL_SEC = 300;

const GROUPS = [
  {
    id: 'track_interval', // §3.3 — หน่วยของกล่องคือ ×10 วินาที, 0 = ปิด
    params: [
      { key: 'meitrack.track_interval_sec', label: 'รอบส่งพิกัด ตั้งทีละ 10 วินาที 0 = ปิด (วินาที)', type: 'integer', min: 0, max: 655350, default: 60, step: 10 },
    ],
    toCommand: (v) => `A12,${v.track_interval_sec / 10}`,
    // ยืนยันจากช่วงห่างของรายงานจริง · ปิด (0) ดูจากรอบส่งไม่ได้ · รอบยาวเกิน 5 นาทีต้องรอหลายชั่วโมงถึงวัน
    // ระหว่างนั้นคำสั่งอื่นของกล่องนี้ส่งไม่ได้ → ทั้งสองกรณียืนยันแค่กล่องตอบรับ
    verify: (v) => (v.track_interval_sec === 0 || v.track_interval_sec > MAX_VERIFIED_INTERVAL_SEC ? 'ack' : 'interval'),
  },
  {
    id: 'idling', // §3.22 — ส่ง B14 เปล่าเพื่ออ่านค่าปัจจุบันกลับได้
    params: [
      { key: 'meitrack.idling.time_sec', label: 'แจ้งเตือนจอดติดเครื่อง: ความเร็วต่ำต่อเนื่องนาน (วินาที)', type: 'integer', min: 0, max: 60000, default: 180 },
      { key: 'meitrack.idling.speed_kmh', label: 'แจ้งเตือนจอดติดเครื่อง: ความเร็วไม่เกิน (กม./ชม.)', type: 'integer', min: 0, max: 200, default: 5 },
      { key: 'meitrack.idling.alert_sec', label: 'แจ้งเตือนจอดติดเครื่อง: เวลาแจ้งเตือน (วินาที)', type: 'integer', min: 0, max: 60000, default: 120 },
    ],
    toCommand: (v) => `B14,${v.time_sec},${v.speed_kmh},${v.alert_sec}`,
    verify: () => 'readback',
    readCommand: 'B14',
    parseReadback: (body) => {
      const parts = body.split(',');
      if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p.trim()))) return null;
      const [time_sec, speed_kmh, alert_sec] = parts.map((p) => Number(p.trim()));
      return { time_sec, speed_kmh, alert_sec };
    },
  },
  {
    id: 'led', // §3.25 — 00 = เปิดไฟ, 10 = ปิดไฟ
    params: [
      { key: 'meitrack.led_off', label: 'ปิดไฟ LED บนกล่อง', type: 'boolean', default: false },
    ],
    toCommand: (v) => `B31,${v.led_off ? '10' : '00'}`,
    verify: () => 'ack',
  },
];

const PARAM_BY_KEY = new Map(GROUPS.flatMap((g) => g.params.map((p) => [p.key, { group: g, param: p }])));

// ชื่อในค่าที่คาดหวัง = ส่วนท้ายของ key เช่น meitrack.idling.time_sec → time_sec
const shortName = (key) => key.slice(key.lastIndexOf('.') + 1);

function schema() {
  return {
    hardware_model: MODEL,
    schema_version: SCHEMA_VERSION,
    parameters: GROUPS.flatMap((g) => g.params.map(({ key, label, type, min, max, default: def }) => {
      const p = { key, label, type };
      if (min !== undefined) p.min = min;
      if (max !== undefined) p.max = max;
      p.default = def;
      return p;
    })),
  };
}

// {meitrack:{idling:{time_sec:1}}} → {'meitrack.idling.time_sec': 1}
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function checkValue(param, value) {
  if (param.type === 'boolean') return typeof value === 'boolean' ? null : 'ต้องเป็น true/false';
  if (!Number.isInteger(value)) return 'ต้องเป็นจำนวนเต็ม';
  if (value < param.min || value > param.max) return `ต้องอยู่ระหว่าง ${param.min}–${param.max}`;
  if (param.step && value % param.step !== 0) return `ต้องเป็นทวีคูณของ ${param.step}`;
  return null;
}

function planCommands(settings) {
  const flat = flatten(settings);
  const errors = [];
  for (const [key, value] of Object.entries(flat)) {
    const found = PARAM_BY_KEY.get(key);
    if (!found) errors.push({ key, message: `ไม่รู้จักพารามิเตอร์นี้สำหรับ ${MODEL}` });
    else {
      const problem = checkValue(found.param, value);
      if (problem) errors.push({ key, message: problem });
    }
  }
  const steps = [];
  for (const g of GROUPS) {
    const present = g.params.filter((p) => p.key in flat);
    if (present.length === 0) continue;
    const missing = g.params.filter((p) => !(p.key in flat));
    for (const p of missing) {
      errors.push({ key: p.key, message: `ต้องตั้งครบ ${g.params.length} ค่าของกลุ่ม ${g.id}: ขาด ${p.key}` });
    }
    if (missing.length > 0) continue;
    const expected = Object.fromEntries(g.params.map((p) => [shortName(p.key), flat[p.key]]));
    const step = { group: g.id, command: '', verify: '', expected };
    if (errors.length === 0) {
      step.command = g.toCommand(expected);
      step.verify = g.verify(expected);
      if (step.verify === 'readback') step.readCommand = g.readCommand;
    }
    steps.push(step);
  }
  if (errors.length > 0) return { errors };
  if (steps.length === 0) return { errors: [{ key: '', message: `ไม่มีค่าที่ตั้งได้สำหรับ ${MODEL}` }] };
  // เรียง key ของ step ให้คงที่ (group, command, verify, readCommand?, expected)
  return {
    steps: steps.map(({ group, command, verify, readCommand, expected }) => (
      readCommand ? { group, command, verify, readCommand, expected } : { group, command, verify, expected })),
  };
}

function parseReadback(group, body) {
  const g = GROUPS.find((x) => x.id === group);
  return g && g.parseReadback ? g.parseReadback(body) : null;
}

module.exports = { MODEL, SCHEMA_VERSION, schema, planCommands, parseReadback };

// npm run schema → เขียน schemas/TA255L-1.json ใหม่จากตารางด้านบน
if (require.main === module && process.argv.includes('--write-schema')) {
  const fs = require('node:fs');
  const path = require('node:path');
  const out = path.join(__dirname, '..', '..', '..', 'schemas', `${MODEL}-${SCHEMA_VERSION}.json`);
  fs.writeFileSync(out, `${JSON.stringify(schema(), null, 2)}\n`);
  console.log(`เขียน ${out} แล้ว`);
}
