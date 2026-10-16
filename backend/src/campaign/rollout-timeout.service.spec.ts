import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignRolloutService } from './campaign-rollout.service';
import { RolloutTimeoutService } from './rollout-timeout.service';

describe('RolloutTimeoutService', () => {
  const NOW = new Date('2026-10-20T12:00:00.000Z');
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

  let service: RolloutTimeoutService;
  let rolloutFindMany: jest.Mock;
  let targetFindMany: jest.Mock;
  let markTargetSkippedOffline: jest.Mock;
  let recordTargetResult: jest.Mock;

  const rollout = (overrides: Record<string, unknown> = {}) => ({
    id: 'rollout-1',
    configId: 'cfg-1',
    status: 'active',
    applyMode: 'real',
    payloadType: 'Config',
    activeWindowStartedAt: hoursAgo(1),
    pullTimeoutHours: null,
    applyTimeoutMinutes: null,
    ...overrides,
  });

  /** findMany ของ target แยกตามเงื่อนไข: pulledAt null = ไม่เคยดึง, lt = เงียบ */
  function mockTargets(waiting: string[], silent: string[]) {
    targetFindMany.mockImplementation(
      (args: { where: { pulledAt: unknown } }) =>
        Promise.resolve(
          args.where.pulledAt === null
            ? waiting.map((id) => ({ id }))
            : silent.map((deviceId) => ({ deviceId })),
        ),
    );
  }

  beforeEach(async () => {
    rolloutFindMany = jest.fn().mockResolvedValue([]);
    targetFindMany = jest.fn().mockResolvedValue([]);
    markTargetSkippedOffline = jest.fn().mockResolvedValue(true);
    recordTargetResult = jest.fn().mockResolvedValue(true);
    const built = await Test.createTestingModule({
      providers: [
        RolloutTimeoutService,
        {
          provide: PrismaService,
          useValue: {
            campaignRollout: { findMany: rolloutFindMany },
            campaignRolloutTarget: { findMany: targetFindMany },
          },
        },
        {
          provide: CampaignRolloutService,
          useValue: { markTargetSkippedOffline, recordTargetResult },
        },
      ],
    }).compile();
    service = built.get(RolloutTimeoutService);
  });

  it('ตรวจเฉพาะ Rollout โหมด real ชนิด Config ที่ active/paused', async () => {
    await service.sweep(NOW);

    expect(rolloutFindMany).toHaveBeenCalledWith({
      where: {
        applyMode: 'real',
        payloadType: 'Config',
        status: { in: ['active', 'paused'] },
      },
    });
  });

  it('ยังไม่ถึง 72 ชม. -> ไม่ข้ามเครื่องไหน', async () => {
    rolloutFindMany.mockResolvedValue([
      rollout({ activeWindowStartedAt: hoursAgo(71) }),
    ]);
    mockTargets(['t1'], []);

    const result = await service.sweep(NOW);

    expect(markTargetSkippedOffline).not.toHaveBeenCalled();
    expect(result).toEqual({ skippedOffline: 0, applyTimedOut: 0 });
  });

  it('เกิน 72 ชม. และเครื่องไม่เคยดึง -> skipped_offline พร้อมข้อความระบุชั่วโมง', async () => {
    rolloutFindMany.mockResolvedValue([
      rollout({ activeWindowStartedAt: hoursAgo(73) }),
    ]);
    mockTargets(['t1', 't2'], []);

    const result = await service.sweep(NOW);

    expect(markTargetSkippedOffline).toHaveBeenCalledTimes(2);
    expect(markTargetSkippedOffline).toHaveBeenCalledWith(
      't1',
      'ข้าม: เครื่องออฟไลน์ ไม่มาดึงงานภายใน 72 ชั่วโมง',
    );
    expect(result.skippedOffline).toBe(2);
  });

  it('ใช้ pullTimeoutHours ของ Rollout แทนค่าเริ่มต้น', async () => {
    rolloutFindMany.mockResolvedValue([
      rollout({ activeWindowStartedAt: hoursAgo(5), pullTimeoutHours: 4 }),
    ]);
    mockTargets(['t1'], []);

    await service.sweep(NOW);

    expect(markTargetSkippedOffline).toHaveBeenCalledWith(
      't1',
      'ข้าม: เครื่องออฟไลน์ ไม่มาดึงงานภายใน 4 ชั่วโมง',
    );
  });

  it('Rollout paused -> ไม่นับเวลารอดึงงาน (หยุดนับจน Resume)', async () => {
    rolloutFindMany.mockResolvedValue([
      rollout({ status: 'paused', activeWindowStartedAt: hoursAgo(200) }),
    ]);
    mockTargets(['t1'], []);

    await service.sweep(NOW);

    expect(markTargetSkippedOffline).not.toHaveBeenCalled();
  });

  it('claim แพ้ (markTargetSkippedOffline คืน false) -> ไม่นับ', async () => {
    rolloutFindMany.mockResolvedValue([
      rollout({ activeWindowStartedAt: hoursAgo(80) }),
    ]);
    mockTargets(['t1'], []);
    markTargetSkippedOffline.mockResolvedValue(false);

    const result = await service.sweep(NOW);

    expect(result.skippedOffline).toBe(0);
  });

  it('ดึงงานแล้วเงียบเกิน 30 นาที -> recordTargetResult failed ด้วยข้อความมาตรฐาน', async () => {
    rolloutFindMany.mockResolvedValue([rollout()]);
    mockTargets([], ['DEV-1']);

    const result = await service.sweep(NOW);

    expect(targetFindMany).toHaveBeenCalledWith({
      where: {
        rolloutId: 'rollout-1',
        status: 'pending',
        pulledAt: { lt: new Date(NOW.getTime() - 30 * 60_000) },
      },
      select: { deviceId: true },
    });
    expect(recordTargetResult).toHaveBeenCalledWith(
      'DEV-1',
      { configId: 'cfg-1' },
      false,
      'ดึงงานแล้วไม่รายงานผลภายใน 30 นาที',
      'rollout-1',
    );
    expect(result.applyTimedOut).toBe(1);
  });

  it('ตรวจ "ดึงแล้วเงียบ" แม้ Rollout paused และใช้ applyTimeoutMinutes ของ Rollout', async () => {
    rolloutFindMany.mockResolvedValue([
      rollout({ status: 'paused', applyTimeoutMinutes: 10 }),
    ]);
    mockTargets([], ['DEV-1']);

    await service.sweep(NOW);

    expect(recordTargetResult).toHaveBeenCalledWith(
      'DEV-1',
      { configId: 'cfg-1' },
      false,
      'ดึงงานแล้วไม่รายงานผลภายใน 10 นาที',
      'rollout-1',
    );
  });
});
