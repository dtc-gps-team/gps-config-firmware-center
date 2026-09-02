import { MockDeviceSimulator } from './device-simulator';

describe('MockDeviceSimulator', () => {
  let simulator: MockDeviceSimulator;

  beforeEach(() => {
    simulator = new MockDeviceSimulator();
  });

  it('fields ว่างเปล่า -> ไม่ผ่าน พร้อมเหตุผล', async () => {
    const result = await simulator.simulateConfig({
      deviceModel: 'GT06N',
      protocol: 'TCP',
      fields: {},
    });

    expect(result.passed).toBe(false);
    expect(result.details.length).toBeGreaterThan(0);
  });

  it('fields ครบ ไม่มี Timeout/Interval ติดลบ -> ผ่าน', async () => {
    const result = await simulator.simulateConfig({
      deviceModel: 'GT06N',
      protocol: 'TCP',
      fields: { APN1: 'internet', MTYP: '1' },
    });

    expect(result.passed).toBe(true);
    expect(result.details[0]).toContain('GT06N/TCP');
  });

  it('ฟิลด์ชื่อมี TIMEOUT เป็นค่าติดลบ -> ไม่ผ่าน', async () => {
    const result = await simulator.simulateConfig({
      deviceModel: 'GT06N',
      protocol: 'TCP',
      fields: { CONN_TIMEOUT: -5 },
    });

    expect(result.passed).toBe(false);
    expect(result.details.some((d) => d.includes('CONN_TIMEOUT'))).toBe(true);
  });

  it('ฟิลด์ชื่อมี INTERVAL เป็นค่าติดลบ (ส่งมาเป็น string) -> ไม่ผ่าน', async () => {
    const result = await simulator.simulateConfig({
      deviceModel: 'GT06N',
      protocol: 'TCP',
      fields: { REPORT_INTERVAL: '-30' },
    });

    expect(result.passed).toBe(false);
    expect(result.details.some((d) => d.includes('REPORT_INTERVAL'))).toBe(
      true,
    );
  });

  it('ฟิลด์ชื่อมี TIMEOUT/INTERVAL แต่ค่าเป็นบวก -> ผ่านปกติ (ไม่ false positive)', async () => {
    const result = await simulator.simulateConfig({
      deviceModel: 'GT06N',
      protocol: 'TCP',
      fields: { CONN_TIMEOUT: 30, REPORT_INTERVAL: 60 },
    });

    expect(result.passed).toBe(true);
  });

  it('ฟิลด์ที่ไม่เข้าเงื่อนไข Timeout/Interval เป็นค่าติดลบได้ตามปกติ (ไม่ตรวจ)', async () => {
    const result = await simulator.simulateConfig({
      deviceModel: 'GT06N',
      protocol: 'TCP',
      fields: { SOME_OFFSET: -1 },
    });

    expect(result.passed).toBe(true);
  });
});
