import { Test } from '@nestjs/testing';
import { CentralDeviceService } from '../central-device/central-device.service';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignRolloutService } from './campaign-rollout.service';
import { CentralRolloutPollService } from './central-rollout-poll.service';

const target = (id: string, deviceId: string, commandId: string) => ({
  id,
  rolloutId: 'r-1',
  deviceId,
  status: 'pending',
  centralCommandId: commandId,
  rollout: {
    id: 'r-1',
    payloadType: 'Config',
    configId: 'cfg-1',
    firmwareId: null,
  },
});

const firmwareTarget = (id: string, deviceId: string, commandId: string) => ({
  id,
  rolloutId: 'r-2',
  deviceId,
  status: 'pending',
  centralCommandId: commandId,
  rollout: {
    id: 'r-2',
    payloadType: 'Firmware',
    configId: null,
    firmwareId: 'fw-1',
  },
});

describe('CentralRolloutPollService', () => {
  let findMany: jest.Mock;
  let recordTargetResult: jest.Mock;
  let markTargetSkippedOffline: jest.Mock;
  let confirmCentralFirmwareSuccess: jest.Mock;
  let getCommandOutcome: jest.Mock;

  async function build(withCentral = true): Promise<CentralRolloutPollService> {
    findMany = jest.fn().mockResolvedValue([]);
    recordTargetResult = jest.fn().mockResolvedValue(true);
    markTargetSkippedOffline = jest.fn().mockResolvedValue(true);
    confirmCentralFirmwareSuccess = jest.fn().mockResolvedValue(true);
    getCommandOutcome = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        CentralRolloutPollService,
        {
          provide: PrismaService,
          useValue: { campaignRolloutTarget: { findMany } },
        },
        {
          provide: CampaignRolloutService,
          useValue: {
            recordTargetResult,
            markTargetSkippedOffline,
            confirmCentralFirmwareSuccess,
          },
        },
        ...(withCentral
          ? [{ provide: CentralDeviceService, useValue: { getCommandOutcome } }]
          : []),
      ],
    }).compile();
    return module.get(CentralRolloutPollService);
  }

  it('ถามเฉพาะเครื่อง pending ที่มีรหัสคำสั่ง ของ Rollout โหมด central ที่ active/paused (ทั้ง Config และ Firmware)', async () => {
    const service = await build();
    await service.poll();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'pending',
          centralCommandId: { not: null },
          rollout: {
            applyMode: 'central',
            payloadType: { in: ['Config', 'Firmware'] },
            status: { in: ['active', 'paused'] },
          },
        },
      }),
    );
  });

  it('Firmware สำเร็จ -> ผ่าน confirmCentralFirmwareSuccess() ไม่ใช่ recordTargetResult() ตรงๆ (เขียน Dual Partition bookkeeping ก่อน)', async () => {
    const service = await build();
    findMany.mockResolvedValue([firmwareTarget('t1', 'D1', 'C1')]);
    getCommandOutcome.mockResolvedValue({ kind: 'success' });

    const result = await service.poll();

    expect(result.success).toBe(1);
    expect(confirmCentralFirmwareSuccess).toHaveBeenCalledWith(
      'D1',
      'fw-1',
      'r-2',
      expect.stringContaining('C1'),
    );
    expect(recordTargetResult).not.toHaveBeenCalled();
  });

  it('Firmware ล้มเหลว -> ผ่าน recordTargetResult() ธรรมดา (ไม่แตะ Dual Partition)', async () => {
    const service = await build();
    findMany.mockResolvedValue([firmwareTarget('t1', 'D1', 'C1')]);
    getCommandOutcome.mockResolvedValue({
      kind: 'failed',
      detail: 'Server กลางรายงาน FAILED',
    });

    const result = await service.poll();

    expect(result.failed).toBe(1);
    expect(recordTargetResult).toHaveBeenCalledWith(
      'D1',
      { firmwareId: 'fw-1' },
      false,
      'Server กลางรายงาน FAILED',
      'r-2',
    );
    expect(confirmCentralFirmwareSuccess).not.toHaveBeenCalled();
  });

  it('แปลงผลแต่ละเครื่องเป็นผลของ Rollout: สำเร็จ ล้มเหลว ข้าม รอ ถามไม่ได้', async () => {
    const service = await build();
    findMany.mockResolvedValue([
      target('t1', 'D1', 'C1'),
      target('t2', 'D2', 'C2'),
      target('t3', 'D3', 'C3'),
      target('t4', 'D4', 'C4'),
      target('t5', 'D5', 'C5'),
    ]);
    getCommandOutcome
      .mockResolvedValueOnce({ kind: 'success' })
      .mockResolvedValueOnce({
        kind: 'failed',
        detail: 'Server กลางรายงาน FAILED',
      })
      .mockResolvedValueOnce({ kind: 'skipped', detail: 'กล่องออฟไลน์' })
      .mockResolvedValueOnce({ kind: 'pending' })
      .mockResolvedValueOnce({ kind: 'unavailable' });

    const result = await service.poll();

    expect(result).toEqual({
      success: 1,
      failed: 1,
      skipped: 1,
      unavailable: 1,
    });
    expect(recordTargetResult).toHaveBeenCalledTimes(2);
    expect(recordTargetResult).toHaveBeenNthCalledWith(
      1,
      'D1',
      { configId: 'cfg-1' },
      true,
      expect.stringContaining('C1'),
      'r-1',
    );
    expect(recordTargetResult).toHaveBeenNthCalledWith(
      2,
      'D2',
      { configId: 'cfg-1' },
      false,
      'Server กลางรายงาน FAILED',
      'r-1',
    );
    // ออฟไลน์ไม่นับเป็นล้มเหลว: ใช้เส้นทางข้ามเครื่อง ไม่ใช่ recordTargetResult
    expect(markTargetSkippedOffline).toHaveBeenCalledTimes(1);
    expect(markTargetSkippedOffline).toHaveBeenCalledWith('t3', 'กล่องออฟไลน์');
  });

  it('เครื่องที่ถูกคำขออื่น claim ไปก่อน (recordTargetResult คืน false) ไม่นับซ้ำ', async () => {
    const service = await build();
    findMany.mockResolvedValue([target('t1', 'D1', 'C1')]);
    getCommandOutcome.mockResolvedValue({ kind: 'success' });
    recordTargetResult.mockResolvedValue(false);

    expect(await service.poll()).toEqual({
      success: 0,
      failed: 0,
      skipped: 0,
      unavailable: 0,
    });
  });

  it('ไม่มี Rollout ที่รอผล: ไม่ถาม Server กลางเลย', async () => {
    const service = await build();
    await service.poll();
    expect(getCommandOutcome).not.toHaveBeenCalled();
  });

  it('ไม่ได้ต่อ Server กลาง (ไม่มี provider): ไม่ทำอะไร ไม่แตะฐานข้อมูล', async () => {
    const service = await build(false);
    const result = await service.poll();
    expect(result).toEqual({
      success: 0,
      failed: 0,
      skipped: 0,
      unavailable: 0,
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});
