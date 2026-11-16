// S4 Spike — กล่อง 3,000 ตัวกลับมาส่งพร้อมกันหลังเน็ต/server ล่ม (docs/32 §4)
// 0 → 300 คำขอ/วิ ใน 10 วิ ค้าง 2 นาที แล้วดูว่าระบบตอบกลับมาปกติไหม
import exec from 'k6/execution';
import { sendTelemetry } from './lib.js';

const BOXES = Number(__ENV.BOXES || 3000);
const PEAK = Math.round(BOXES / 10);

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 3000,
      stages: [
        { target: PEAK, duration: '10s' },
        { target: PEAK, duration: '2m' },
      ],
    },
  },
  thresholds: {
    'http_req_duration{name:telemetry}': ['p(95)<300', 'p(99)<1000'],
    http_req_failed: ['rate<0.001'],
    dropped_iterations: ['count<1'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: true,
};

export default function () {
  sendTelemetry((exec.scenario.iterationInTest % Math.min(BOXES, 6000)) + 1);
}
