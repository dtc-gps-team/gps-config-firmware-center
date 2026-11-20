// HTTP API รูปเดียวกับ Server กลาง ESP32 (delivery-server + ws-gateway) ทุกเส้นที่ backend ใช้ (docs/33 §0 ข้อ 1, D3)
// → backend ใช้ HttpCentralDeviceClient ตัวเดิมชี้มาที่นี่ได้เลย · รูป JSON ตาม backend/src/central-device/central-device.types.ts
// ไม่มีเส้นส่งคำสั่งดิบ — Config ทุกค่าผ่าน planCommands() ของรุ่นนั้นเท่านั้น
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(status, error, details) {
    super(error);
    this.status = status;
    this.body = details ? { error, details } : { error };
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => (size > MAX_BODY
      ? reject(new HttpError(400, `ข้อมูลใหญ่เกิน ${MAX_BODY / 1024} KB`))
      : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  try {
    return JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'ข้อมูลไม่ใช่ JSON');
  }
}

function lastCommand(job) {
  if (!job) return null;
  return {
    command_id: job.command_id,
    action: job.action,
    target: job.target_config_version,
    status: job.status,
    error_code: job.error_code,
    updated_at: job.events.at(-1)?.time ?? job.created_at,
  };
}

function createHttpApi({
  config, devices, tcp, queue, fieldsByModel,
  // token มีอายุและจำกัดจำนวน (ข้อสังเกตข้อ 2 ของ A ใน #491) · backend login ใหม่เองเมื่อเจอ 401
  now = Date.now, tokenTtlMs = 24 * 3600 * 1000, maxTokens = 100,
}) {
  const tokens = new Map(); // token -> หมดอายุเมื่อ (ms) · Map เรียงตามลำดับที่ใส่ ตัวแรก = เก่าสุด

  function issueToken() {
    for (const [t, expiresAt] of tokens) if (expiresAt <= now()) tokens.delete(t);
    while (tokens.size >= maxTokens) tokens.delete(tokens.keys().next().value);
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, now() + tokenTtlMs);
    return token;
  }

  function validToken(token) {
    const expiresAt = tokens.get(token);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now()) {
      tokens.delete(token);
      return false;
    }
    return true;
  }

  function device(id) {
    const d = devices.get(id);
    if (!d) throw new HttpError(404, `ไม่รู้จักกล่อง ${id} (ไม่อยู่ในทะเบียนเครื่องของ device-hub)`);
    const fields = fieldsByModel.get(d.model);
    if (!fields) throw new HttpError(404, `device-hub ยังไม่รองรับรุ่น ${d.model}`);
    return { ...d, fields };
  }

  const routes = [
    ['GET', /^\/api\/gw\/devices$/, () => [...devices.entries()]
      .filter(([id]) => tcp.lastSeenAt(id) !== null)
      .map(([id, d]) => ({
        device_id: id,
        hardware_model: d.model,
        online: tcp.isOnline(id),
        last_seen_at: tcp.lastSeenAt(id),
        firmware_version_reported: tcp.firmwareVersion(id),
        config_version_reported: queue.deviceState(id).reportedVersion,
        schema_version_reported: fieldsByModel.get(d.model)?.SCHEMA_VERSION ?? null,
        last_command: lastCommand(queue.listForDevice(id)[0]),
      }))],
    ['GET', /^\/api\/admin\/devices$/, () => [...devices.entries()].map(([id, d]) => ({
      device_id: id,
      hardware_model: d.model,
      schema_version: fieldsByModel.get(d.model)?.SCHEMA_VERSION ?? null,
      status: 'active',
      config_version_desired: queue.deviceState(id).desiredVersion || null,
    }))],
    ['GET', /^\/api\/admin\/schemas\/([^/]+)\/(\d+)$/, (req, [model, version]) => {
      const fields = fieldsByModel.get(model);
      if (!fields || fields.SCHEMA_VERSION !== Number(version)) throw new HttpError(404, `ไม่มี schema ของ ${model} เวอร์ชัน ${version}`);
      return fields.schema();
    }],
    ['PUT', /^\/api\/admin\/devices\/([^/]+)\/config$/, async (req, [id]) => {
      const body = await readJson(req);
      const { fields } = device(id);
      if (!body || typeof body.settings !== 'object' || body.settings === null) throw new HttpError(400, 'ต้องส่ง settings');
      const plan = fields.planCommands(body.settings);
      if (plan.errors) throw new HttpError(400, 'ค่าไม่ผ่านการตรวจ', plan.errors);
      const job = queue.create(id, body.settings, plan.steps);
      return { config_version: job.target_config_version, command: job };
    }],
    ['GET', /^\/api\/admin\/devices\/([^/]+)\/config$/, (req, [id]) => {
      device(id);
      const s = queue.deviceState(id);
      return {
        device_id: id,
        reported: s.reportedVersion === null ? null
          : { config_version: s.reportedVersion, settings: s.reportedSettings, reported_at: s.reportedAt },
      };
    }],
    ['GET', /^\/api\/gw\/jobs\/([^/]+)$/, (req, [id]) => {
      const job = queue.get(id);
      if (!job) throw new HttpError(404, `ไม่พบคำสั่ง ${id}`);
      return job;
    }],
    ['GET', /^\/api\/gw\/devices\/([^/]+)\/commands$/, (req, [id]) => queue.listForDevice(id)],
    ['POST', /^\/api\/admin\/devices\/([^/]+)\/firmware$/, async (req) => {
      await readBody(req).catch(() => {});
      throw new HttpError(400, 'รุ่นนี้ไม่รองรับอัปเดต firmware ทางไกล');
    }],
  ];

  async function handle(req) {
    const url = new URL(req.url, 'http://hub');
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJson(req);
      if (!safeEqual(body.username, config.adminUsername) || !safeEqual(body.password, config.adminPassword)) {
        throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      }
      return { token: issueToken() };
    }
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ') || !validToken(auth.slice(7))) throw new HttpError(401, 'ต้องเข้าสู่ระบบก่อน');
    for (const [method, re, fn] of routes) {
      const m = re.exec(url.pathname);
      if (m && req.method === method) return fn(req, m.slice(1).map(decodeURIComponent));
    }
    throw new HttpError(404, 'ไม่พบเส้นทางนี้');
  }

  return http.createServer((req, res) => {
    handle(req)
      .then((body) => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
      })
      .catch((err) => {
        const status = err instanceof HttpError ? err.status : 500;
        const body = err instanceof HttpError ? err.body : { error: 'device-hub ทำงานผิดพลาด' };
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
      });
  });
}

function startHttpApi(opts) {
  const server = createHttpApi(opts);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.config.httpPort, opts.config.httpHost, () => resolve({ server, port: server.address().port }));
  });
}

module.exports = { createHttpApi, startHttpApi };
