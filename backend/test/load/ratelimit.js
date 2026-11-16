// S7 Rate limit — กล่องหลายตัวออก IP เดียว (CGNAT) ด้วยเพดานจริง 300 คำขอ/นาที/IP (docs/32 §3.2)
// ต้องเปิด backend ด้วย TELEMETRY_RATE_LIMIT_PER_IP=300 (ค่าเริ่มต้นจริง)
// BOXES กล่อง ส่งทุก 10 วิ จาก IP เดียว นาน 2 นาที → นับว่ากี่ % โดน 429
import http from 'k6/http';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { BASE, boxId } from './lib.js';

const BOXES = Number(__ENV.BOXES || 100);
// เริ่มกล่องที่เลข OFFSET ไม่ให้ชนตัวนับต่อเครื่องจากชุดก่อน
const OFFSET = Number(__ENV.OFFSET || 5000);
const limited = new Counter('telemetry_429');
const ok = new Counter('telemetry_ok');

export const options = {
  scenarios: {
    shared_ip: {
      executor: 'constant-arrival-rate',
      rate: BOXES,
      timeUnit: '10s',
      duration: '2m',
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'max'],
  discardResponseBodies: true,
};

export default function () {
  const n = OFFSET + (exec.scenario.iterationInTest % BOXES) + 1;
  const id = boxId(n);
  const res = http.post(
    `${BASE}/device-sync/${id}/telemetry/k6key-${n}`,
    JSON.stringify({ latitude: 13.7, longitude: 100.5, fix: true, location_source: 'gps', timestamp: new Date().toISOString() }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'telemetry' } },
  );
  if (res.status === 429) limited.add(1);
  else if (res.status === 200) ok.add(1);
}
