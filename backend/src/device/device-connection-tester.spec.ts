import { MockDeviceConnectionTester } from './device-connection-tester';

describe('MockDeviceConnectionTester', () => {
  let tester: MockDeviceConnectionTester;

  beforeEach(() => {
    tester = new MockDeviceConnectionTester();
  });

  it('คืน passed: true + signalStrength คงที่ (-65) เสมอ', async () => {
    const result = await tester.testConnection({
      deviceId: 'DTC-0001',
      deviceModel: 'GT06N',
      protocol: 'TCP',
    });

    expect(result.passed).toBe(true);
    expect(result.signalStrength).toBe(-65);
  });

  it('details ระบุชัดว่าเป็น mock + มี deviceId/model/protocol', async () => {
    const result = await tester.testConnection({
      deviceId: 'DTC-0002',
      deviceModel: 'GT06N',
      protocol: 'UDP',
    });

    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toContain('mock');
    expect(result.details[0]).toContain('DTC-0002');
    expect(result.details[0]).toContain('GT06N/UDP');
  });

  it('testedAt เป็น ISO 8601 string ที่ parse ได้', async () => {
    const result = await tester.testConnection({
      deviceId: 'DTC-0003',
      deviceModel: 'GT06N',
      protocol: 'TCP',
    });

    expect(typeof result.testedAt).toBe('string');
    expect(Number.isNaN(Date.parse(result.testedAt))).toBe(false);
    expect(result.testedAt).toBe(new Date(result.testedAt).toISOString());
  });
});
