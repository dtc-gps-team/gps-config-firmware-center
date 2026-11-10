import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_FIELD_APPLY_RETRY_SETTINGS,
  FieldApplyRetryService,
} from './field-apply-retry.service';
import { RolloutEvents } from './rollout-events';

// เวลารอก่อนส่งรอบใหม่ (docs/31 §3.2 · มติ B 10 พ.ย. 2569: รอเท่ากันทุกรอบ 20 วินาที ไม่คูณ 2)
describe('FieldApplyRetryService.retryDelayMs', () => {
  const make = (retryDelaySec?: number) =>
    new FieldApplyRetryService(
      {} as PrismaService,
      {} as RolloutEvents,
      retryDelaySec === undefined
        ? undefined
        : { ...DEFAULT_FIELD_APPLY_RETRY_SETTINGS, retryDelaySec },
    );

  it('ค่าเริ่มต้น 20 วินาที', () => {
    expect(DEFAULT_FIELD_APPLY_RETRY_SETTINGS.retryDelaySec).toBe(20);
    expect(make().retryDelayMs(1)).toBe(20_000);
  });

  it('รอเท่ากันทุกรอบ ไม่คูณ 2 (หลังรอบ 1 และรอบ 2 ล้ม = 20 วินาทีทั้งคู่)', () => {
    const service = make();
    expect(service.retryDelayMs(1)).toBe(20_000);
    expect(service.retryDelayMs(2)).toBe(20_000);
  });

  it('ตั้งผ่าน FIELD_APPLY_RETRY_DELAY_SEC ได้ และยังเท่ากันทุกรอบ', () => {
    const service = make(45);
    expect(service.retryDelayMs(1)).toBe(45_000);
    expect(service.retryDelayMs(2)).toBe(45_000);
  });
});
