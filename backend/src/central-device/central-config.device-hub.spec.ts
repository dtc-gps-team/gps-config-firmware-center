import {
  classifyCentralCommand,
  isRetryableCentralOutcome,
} from './central-config';
import type { RawCentralCommand } from './central-device.types';

/** error code จาก device-hub (docs/33 D4) อ่านด้วยตัวตัดสินเดิมของ Server กลาง */
describe('error code ของ device-hub', () => {
  const failed = (errorCode: string) => ({
    kind: 'failed' as const,
    detail: '',
    errorCode,
  });
  const cmd = (over: Partial<RawCentralCommand>): RawCentralCommand => ({
    command_id: 'hub-1',
    device_id: '353358017784062',
    action: 'config',
    status: 'FAILED',
    ...over,
  });

  it('DEVICE_REJECTED (กล่องตอบ Error) -> ไม่ลองส่งซ้ำ', () => {
    expect(isRetryableCentralOutcome(failed('DEVICE_REJECTED'))).toBe(false);
  });

  it('NOT_VERIFIED (กล่องตอบรับแต่ยังไม่ใช้ค่า เช่น นอก geofence) -> ลองใหม่ได้', () => {
    expect(isRetryableCentralOutcome(failed('NOT_VERIFIED'))).toBe(true);
  });

  it('DEVICE_NO_REPLY (ส่งไม่ถึงกล่อง) -> ลองใหม่ได้', () => {
    expect(isRetryableCentralOutcome(failed('DEVICE_NO_REPLY'))).toBe(true);
  });

  it('SUPERSEDED ของ hub = ข้าม (ไม่นับล้มเหลว) ความหมายเดียวกับ Server กลาง', () => {
    expect(classifyCentralCommand(cmd({ error_code: 'SUPERSEDED' })).kind).toBe(
      'skipped',
    );
  });

  it('EXPIRED + TTL_EXPIRED ของ hub = ข้ามเพราะกล่องออฟไลน์', () => {
    expect(
      classifyCentralCommand(
        cmd({ status: 'EXPIRED', error_code: 'TTL_EXPIRED' }),
      ).kind,
    ).toBe('skipped');
  });

  it('สถานะระหว่างทางของ hub (QUEUED / SENT / ACKED) = pending', () => {
    for (const status of ['QUEUED', 'SENT', 'ACKED']) {
      expect(classifyCentralCommand(cmd({ status })).kind).toBe('pending');
    }
  });
});
