const fs = require('fs');
const path = require('path');

const PARAM_TYPES = new Set(['boolean', 'integer', 'number', 'enum', 'string', 'hostname']);
const MODEL_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Schema เก็บเป็นไฟล์ schemas/<hardware_model>/<schema_version>.json
class SchemaRegistry {
  constructor(dir) {
    this.dir = dir;
    this.reload();
  }

  reload() {
    this.raw = new Map();
    if (!fs.existsSync(this.dir)) return;
    for (const model of fs.readdirSync(this.dir)) {
      const modelDir = path.join(this.dir, model);
      if (!fs.statSync(modelDir).isDirectory()) continue;
      for (const file of fs.readdirSync(modelDir).filter((f) => f.endsWith('.json'))) {
        const s = JSON.parse(fs.readFileSync(path.join(modelDir, file), 'utf8'));
        this.raw.set(`${s.hardware_model}@${s.schema_version}`, s);
      }
    }
  }

  list() {
    return [...this.raw.values()].map((s) => ({
      hardware_model: s.hardware_model,
      firmware_version: s.firmware_version,
      schema_version: s.schema_version,
      inherits: s.inherits || null,
    }));
  }

  // คืน Schema เต็ม (resolve inherits / additional_parameters แล้ว)
  get(model, schemaVersion) {
    const s = this.raw.get(`${model}@${schemaVersion}`);
    return s ? this.resolve(s, new Set()) : null;
  }

  resolve(s, seen) {
    const id = `${s.hardware_model}@${s.schema_version}`;
    if (seen.has(id)) throw new Error(`schema inherits วนซ้ำ: ${id}`);
    seen.add(id);

    let params = [];
    if (s.inherits) {
      const parent = [...this.raw.values()].find(
        (p) => p.hardware_model === s.hardware_model && p.firmware_version === s.inherits
      );
      if (!parent) throw new Error(`ไม่พบ schema ของ firmware ${s.inherits} ที่ ${id} อ้างถึง`);
      params = [...this.resolve(parent, seen).parameters];
    }
    for (const p of [...(s.parameters || []), ...(s.additional_parameters || [])]) {
      if (params.some((x) => x.key === p.key)) throw new Error(`parameter ซ้ำ: ${p.key}`);
      params.push(p);
    }
    return {
      hardware_model: s.hardware_model,
      firmware_version: s.firmware_version,
      schema_version: s.schema_version,
      parameters: params,
    };
  }

  add(schema) {
    const errors = checkSchemaShape(schema);
    if (errors.length) return { errors };
    if (this.raw.has(`${schema.hardware_model}@${schema.schema_version}`)) {
      return { errors: ['schema_version นี้มีอยู่แล้ว (schema ที่เผยแพร่แล้วห้ามแก้ ให้ออกเวอร์ชันใหม่)'] };
    }
    // ทดลอง resolve ก่อนบันทึกจริง
    this.raw.set(`${schema.hardware_model}@${schema.schema_version}`, schema);
    try {
      this.get(schema.hardware_model, schema.schema_version);
    } catch (e) {
      this.raw.delete(`${schema.hardware_model}@${schema.schema_version}`);
      return { errors: [e.message] };
    }
    const dir = path.join(this.dir, schema.hardware_model);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${schema.schema_version}.json`), JSON.stringify(schema, null, 2));
    return { schema: this.get(schema.hardware_model, schema.schema_version) };
  }
}

function checkSchemaShape(s) {
  const errors = [];
  if (!s || typeof s !== 'object') return ['body ต้องเป็น JSON object'];
  if (!MODEL_RE.test(s.hardware_model || '')) errors.push('hardware_model ไม่ถูกต้อง');
  if (!SEMVER_RE.test(s.firmware_version || '')) errors.push('firmware_version ต้องเป็นรูปแบบ x.y.z');
  if (!Number.isInteger(s.schema_version) || s.schema_version < 1) errors.push('schema_version ต้องเป็นจำนวนเต็ม >= 1');
  if (s.inherits !== undefined && !SEMVER_RE.test(s.inherits)) errors.push('inherits ต้องเป็น firmware version x.y.z');
  const params = [...(s.parameters || []), ...(s.additional_parameters || [])];
  if (!params.length) errors.push('ต้องมี parameters หรือ additional_parameters');
  for (const p of params) {
    if (!/^[a-z0-9_]+(\.[a-z0-9_]+)*$/.test(p.key || '')) errors.push(`key ไม่ถูกต้อง: ${p.key}`);
    if (!PARAM_TYPES.has(p.type)) errors.push(`type ไม่รองรับ: ${p.key} (${p.type})`);
    if (p.type === 'enum' && (!Array.isArray(p.options) || !p.options.length)) errors.push(`enum ต้องมี options: ${p.key}`);
  }
  return errors;
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function unflatten(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let cur = out;
    for (const p of parts.slice(0, -1)) cur = cur[p] ??= {};
    cur[parts.at(-1)] = value;
  }
  return out;
}

function isVisible(param, flat) {
  return Object.entries(param.visible_when || {}).every(([k, v]) => flat[k] === v);
}

function checkHostname(host, allowlist) {
  if (typeof host !== 'string') return 'ต้องเป็น string';
  if (host === '') return null;  // ว่าง = ปิดการส่งข้อมูล
  const h = host.toLowerCase();
  // รับ IPv4 ได้ทุกเลข (เช่น Data Monitor ในวงแลน) — allowlist ใช้กับชื่อโดเมนเท่านั้น
  if (/^[0-9.]+$/.test(h)) {
    const octets = h.split('.');
    const ok = octets.length === 4 && octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255);
    return ok ? null : 'IP address ไม่ถูกต้อง';
  }
  if (!HOST_RE.test(h)) return 'hostname ไม่ถูกต้อง';
  // ชื่อโดเมนต้องไม่ลงท้ายด้วยตัวเลขล้วน (กันรูปแบบ IP แปลก ๆ)
  if (/\.[0-9]+$/.test(h)) return 'hostname ไม่ถูกต้อง';
  if (allowlist.length && !allowlist.some((a) => h === a || h.endsWith('.' + a))) {
    return `host ไม่อยู่ใน allowlist (${allowlist.join(', ')})`;
  }
  return null;
}

function checkValue(p, v, allowlist) {
  switch (p.type) {
    case 'boolean':
      return typeof v === 'boolean' ? null : 'ต้องเป็น true/false';
    case 'integer':
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'ต้องเป็นตัวเลข';
      if (p.type === 'integer' && !Number.isInteger(v)) return 'ต้องเป็นจำนวนเต็ม';
      if (p.min !== undefined && v < p.min) return `ต้องไม่น้อยกว่า ${p.min}`;
      if (p.max !== undefined && v > p.max) return `ต้องไม่เกิน ${p.max}`;
      return null;
    case 'enum':
      return p.options.includes(v) ? null : `ต้องเป็นหนึ่งใน ${JSON.stringify(p.options)}`;
    case 'string':
      if (typeof v !== 'string') return 'ต้องเป็น string';
      if (v.length > (p.max_length ?? 256)) return `ยาวเกิน ${p.max_length ?? 256} ตัวอักษร`;
      if (p.pattern && !new RegExp(p.pattern).test(v)) return `รูปแบบไม่ถูกต้อง (${p.pattern})`;
      return null;
    case 'hostname':
      return checkHostname(v, allowlist);
    default:
      return 'type ไม่รองรับ';
  }
}

// ใช้กับค่าที่บันทึกไว้ก่อน merge เท่านั้น เพื่อรองรับการย้อน firmware
// ค่าที่รับเข้ามาใหม่ยังต้องตรวจทุก key ด้วย validateSettings
function supportedSettings(schema, settings) {
  const flat = flatten(settings);
  return unflatten(Object.fromEntries(schema.parameters
    .filter((p) => Object.hasOwn(flat, p.key))
    .map((p) => [p.key, flat[p.key]])));
}

// ตรวจ settings ตาม Schema: ปฏิเสธ key ที่ Firmware ไม่รองรับ, เติมค่า default, ตรวจ type/range
function validateSettings(schema, settings, allowlist = []) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { errors: [{ key: 'settings', message: 'ต้องเป็น JSON object' }] };
  }
  const flat = flatten(settings);
  const byKey = new Map(schema.parameters.map((p) => [p.key, p]));
  const errors = [];

  for (const key of Object.keys(flat)) {
    if (!byKey.has(key)) {
      const hint = key === 'send_interval_sec' && byKey.has('gps.send_interval_sec')
        ? ' — ให้ใช้ gps.send_interval_sec โดยส่ง { "gps": { "send_interval_sec": ... } }'
        : '';
      errors.push({ key, message: `Firmware ${schema.firmware_version} (schema ${schema.schema_version}) ไม่รองรับ parameter นี้${hint}` });
    }
  }

  const result = {};
  for (const p of schema.parameters) {
    if (p.key in flat) result[p.key] = flat[p.key];
    else if (p.default !== undefined) result[p.key] = p.default;
  }

  for (const p of schema.parameters) {
    if (!(p.key in result)) {
      if (p.required && isVisible(p, result)) errors.push({ key: p.key, message: 'จำเป็นต้องระบุ' });
      continue;
    }
    const msg = checkValue(p, result[p.key], allowlist);
    if (msg) errors.push({ key: p.key, message: msg });
  }

  return errors.length ? { errors } : { settings: unflatten(result) };
}

module.exports = { SchemaRegistry, validateSettings, supportedSettings, MODEL_RE, SEMVER_RE };
