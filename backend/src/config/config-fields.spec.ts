import { flattenFields } from './config-fields';

describe('flattenFields', () => {
  it('ซ้อนชั้นหลายชั้น -> คีย์แบบมีจุด', () => {
    expect(
      flattenFields({
        gps: { enabled: true, send_interval_sec: 10 },
        data_server: { protocol: 'https', port: 443 },
      }),
    ).toEqual({
      'gps.enabled': true,
      'gps.send_interval_sec': 10,
      'data_server.protocol': 'https',
      'data_server.port': 443,
    });
  });

  it('key ไม่ซ้อนชั้นเลย (รุ่นเก่า เช่น GT06N) -> ไม่มีผล (no-op)', () => {
    expect(
      flattenFields({ APN1: 'internet', MTYP: '1', SIM1: '0812345678' }),
    ).toEqual({ APN1: 'internet', MTYP: '1', SIM1: '0812345678' });
  });

  it('array เป็นค่าเดี่ยว ไม่ไล่ลงไปข้างใน', () => {
    expect(flattenFields({ allowed: ['a', 'b'] })).toEqual({
      allowed: ['a', 'b'],
    });
  });

  it('ค่า null ไม่ถูกเข้าใจว่าเป็น object ให้ไล่ลงไป', () => {
    expect(flattenFields({ note: null })).toEqual({ note: null });
  });

  it('object เปล่า -> {}', () => {
    expect(flattenFields({})).toEqual({});
  });

  it('ไม่แปลงชนิดค่า (ตัวเลข/boolean คงเดิม ไม่ coerce เป็น string)', () => {
    expect(
      flattenFields({ gps: { send_interval_sec: 10, enabled: true } }),
    ).toEqual({
      'gps.send_interval_sec': 10,
      'gps.enabled': true,
    });
  });
});
