import { Logger } from '@nestjs/common';
import { MockConfigSyncWriter } from './mock-config-sync-writer';
import { LegacyConfigWrite } from './config-sync-writer.interface';

describe('MockConfigSyncWriter', () => {
  let writer: MockConfigSyncWriter;
  let logSpy: jest.SpyInstance<void, [message: unknown]>;

  const lastLog = (): string => String(logSpy.mock.calls[0]?.[0]);

  const base: LegacyConfigWrite = {
    configId: 'cfg-1',
    versionNumber: 3,
    deviceModel: 'GT06N',
    protocol: 'TCP',
    fields: { APN: 'internet', report_interval: 30 },
  };

  beforeEach(() => {
    writer = new MockConfigSyncWriter();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('fields ปกติ -> resolve + log บอกจำนวน field + configId/version', async () => {
    await expect(
      writer.writeConfigToLegacySystem(base),
    ).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledTimes(1);
    const msg = lastLog();
    expect(msg).toContain('cfg-1 v3');
    expect(msg).toContain('GT06N/TCP');
    expect(msg).toContain('2 field');
  });

  it('fields ว่าง -> reject (ไม่มีอะไรให้เขียน) + ไม่ log', async () => {
    await expect(
      writer.writeConfigToLegacySystem({ ...base, fields: {} }),
    ).rejects.toThrow('ไม่มี field');

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('writeFirmwarePointerToLegacySystem -> resolve + log (Phase 3 placeholder)', async () => {
    await expect(
      writer.writeFirmwarePointerToLegacySystem({
        firmwareId: 'fw-1',
        version: 'GT06N-v2.4.1',
        deviceModel: 'GT06N',
      }),
    ).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(lastLog()).toContain('firmware pointer fw-1');
  });
});
