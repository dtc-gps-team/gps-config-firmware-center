// ตัวช่วยร่วมของสคริปต์ k6 (docs/32)
import http from 'k6/http';
import { check } from 'k6';

export const BASE = __ENV.BASE_URL || 'http://localhost:3002/api/v1';

/** กล่องจำลอง LT-00001.. (seed-load-devices.sql) — key = k6key-<เลข> */
export function boxId(n) {
  return 'LT-' + String(n).padStart(5, '0');
}

/** ส่ง telemetry 1 ครั้ง แบบเดียวกับที่กล่องจริงส่ง (docs/23 §4) */
export function sendTelemetry(n) {
  const id = boxId(n);
  const body = JSON.stringify({
    device_id: id,
    latitude: 13.7 + Math.random() * 0.1,
    longitude: 100.5 + Math.random() * 0.1,
    speed_kmh: Math.round(Math.random() * 90),
    fix: true,
    location_source: 'gps',
    satellites: 9,
    timestamp: new Date().toISOString(),
  });
  const res = http.post(`${BASE}/device-sync/${id}/telemetry/k6key-${n}`, body, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'telemetry' },
  });
  check(res, {
    'telemetry 200': (r) => r.status === 200,
    'ไม่โดน 429': (r) => r.status !== 429,
  });
  return res;
}

/** login ครั้งเดียวต่อ user — รหัสผ่านมาจาก env PASSWORD (ไม่เขียนลงไฟล์) */
export function login(username) {
  const res = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ username, password: __ENV.PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );
  check(res, { 'login 200/201': (r) => r.status === 200 || r.status === 201 });
  return res.status < 300 ? res.json('accessToken') : null;
}

export const STAFF_USERS = [
  'config.test',
  'operation.test',
  'admin.test',
  'st.test',
  'ot.test',
  // ไม่ใส่ qa.test — QAEngineer ไม่มีสิทธิ์ GET /config (403 ตาม RBAC) จะนับเป็น error ปลอม
];
