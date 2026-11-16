// Data Monitor — Data Server จำลอง
// กล่อง ESP32 ส่งข้อมูล GPS / event มาที่ POST /api/gps (หรือ path อื่นใต้ /api/)
// หน้าเว็บ http://localhost:320 แสดงข้อมูลที่ไหลเข้ามาแบบ real-time
const fs = require('fs');
const path = require('path');
const express = require('express');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.PORT || 320);
const MAX_RECORDS = Number(process.env.MAX_RECORDS || 1000);
const DATA_DIR = path.resolve(root, process.env.DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const records = [];
let seq = 0;
const clients = new Set(); // SSE

function logFile() {
  return path.join(DATA_DIR, `received-${new Date().toISOString().slice(0, 10)}.jsonl`);
}

function broadcast(rec) {
  const msg = `data: ${JSON.stringify(rec)}\n\n`;
  for (const res of clients) res.write(msg);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.text({ type: () => true, limit: '64kb' }));  // รับได้แม้ไม่ใช่ JSON

// ---------- รับข้อมูลจากกล่อง ----------
app.post('/api/*', (req, res) => {
  let body = req.body;
  let parseError = null;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { parseError = 'ไม่ใช่ JSON'; }
  }
  const rec = {
    id: ++seq,
    received_at: new Date().toISOString(),
    path: req.path,
    from: (req.socket.remoteAddress || '').replace('::ffff:', ''),
    content_type: req.get('Content-Type') || '',
    kind: body && typeof body === 'object' && body.event_type ? 'EVENT' : 'GPS',
    body,
    parse_error: parseError,
  };
  records.push(rec);
  if (records.length > MAX_RECORDS) records.shift();
  fs.appendFile(logFile(), JSON.stringify(rec) + '\n', () => {});
  broadcast(rec);
  // แสดงในหน้าต่าง terminal: เวลา กล่อง path + ข้อมูลทั้งหมด (แจ้งเตือนเป็นสีแดง)
  const who = body && body.device_id ? body.device_id : rec.from;
  const time = new Date().toLocaleTimeString('th-TH', { hour12: false });
  const color = rec.kind === 'EVENT' ? '\x1b[31m' : body && body.simulated ? '\x1b[33m' : '\x1b[32m';
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  console.log(`\x1b[90m${time}\x1b[0m ${color}${rec.kind.padEnd(5)}\x1b[0m \x1b[36m${String(who).padEnd(10)}\x1b[0m ${req.method} ${req.path}  ${data}`);
  res.json({ ok: true, id: rec.id });
});

// ---------- สำหรับหน้าเว็บ ----------
app.get('/api/received', (req, res) => {
  const limit = Math.min(Number(req.query.limit || 200), MAX_RECORDS);
  const list = req.query.device ? records.filter((r) => r.body && r.body.device_id === req.query.device) : records;
  res.json(list.slice(-limit));
});

app.delete('/api/received', (req, res) => {
  records.length = 0;
  broadcast({ cleared: true });
  res.json({ ok: true });
});

app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(': connected\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

app.get('/health', (req, res) => res.json({ ok: true, service: 'data-monitor', records: records.length }));
app.get('/', (req, res) => res.sendFile(path.join(root, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`data-monitor ฟังที่ http://0.0.0.0:${PORT}`);
  console.log(`  หน้าเว็บ   : http://localhost:${PORT}`);
  console.log(`  กล่องส่งมา : POST http://<IP เครื่องนี้>:${PORT}/api/gps`);
});
