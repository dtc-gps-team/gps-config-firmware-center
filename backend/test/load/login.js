// S6 Login — 50 คน login ภายใน 1 นาที (เช่น เข้างานตอนเช้า) (docs/32 §4)
import { STAFF_USERS, login } from './lib.js';
import exec from 'k6/execution';

export const options = {
  scenarios: {
    morning: {
      executor: 'per-vu-iterations',
      vus: Number(__ENV.USERS || 50),
      iterations: 1,
      maxDuration: '1m',
    },
  },
  thresholds: {
    'http_req_duration{name:login}': ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  login(STAFF_USERS[exec.vu.idInTest % STAFF_USERS.length]);
}
