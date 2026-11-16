// S2 ใช้งานปนกัน / S5 Soak — telemetry จากกล่อง + เจ้าหน้าที่เปิดหน้าต่างๆ พร้อมกัน (docs/32 §4)
//   k6 run -e BOXES=300 -e DURATION=5m -e PASSWORD=... mixed.js
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { BASE, STAFF_USERS, boxId, login, sendTelemetry } from './lib.js';

const BOXES = Number(__ENV.BOXES || 300);
const STAFF = Number(__ENV.STAFF || 30);
const DURATION = __ENV.DURATION || '5m';

export const options = {
  scenarios: {
    boxes: {
      executor: 'constant-arrival-rate',
      exec: 'box',
      rate: Math.max(1, Math.round(BOXES / 10)),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: Math.max(10, Math.ceil(BOXES / 40)),
      maxVUs: Math.max(50, Math.ceil(BOXES / 3)),
    },
    staff: {
      executor: 'constant-vus',
      exec: 'staff',
      vus: STAFF,
      duration: DURATION,
    },
  },
  thresholds: {
    'http_req_duration{name:telemetry}': ['p(95)<300'],
    'http_req_duration{name:devices-list}': ['p(95)<500'],
    'http_req_duration{name:device-detail}': ['p(95)<500'],
    'http_req_duration{name:config-list}': ['p(95)<500'],
    'http_req_duration{name:task-list}': ['p(95)<500'],
    'http_req_duration{name:notifications}': ['p(95)<500'],
    'http_req_duration{name:login}': ['p(95)<1000'],
    'http_req_failed{name:telemetry}': ['rate<0.001'],
    'http_req_failed{scenario:staff}': ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export function box() {
  const n = (exec.scenario.iterationInTest % Math.min(BOXES, 6000)) + 1;
  sendTelemetry(n);
}

let token = null;

function get(path, name) {
  const res = http.get(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name },
  });
  check(res, { [`${name} 200`]: (r) => r.status === 200 });
  return res;
}

export function staff() {
  if (!token) {
    token = login(STAFF_USERS[exec.vu.idInTest % STAFF_USERS.length]);
    if (!token) {
      sleep(5);
      return;
    }
  }
  // ลำดับเหมือนคนเปิดเว็บ/แอปจริง + เวลาคิด 3–8 วิ ระหว่างหน้า
  get('/devices', 'devices-list');
  sleep(3 + Math.random() * 5);
  get(`/devices/${boxId(1 + Math.floor(Math.random() * BOXES))}`, 'device-detail');
  sleep(3 + Math.random() * 5);
  get('/config', 'config-list');
  sleep(3 + Math.random() * 5);
  get('/tasks', 'task-list');
  sleep(3 + Math.random() * 5);
  get('/notifications', 'notifications');
  sleep(3 + Math.random() * 5);
}
