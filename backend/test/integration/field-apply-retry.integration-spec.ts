import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CampaignRolloutService } from '../../src/campaign/campaign-rollout.service';
import { CampaignModule } from '../../src/campaign/campaign.module';
import { CentralRolloutPollService } from '../../src/campaign/central-rollout-poll.service';
import { FieldApplyRetryService } from '../../src/campaign/field-apply-retry.service';
import {
  FIELD_APPLY_RESULT_EVENT,
  FIELD_APPLY_RETRY_EVENT,
  RolloutEvents,
  type FieldApplyResultEvent,
  type FieldApplyRetryEvent,
} from '../../src/campaign/rollout-events';
import type { CentralCommandOutcome } from '../../src/central-device/central-config';
import { CentralDeviceService } from '../../src/central-device/central-device.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  createTestPrisma,
  getOrCreateDeviceModel,
  makeUser,
  resetDb,
  TEST_DATABASE_URL,
} from './setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * docs/31 R1 — ลองส่งเข้ากล่องใหม่อัตโนมัติ (Rollout ส่งจากหน้างาน · โหมด central) กับ
 * Postgres จริง: ตัดสินลองใหม่ทั้ง 2 จุดดัก, claim แบบ lease, Override แถวเดิมทุกรอบ ·
 * Server กลางเป็นตัวปลอม (pushConfig / getCommandOutcome) เวลาเลื่อนด้วยการแก้ `nextRetryAt`
 */
describe('Field apply auto-retry (integration — real postgres, fake central)', () => {
  let moduleFixture: TestingModule;
  let prisma: PrismaClient;
  let rolloutService: CampaignRolloutService;
  let poll: CentralRolloutPollService;
  let retry: FieldApplyRetryService;
  let events: RolloutEvents;
  const previousMode = process.env.DEVICE_CONFIG_APPLY_MODE;

  let commandSeq = 0;
  const central = {
    pushConfig: jest.fn<Promise<unknown>, [string, Record<string, unknown>]>(),
    pushFirmware: jest.fn(),
    getCommandOutcome: jest.fn<Promise<CentralCommandOutcome>, [string]>(),
  };
  const retryEvents: FieldApplyRetryEvent[] = [];
  const resultEvents: FieldApplyResultEvent[] = [];

  beforeAll(async () => {
    process.env.DEVICE_CONFIG_APPLY_MODE = 'central';
    moduleFixture = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        CampaignModule,
      ],
    })
      .overrideProvider(CentralDeviceService)
      .useValue(central)
      .compile();

    rolloutService = moduleFixture.get(CampaignRolloutService);
    poll = moduleFixture.get(CentralRolloutPollService);
    retry = moduleFixture.get(FieldApplyRetryService);
    events = moduleFixture.get(RolloutEvents);
    events.on(FIELD_APPLY_RETRY_EVENT, (e: FieldApplyRetryEvent) =>
      retryEvents.push(e),
    );
    events.on(FIELD_APPLY_RESULT_EVENT, (e: FieldApplyResultEvent) =>
      resultEvents.push(e),
    );
    prisma = createTestPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.DEVICE_CONFIG_APPLY_MODE;
    else process.env.DEVICE_CONFIG_APPLY_MODE = previousMode;
    await prisma.$disconnect();
    await moduleFixture.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    retryEvents.length = 0;
    resultEvents.length = 0;
    commandSeq = 0;
    central.pushConfig.mockReset().mockImplementation(() => {
      commandSeq += 1;
      return Promise.resolve({
        kind: 'sent',
        commandId: `CMD-${commandSeq}`,
        configVersion: commandSeq,
      });
    });
    central.getCommandOutcome.mockReset();
  });

  const failed = (errorCode: string): CentralCommandOutcome => ({
    kind: 'failed',
    detail: `ล้ม ${errorCode}`,
    errorCode,
  });
  const skipped = (errorCode: string): CentralCommandOutcome => ({
    kind: 'skipped',
    detail: `ข้าม ${errorCode}`,
    errorCode,
  });

  async function seedFieldApply(opts?: { override?: Prisma.InputJsonObject }) {
    const operation = await makeUser(prisma, { role: 'Operation' });
    const tech = await makeUser(prisma, { role: 'ST' });
    const engineer = await makeUser(prisma, { role: 'ConfigEngineer' });
    const model = await getOrCreateDeviceModel(prisma, 'GT06N');
    const device = await prisma.device.create({
      data: {
        deviceId: `DEV-${randomUUID().slice(0, 8)}`,
        simNumber: `89660000${Math.floor(Math.random() * 1e8)}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'installed',
        modelId: model.id,
      },
    });
    const config = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID().slice(0, 8)}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'approved',
        fields: { SPEED_LIMIT: 120, APN: 'internet' },
        createdBy: engineer.id,
        approvedBy: operation.id,
      },
    });
    const override = opts?.override
      ? await prisma.deviceConfigOverride.create({
          data: {
            deviceId: device.deviceId,
            configId: config.id,
            versionNumber: 1,
            fields: opts.override,
            reason: 'ทดสอบ',
            status: 'approved',
            overriddenBy: tech.id,
            decidedBy: operation.id,
            decidedAt: new Date(),
          },
        })
      : null;
    const { rolloutId } = await prisma.$transaction((tx) =>
      rolloutService.createFieldApplyRollout(tx, {
        requestId: randomUUID(),
        deviceId: device.deviceId,
        configId: config.id,
        requestedBy: tech.id,
        approvedBy: operation.id,
      }),
    );
    await rolloutService.startFieldApplyRollout(rolloutId, operation.id);
    return { rolloutId, device, config, override, tech, operation };
  }

  const targetOf = (rolloutId: string) =>
    prisma.campaignRolloutTarget.findFirstOrThrow({ where: { rolloutId } });
  const attemptsOf = async (rolloutId: string) => {
    const t = await targetOf(rolloutId);
    return prisma.campaignRolloutTargetAttempt.findMany({
      where: { targetId: t.id },
      orderBy: { attemptNo: 'asc' },
    });
  };
  /** เลื่อนเวลา: ให้รอบใหม่ (หรือ lease) ถึงกำหนดแล้ว */
  async function makeDue(rolloutId: string) {
    await prisma.campaignRolloutTarget.updateMany({
      where: { rolloutId, nextRetryAt: { not: null } },
      data: { nextRetryAt: new Date(Date.now() - 1000) },
    });
  }

  it('ล้มรอบ 1 (DEVICE_DISCONNECTED) -> ตั้งรอบใหม่ 30 วินาที ไม่บันทึกผล · ถึงเวลา -> ส่งของเดิมรอบ 2 · สำเร็จ', async () => {
    const { rolloutId } = await seedFieldApply();
    const sentAt = Date.now();
    central.getCommandOutcome.mockResolvedValueOnce(
      failed('DEVICE_DISCONNECTED'),
    );

    const r1 = await poll.poll();

    expect(r1).toMatchObject({ retrying: 1, failed: 0, retried: 0 });
    let target = await targetOf(rolloutId);
    expect(target).toMatchObject({
      status: 'pending',
      centralCommandId: null,
      attemptCount: 1,
    });
    const wait = (target.nextRetryAt as Date).getTime() - sentAt;
    expect(wait).toBeGreaterThanOrEqual(29_000);
    expect(wait).toBeLessThan(40_000);
    expect(retryEvents).toEqual([
      expect.objectContaining({
        rolloutId,
        attemptNo: 1,
        maxAttempts: 3,
        errorCode: 'DEVICE_DISCONNECTED',
      }),
    ]);
    expect(resultEvents).toEqual([]);

    // ยังไม่ถึงเวลา: ไม่ส่ง
    await poll.poll();
    expect(central.pushConfig).toHaveBeenCalledTimes(1);

    await makeDue(rolloutId);
    const r2 = await poll.poll();
    expect(r2.retried).toBe(1);
    expect(central.pushConfig).toHaveBeenCalledTimes(2);
    expect(central.pushConfig.mock.calls[1]).toEqual(
      central.pushConfig.mock.calls[0],
    );
    target = await targetOf(rolloutId);
    expect(target).toMatchObject({
      status: 'pending',
      attemptCount: 2,
      centralCommandId: 'CMD-2',
      nextRetryAt: null,
    });

    central.getCommandOutcome.mockResolvedValueOnce({ kind: 'success' });
    await poll.poll();

    expect((await targetOf(rolloutId)).status).toBe('success');
    expect(
      (await attemptsOf(rolloutId)).map((a) => [
        a.attemptNo,
        a.status,
        a.errorCode,
        a.centralCommandId,
      ]),
    ).toEqual([
      [1, 'failed', 'DEVICE_DISCONNECTED', 'CMD-1'],
      [2, 'succeeded', null, 'CMD-2'],
    ]);
    expect(resultEvents).toEqual([
      expect.objectContaining({ rolloutId, outcome: 'succeeded' }),
    ]);
    // AuditLog ทุกรอบที่ส่ง พร้อม attemptNo
    const audits = await prisma.auditLog.findMany({
      where: { action: 'apply-config' },
      orderBy: { createdAt: 'asc' },
    });
    expect(
      audits.map((a) => (a.metadata as { attemptNo?: number }).attemptNo),
    ).toEqual([1, 2]);
  });

  it('ล้มครบ 3 รอบ -> failed ครั้งเดียว พร้อมสรุปทุกรอบ · รอรอบ 2 นาน 60 วินาที', async () => {
    const { rolloutId } = await seedFieldApply();
    central.getCommandOutcome.mockResolvedValue(failed('ROLLED_BACK'));

    await poll.poll(); // รอบ 1 ล้ม
    await makeDue(rolloutId);
    await poll.poll(); // ส่งรอบ 2
    const before = Date.now();
    await poll.poll(); // รอบ 2 ล้ม
    const wait =
      ((await targetOf(rolloutId)).nextRetryAt as Date).getTime() - before;
    expect(wait).toBeGreaterThanOrEqual(59_000);
    await makeDue(rolloutId);
    await poll.poll(); // ส่งรอบ 3
    const r = await poll.poll(); // รอบ 3 ล้ม -> จบ

    expect(r.failed).toBe(1);
    expect(central.pushConfig).toHaveBeenCalledTimes(3);
    const target = await targetOf(rolloutId);
    expect(target.status).toBe('failed');
    expect(target.resultDetail).toContain('ส่ง 3 ครั้งไม่สำเร็จ');
    expect(target.resultDetail).toContain('รอบ 3');
    expect(retryEvents.map((e) => e.attemptNo)).toEqual([1, 2]);
    expect(resultEvents).toEqual([
      expect.objectContaining({ rolloutId, outcome: 'failed' }),
    ]);
    const rollout = await prisma.campaignRollout.findUniqueOrThrow({
      where: { id: rolloutId },
    });
    expect(rollout.status).toBe('completed');
  });

  it('รอบสุดท้ายเป็น DEVICE_OFFLINE -> skipped_offline เหมือนเดิม (ไม่นับ failure)', async () => {
    const { rolloutId } = await seedFieldApply();
    central.getCommandOutcome.mockResolvedValue(skipped('DEVICE_OFFLINE'));

    await poll.poll();
    await makeDue(rolloutId);
    await poll.poll();
    await poll.poll();
    await makeDue(rolloutId);
    await poll.poll();
    await poll.poll();

    const target = await targetOf(rolloutId);
    expect(target.status).toBe('skipped_offline');
    const rollout = await prisma.campaignRollout.findUniqueOrThrow({
      where: { id: rolloutId },
    });
    expect(rollout.failureCount).toBe(0);
    expect(resultEvents).toEqual([
      expect.objectContaining({ outcome: 'skipped_offline' }),
    ]);
  });

  it('SUPERSEDED -> ไม่ลองใหม่ จบทันที', async () => {
    const { rolloutId } = await seedFieldApply();
    central.getCommandOutcome.mockResolvedValueOnce(skipped('SUPERSEDED'));

    const r = await poll.poll();

    expect(r).toMatchObject({ retrying: 0, skipped: 1 });
    expect((await targetOf(rolloutId)).status).toBe('skipped_offline');
    expect(retryEvents).toEqual([]);
  });

  it('ทางที่ 2: ส่งไม่ถึง Server กลาง (unavailable) ตอนส่งครั้งแรก -> ตั้งรอบใหม่ ไม่ล้มทันที', async () => {
    central.pushConfig.mockReset();
    central.pushConfig
      .mockResolvedValueOnce({ kind: 'unavailable', reason: 'Server กลางล่ม' })
      .mockResolvedValueOnce({
        kind: 'sent',
        commandId: 'CMD-OK',
        configVersion: 2,
      });

    const { rolloutId } = await seedFieldApply();

    let target = await targetOf(rolloutId);
    expect(target.status).toBe('pending');
    expect(target.nextRetryAt).not.toBeNull();
    expect(retryEvents).toEqual([
      expect.objectContaining({ attemptNo: 1, errorCode: null }),
    ]);
    expect(resultEvents).toEqual([]);

    await makeDue(rolloutId);
    await poll.poll();

    target = await targetOf(rolloutId);
    expect(target).toMatchObject({
      attemptCount: 2,
      centralCommandId: 'CMD-OK',
      nextRetryAt: null,
    });
    const attempts = await attemptsOf(rolloutId);
    expect(attempts.map((a) => [a.status, a.centralCommandId])).toEqual([
      ['failed', null],
      ['sent', 'CMD-OK'],
    ]);
  });

  it('ทางที่ 2: Server กลางปฏิเสธ (rejected) -> failed ทันที ไม่ลองใหม่', async () => {
    central.pushConfig.mockReset();
    central.pushConfig.mockResolvedValueOnce({
      kind: 'rejected',
      reason: 'ไม่รู้จักกล่อง',
    });

    const { rolloutId } = await seedFieldApply();

    const target = await targetOf(rolloutId);
    expect(target.status).toBe('failed');
    expect(target.resultDetail).toBe('ไม่รู้จักกล่อง');
    expect(retryEvents).toEqual([]);
  });

  it('lease: claim แล้ว process ตาย (ไม่ได้ส่ง) -> lease หมด หยิบใหม่เอง นับรอบที่ค้าง · สอง poll แย่งกันได้ claim เดียว', async () => {
    const { rolloutId } = await seedFieldApply();
    central.getCommandOutcome.mockResolvedValueOnce(
      failed('DEVICE_NO_RESPONSE'),
    );
    await poll.poll();
    await makeDue(rolloutId);

    // สองตัวพร้อมกัน -> ได้ action เดียว
    const [a, b] = await Promise.all([
      retry.claimDueRetries(),
      retry.claimDueRetries(),
    ]);
    expect(a.length + b.length).toBe(1);
    // จำลอง process ตาย: claim แล้วไม่ส่ง
    let target = await targetOf(rolloutId);
    expect(target.attemptCount).toBe(2);
    expect(target.centralCommandId).toBeNull();
    expect((target.nextRetryAt as Date).getTime()).toBeGreaterThan(
      Date.now() + 50_000,
    );

    // lease หมด
    await makeDue(rolloutId);
    await poll.poll();

    target = await targetOf(rolloutId);
    expect(target).toMatchObject({
      attemptCount: 3,
      centralCommandId: 'CMD-2',
      nextRetryAt: null,
    });
    const attempts = await attemptsOf(rolloutId);
    expect(attempts.map((x) => x.status)).toEqual(['failed', 'failed', 'sent']);
    expect(attempts[1].detail).toContain('หยุดกลางทาง');
  });

  it('lease ของรอบสุดท้ายหมด -> จบเป็น failed ไม่ค้าง pending', async () => {
    const { rolloutId } = await seedFieldApply();
    const target = await targetOf(rolloutId);
    // จำลอง: รอบ 3 ถูก claim แล้ว process ตาย
    await prisma.campaignRolloutTarget.update({
      where: { id: target.id },
      data: {
        attemptCount: 3,
        centralCommandId: null,
        nextRetryAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.campaignRolloutTargetAttempt.create({
      data: { targetId: target.id, attemptNo: 3, status: 'sending' },
    });

    const r = await poll.poll();

    expect(r.failed).toBe(1);
    const after = await targetOf(rolloutId);
    expect(after.status).toBe('failed');
    expect(after.resultDetail).toContain('หยุดกลางทาง');
  });

  it('Override: รอบลองใหม่ใช้ Override แถวเดิมของรอบแรก แม้รอบแรก mark consumedAt ไปแล้ว และมี Override ใหม่อนุมัติระหว่างรอ', async () => {
    const { rolloutId, device, config, tech, operation, override } =
      await seedFieldApply({ override: { SPEED_LIMIT: 90 } });

    expect(central.pushConfig.mock.calls[0][1]).toMatchObject({
      SPEED_LIMIT: 90,
    });
    let target = await targetOf(rolloutId);
    expect(target.appliedConfigOverrideId).toBe(override?.id);
    const consumed = await prisma.deviceConfigOverride.findUniqueOrThrow({
      where: { id: override!.id },
    });
    expect(consumed.consumedAt).not.toBeNull();

    // Override ใหม่ถูกอนุมัติระหว่างรอรอบใหม่
    await prisma.deviceConfigOverride.create({
      data: {
        deviceId: device.deviceId,
        configId: config.id,
        versionNumber: 2,
        fields: { SPEED_LIMIT: 60 },
        reason: 'ค่าใหม่',
        status: 'approved',
        overriddenBy: tech.id,
        decidedBy: operation.id,
        decidedAt: new Date(),
      },
    });

    central.getCommandOutcome.mockResolvedValueOnce(
      failed('DEVICE_DISCONNECTED'),
    );
    await poll.poll();
    await makeDue(rolloutId);
    await poll.poll();

    expect(central.pushConfig).toHaveBeenCalledTimes(2);
    expect(central.pushConfig.mock.calls[1][1]).toMatchObject({
      SPEED_LIMIT: 90,
    });
    target = await targetOf(rolloutId);
    expect(target.appliedConfigOverrideId).toBe(override?.id);
    const v2 = await prisma.deviceConfigOverride.findFirstOrThrow({
      where: { versionNumber: 2 },
    });
    expect(v2.consumedAt).toBeNull();
  });

  it('Rollout ไม่ active ตอนถึงเวลาลองใหม่ -> ไม่ส่ง จบด้วยผลของรอบล่าสุด (ไม่ค้าง pending)', async () => {
    const { rolloutId } = await seedFieldApply();
    central.getCommandOutcome.mockResolvedValueOnce(
      failed('DEVICE_DISCONNECTED'),
    );
    await poll.poll();
    await prisma.campaignRollout.update({
      where: { id: rolloutId },
      data: { status: 'paused' },
    });
    await makeDue(rolloutId);

    await poll.poll();

    expect(central.pushConfig).toHaveBeenCalledTimes(1);
    const target = await targetOf(rolloutId);
    expect(target.status).toBe('failed');
    expect(target.resultDetail).toContain('ล้ม DEVICE_DISCONNECTED');
  });

  it('target เดิม (centralCommandId = null, nextRetryAt = null) ไม่ถูกหยิบไปลองใหม่', async () => {
    const { rolloutId } = await seedFieldApply();
    await prisma.campaignRolloutTarget.updateMany({
      where: { rolloutId },
      data: { centralCommandId: null, nextRetryAt: null },
    });

    expect(await retry.claimDueRetries()).toEqual([]);
    expect(central.pushConfig).toHaveBeenCalledTimes(1);
  });

  it('ทางจบก็ใช้ lease (รีวิว A #440): claim แบบ finish แล้ว process ตายก่อนบันทึกผล -> lease หมดถูกหยิบมาจบอีกครั้ง', async () => {
    const { rolloutId } = await seedFieldApply();
    central.getCommandOutcome.mockResolvedValueOnce(
      failed('DEVICE_DISCONNECTED'),
    );
    await poll.poll();
    await prisma.campaignRollout.update({
      where: { id: rolloutId },
      data: { status: 'paused' },
    });
    await makeDue(rolloutId);

    // claim แบบ finish แต่ไม่บันทึกผล (จำลอง process ตาย)
    const actions = await retry.claimDueRetries();
    expect(actions).toEqual([expect.objectContaining({ kind: 'finish' })]);
    let target = await targetOf(rolloutId);
    expect(target.status).toBe('pending');
    expect(target.attemptCount).toBe(1);
    expect((target.nextRetryAt as Date).getTime()).toBeGreaterThan(
      Date.now() + 50_000,
    );

    await makeDue(rolloutId);
    await poll.poll();

    target = await targetOf(rolloutId);
    expect(target.status).toBe('failed');
    expect(central.pushConfig).toHaveBeenCalledTimes(1);
  });

  it('ตัวที่รอรอบลองใหม่ไม่ถูกเส้นทางส่งทั่วไปหยิบไปส่งก่อนเวลา (รีวิว A #440 ข้อสังเกต 1)', async () => {
    const { rolloutId, operation } = await seedFieldApply();
    central.getCommandOutcome.mockResolvedValueOnce(
      failed('DEVICE_DISCONNECTED'),
    );
    await poll.poll();
    expect((await targetOf(rolloutId)).nextRetryAt).not.toBeNull();

    // เช่น resume()/approve() เรียกเส้นทางส่งทั่วไประหว่างรอ
    await rolloutService.startFieldApplyRollout(rolloutId, operation.id);

    expect(central.pushConfig).toHaveBeenCalledTimes(1);
    const target = await targetOf(rolloutId);
    expect(target).toMatchObject({ attemptCount: 1, centralCommandId: null });
  });
});
