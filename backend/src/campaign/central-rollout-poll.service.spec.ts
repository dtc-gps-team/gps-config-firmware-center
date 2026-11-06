import { Test } from '@nestjs/testing';
import { CentralDeviceService } from '../central-device/central-device.service';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignRolloutService } from './campaign-rollout.service';
import { CentralRolloutPollService } from './central-rollout-poll.service';
import { FieldApplyRetryService } from './field-apply-retry.service';
import { FIELD_APPLY_SYSTEM_CAMPAIGN_NAME } from './field-apply-system-campaign';

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
  beforeEach(() => {
    retry = null;
  });

  let findMany: jest.Mock;
  let recordTargetResult: jest.Mock;
  let markTargetSkippedOffline: jest.Mock;
  let confirmCentralFirmwareSuccess: jest.Mock;
  let getCommandOutcome: jest.Mock;
  let startFieldApplyRollout: jest.Mock;
  let retry: {
    decideAfterFailure: jest.Mock;
    markLatestAttemptSucceeded: jest.Mock;
    processDueRetries: jest.Mock;
  } | null;

  async function build(withCentral = true): Promise<CentralRolloutPollService> {
    findMany = jest.fn().mockResolvedValue([]);
    recordTargetResult = jest.fn().mockResolvedValue(true);
    markTargetSkippedOffline = jest.fn().mockResolvedValue(true);
    confirmCentralFirmwareSuccess = jest.fn().mockResolvedValue(true);
    getCommandOutcome = jest.fn();
    startFieldApplyRollout = jest.fn().mockResolvedValue({});
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
            startFieldApplyRollout,
          },
        },
        ...(retry
          ? [{ provide: FieldApplyRetryService, useValue: retry }]
          : []),
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
      retrying: 0,
      retried: 0,
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
      retrying: 0,
      retried: 0,
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
      retrying: 0,
      retried: 0,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  // docs/31 — ลองส่งเข้ากล่องใหม่อัตโนมัติ (Rollout ส่งจากหน้างานเท่านั้น)
  describe('ลองส่งใหม่ (docs/31)', () => {
    const fieldTarget = (id: string, deviceId: string, commandId: string) => {
      const t = target(id, deviceId, commandId);
      return {
        ...t,
        attemptCount: 1,
        rollout: {
          ...t.rollout,
          // Campaign ระบบเปิดลองใหม่เสมอ ไม่สนค่า autoRetry (ตั้ง false ไว้พิสูจน์ว่าไม่ถูกอ่าน)
          campaign: {
            name: FIELD_APPLY_SYSTEM_CAMPAIGN_NAME,
            autoRetry: false,
          },
        },
      };
    };

    /** Campaign ปกติ (ไม่ใช่ระบบ) ที่ตั้งสวิตช์ autoRetry ตามที่ส่งมา */
    const normalTarget = (
      id: string,
      deviceId: string,
      commandId: string,
      autoRetry: boolean,
    ) => {
      const t = target(id, deviceId, commandId);
      return {
        ...t,
        attemptCount: 1,
        rollout: { ...t.rollout, campaign: { name: 'กลุ่มจริง', autoRetry } },
      };
    };

    /** ให้ processDueRetries() ป้อน action ตามรายการ (เหมือนที่ claim ได้ทีละตัว) */
    const dueActions = (actions: unknown[]) =>
      retry!.processDueRetries.mockImplementation(
        async (handler: (a: unknown) => Promise<void>) => {
          for (const a of actions) await handler(a);
          return actions.length;
        },
      );

    beforeEach(() => {
      retry = {
        decideAfterFailure: jest.fn(),
        markLatestAttemptSucceeded: jest.fn().mockResolvedValue(undefined),
        processDueRetries: jest.fn().mockResolvedValue(0),
      };
    });

    it('query ดึงชื่อ Campaign และสวิตช์ autoRetry มาด้วย (ตัดสินว่าเปิดลองใหม่ไหม)', async () => {
      const service = await build();
      await service.poll();
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            rollout: {
              select: expect.objectContaining({
                campaign: { select: { name: true, autoRetry: true } },
              }) as unknown,
            },
          },
        }),
      );
    });

    it('Campaign ปกติที่ปิดสวิตช์ autoRetry ล้ม -> recordTargetResult() ทันทีเหมือนเดิม ไม่ผ่านตัวลองใหม่', async () => {
      const service = await build();
      findMany.mockResolvedValue([normalTarget('t1', 'D1', 'C1', false)]);
      getCommandOutcome.mockResolvedValue({
        kind: 'failed',
        detail: 'ล้ม',
        errorCode: 'DEVICE_DISCONNECTED',
      });

      await service.poll();

      expect(retry!.decideAfterFailure).not.toHaveBeenCalled();
      expect(recordTargetResult).toHaveBeenCalledWith(
        'D1',
        { configId: 'cfg-1' },
        false,
        'ล้ม',
        'r-1',
      );
    });

    it('Campaign ปกติที่เปิดสวิตช์ autoRetry ล้ม -> ผ่านตัวลองใหม่ (ตั้งรอบใหม่ ไม่บันทึกผล) · สำเร็จ -> ปิดรอบล่าสุด', async () => {
      const service = await build();
      findMany.mockResolvedValue([
        normalTarget('t1', 'D1', 'C1', true),
        normalTarget('t2', 'D2', 'C2', true),
      ]);
      getCommandOutcome
        .mockResolvedValueOnce({
          kind: 'failed',
          detail: 'ล้ม',
          errorCode: 'DEVICE_DISCONNECTED',
        })
        .mockResolvedValueOnce({ kind: 'success' });
      retry!.decideAfterFailure.mockResolvedValue({
        kind: 'scheduled',
        nextRetryAt: new Date(),
      });

      const result = await service.poll();

      expect(retry!.decideAfterFailure).toHaveBeenCalledTimes(1);
      expect(result.retrying).toBe(1);
      expect(retry!.markLatestAttemptSucceeded).toHaveBeenCalledWith('t2');
      expect(recordTargetResult).toHaveBeenCalledTimes(1); // เฉพาะ t2 ที่สำเร็จ
      expect(recordTargetResult).toHaveBeenCalledWith(
        'D2',
        { configId: 'cfg-1' },
        true,
        expect.any(String),
        'r-1',
      );
    });

    it('ส่งจากหน้างานล้มแล้วตั้งรอบใหม่ -> ไม่บันทึกผล นับ retrying', async () => {
      const service = await build();
      findMany.mockResolvedValue([fieldTarget('t1', 'D1', 'C1')]);
      const outcome = {
        kind: 'failed',
        detail: 'ล้ม',
        errorCode: 'DEVICE_DISCONNECTED',
      };
      getCommandOutcome.mockResolvedValue(outcome);
      retry!.decideAfterFailure.mockResolvedValue({
        kind: 'scheduled',
        nextRetryAt: new Date(),
      });

      const result = await service.poll();

      expect(retry!.decideAfterFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 't1',
          rolloutId: 'r-1',
          attemptCount: 1,
        }),
        outcome,
      );
      expect(result.retrying).toBe(1);
      expect(recordTargetResult).not.toHaveBeenCalled();
      expect(markTargetSkippedOffline).not.toHaveBeenCalled();
    });

    it('ส่งจากหน้างานจบ -> บันทึกผลด้วยเส้นทางเดิมพร้อมสรุปทุกรอบ (failed / skipped)', async () => {
      const service = await build();
      findMany.mockResolvedValue([
        fieldTarget('t1', 'D1', 'C1'),
        fieldTarget('t2', 'D2', 'C2'),
      ]);
      getCommandOutcome
        .mockResolvedValueOnce({ kind: 'failed', detail: 'a' })
        .mockResolvedValueOnce({ kind: 'skipped', detail: 'b' });
      retry!.decideAfterFailure
        .mockResolvedValueOnce({
          kind: 'finish',
          outcome: 'failed',
          detail: 'ส่ง 3 ครั้งไม่สำเร็จ',
        })
        .mockResolvedValueOnce({
          kind: 'finish',
          outcome: 'skipped',
          detail: 'ส่ง 3 ครั้ง ข้าม',
        });

      await service.poll();

      expect(recordTargetResult).toHaveBeenCalledWith(
        'D1',
        { configId: 'cfg-1' },
        false,
        'ส่ง 3 ครั้งไม่สำเร็จ',
        'r-1',
      );
      expect(markTargetSkippedOffline).toHaveBeenCalledWith(
        't2',
        'ส่ง 3 ครั้ง ข้าม',
      );
    });

    it('สำเร็จ -> ปิดรอบล่าสุดเป็น succeeded ก่อนบันทึกผล', async () => {
      const service = await build();
      findMany.mockResolvedValue([fieldTarget('t1', 'D1', 'C1')]);
      getCommandOutcome.mockResolvedValue({ kind: 'success' });

      await service.poll();

      expect(retry!.markLatestAttemptSucceeded).toHaveBeenCalledWith('t1');
      expect(recordTargetResult).toHaveBeenCalledTimes(1);
    });

    it('รอบใหม่ที่ถึงเวลา: push -> startFieldApplyRollout() · finish -> บันทึกผลตามชนิด', async () => {
      const service = await build();
      dueActions([
        { kind: 'push', rolloutId: 'r-9', targetId: 't-9', actorId: 'op-1' },
        {
          kind: 'finish',
          targetId: 't-8',
          rolloutId: 'r-8',
          deviceId: 'D8',
          payload: { configId: 'cfg-8' },
          outcome: 'failed',
          detail: 'จบ',
        },
        {
          kind: 'finish',
          targetId: 't-7',
          rolloutId: 'r-7',
          deviceId: 'D7',
          payload: { firmwareId: 'fw-7' },
          outcome: 'skipped',
          detail: 'ข้าม',
        },
      ]);

      const result = await service.poll();

      expect(startFieldApplyRollout).toHaveBeenCalledWith('r-9', 'op-1', {
        retryTargetId: 't-9',
      });
      expect(result.retried).toBe(1);
      expect(recordTargetResult).toHaveBeenCalledWith(
        'D8',
        { configId: 'cfg-8' },
        false,
        'จบ',
        'r-8',
      );
      expect(markTargetSkippedOffline).toHaveBeenCalledWith('t-7', 'ข้าม');
    });

    it('ส่งรอบใหม่ throw -> ไม่ทำให้ poll ล้ม (lease หมดแล้วหยิบใหม่เอง)', async () => {
      const service = await build();
      dueActions([
        { kind: 'push', rolloutId: 'r-9', targetId: 't-9', actorId: 'op-1' },
      ]);
      startFieldApplyRollout.mockRejectedValue(new Error('boom'));

      const result = await service.poll();

      expect(result.retried).toBe(0);
    });
  });
});
