import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import {
  TELEMETRY_RATE_WINDOW_MS,
  TelemetryRateLimitGuard,
} from './telemetry-rate-limit.guard';

function context(deviceId: string, ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ params: { deviceId }, ip }) }),
  } as unknown as ExecutionContext;
}

/** status ของ error ที่ guard โยน · ไม่โยน = undefined */
function statusOf(fn: () => unknown): number | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof HttpException ? err.getStatus() : -1;
  }
}

describe('TelemetryRateLimitGuard (docs/23 §7.4)', () => {
  let now: number;

  beforeEach(() => {
    now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => jest.restoreAllMocks());

  function guard(perDeviceLimit: number, perIpLimit: number) {
    return new TelemetryRateLimitGuard({
      centralKeyHash: null,
      retentionDays: 30,
      perDeviceLimit,
      perIpLimit,
    });
  }

  it('ต่อ deviceId: เกินจำนวนต่อนาที -> 429 · เครื่องอื่นไม่โดน', () => {
    const g = guard(3, 100);
    for (let i = 0; i < 3; i++) {
      expect(g.canActivate(context('BOX-0001', '10.0.0.1'))).toBe(true);
    }
    expect(statusOf(() => g.canActivate(context('BOX-0001', '10.0.0.1')))).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(g.canActivate(context('BOX-0002', '10.0.0.1'))).toBe(true);
  });

  it('ต่อ IP: deviceId ต่างกันจาก IP เดียวเกินจำนวน -> 429 · IP อื่นไม่โดน', () => {
    const g = guard(100, 2);
    expect(g.canActivate(context('A', '10.0.0.1'))).toBe(true);
    expect(g.canActivate(context('B', '10.0.0.1'))).toBe(true);
    expect(statusOf(() => g.canActivate(context('C', '10.0.0.1')))).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect(g.canActivate(context('C', '10.0.0.2'))).toBe(true);
  });

  it('ครบ 1 นาที -> เริ่มนับใหม่', () => {
    const g = guard(1, 100);
    expect(g.canActivate(context('BOX-0001', '10.0.0.1'))).toBe(true);
    expect(statusOf(() => g.canActivate(context('BOX-0001', '10.0.0.1')))).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );

    now += TELEMETRY_RATE_WINDOW_MS;
    expect(g.canActivate(context('BOX-0001', '10.0.0.1'))).toBe(true);
  });
});
