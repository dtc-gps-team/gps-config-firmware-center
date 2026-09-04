import { MockConfigApplier } from './config-applier';

describe('MockConfigApplier', () => {
  const applier = new MockConfigApplier();

  const base = {
    deviceId: 'DEV-0001',
    deviceModel: 'GT06N',
    protocol: 'TCP',
  };

  it('fields ปกติ -> applied: true + appliedAt เป็น ISO', async () => {
    const result = await applier.applyConfig({
      ...base,
      fields: { APN: 'internet', gps_report_rate: 30 },
    });

    expect(result.applied).toBe(true);
    expect(result.details).toHaveLength(1);
    expect(() => new Date(result.appliedAt).toISOString()).not.toThrow();
    expect(new Date(result.appliedAt).toISOString()).toBe(result.appliedAt);
  });

  it('fields ว่าง -> applied: false', async () => {
    const result = await applier.applyConfig({ ...base, fields: {} });

    expect(result.applied).toBe(false);
    expect(result.details[0]).toContain('ไม่มี field');
  });

  it('ฟิลด์ Interval ติดลบ -> applied: false ระบุชื่อฟิลด์', async () => {
    const result = await applier.applyConfig({
      ...base,
      fields: { APN: 'internet', REPORT_INTERVAL: -5 },
    });

    expect(result.applied).toBe(false);
    expect(result.details[0]).toContain('REPORT_INTERVAL');
  });

  it('ฟิลด์ Timeout เป็นบวก -> applied: true', async () => {
    const result = await applier.applyConfig({
      ...base,
      fields: { CONN_TIMEOUT: 30 },
    });

    expect(result.applied).toBe(true);
  });
});
