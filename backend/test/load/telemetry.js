// S1 Load / S3 Stress — กล่องจำลองส่ง telemetry ทุก 10 วิ (docs/32 §4)
// แต่ละขั้น = จำนวนกล่อง → อัตรา = กล่อง / 10 คำขอ/วิ · ขั้นรันต่อกันตามลำดับ
//   k6 run -e STEPS=300,1000,3000 -e STEP_SEC=180 telemetry.js        (S1)
//   k6 run -e STEPS=5000,8000,12000,16000,20000 -e STEP_SEC=60 telemetry.js  (S3)
import exec from 'k6/execution';
import { sendTelemetry } from './lib.js';

const STEPS = (__ENV.STEPS || '300,1000,3000').split(',').map(Number);
const STEP_SEC = Number(__ENV.STEP_SEC || 180);
const DEVICE_POOL = Number(__ENV.DEVICE_POOL || 6000); // กล่องที่ seed ไว้
const P95_MS = Number(__ENV.P95_MS || 300);

const scenarios = {};
const thresholds = {};
STEPS.forEach((boxes, i) => {
  const rate = Math.max(1, Math.round(boxes / 10));
  const name = `b${boxes}`;
  scenarios[name] = {
    executor: 'constant-arrival-rate',
    rate,
    timeUnit: '1s',
    duration: `${STEP_SEC}s`,
    startTime: `${i * STEP_SEC}s`,
    preAllocatedVUs: Math.min(3000, Math.max(10, Math.ceil(rate / 4))),
    maxVUs: Math.min(4000, Math.max(50, rate * 3)),
    env: { BOXES: String(boxes) },
    tags: { step: name },
  };
  // threshold ต่อขั้น — ให้ summary แสดงตัวเลขแยกทุกขั้น
  thresholds[`http_req_duration{step:${name}}`] = [`p(95)<${P95_MS}`, 'p(99)<1000'];
  thresholds[`http_req_failed{step:${name}}`] = ['rate<0.001'];
  thresholds[`iterations{step:${name}}`] = ['count>=0'];
  thresholds[`dropped_iterations{step:${name}}`] = ['count<1'];
});

export const options = {
  scenarios,
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: true,
};

export default function () {
  const boxes = Math.min(Number(__ENV.BOXES), DEVICE_POOL);
  const n = (exec.scenario.iterationInTest % boxes) + 1;
  sendTelemetry(n);
}
