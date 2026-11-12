import { BadRequestException } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient, type Device } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CampaignRolloutService } from '../../src/campaign/campaign-rollout.service';
import { CampaignService } from '../../src/campaign/campaign.service';
import { CampaignModule } from '../../src/campaign/campaign.module';
import { CentralRolloutPollService } from '../../src/campaign/central-rollout-poll.service';
import {
  FieldApplyRetryService,
  type FieldApplyDueAction,
} from '../../src/campaign/field-apply-retry.service';
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
 * docs/31 §6 (C1) — ลองส่งใหม่อัตโนมัติของ Campaign ปกติหลายเครื่อง (Operation ปล่อย Rollout จากเว็บ) กับ
 * Postgres จริง · Server กลางเป็นตัวปลอม · เวลาเลื่อนด้วยการแก้ `nextRetryAt`
 *
 * จุดที่ต่างจาก Rollout เครื่องเดียวของช่าง: นับเป็นล้ม/Auto Pause เมื่อครบ 3 ครั้งเท่านั้น · Rollout ไม่จบตราบที่มี
 * เครื่องรอรอบใหม่ · Pause ไม่จบเครื่องที่รอเป็น failed · ปิดสวิตช์ต่อ Campaign ได้ระหว่างทาง · claim ทีละตัวจำกัดต่อรอบ
 */
describe('Campaign auto-retry (integration — real postgres, fake central)', () => {
  let moduleFixture: TestingModule;
  let prisma: PrismaClient;
  let rolloutService: CampaignRolloutService;
  let campaignService: CampaignService;
  let poll: CentralRolloutPollService;
  let retry: FieldApplyRetryService;
  const previousMode = process.env.DEVICE_CONFIG_APPLY_MODE;

  let commandSeq = 0;
  const outcomes = new Map<string, CentralCommandOutcome>();
  const central = {
    pushConfig: jest.fn<Promise<unknown>, [string, Record<string, unknown>]>(),
    pushFirmware: jest.fn(),
    getCommandOutcome: jest.fn<Promise<CentralCommandOutcome>, [string]>(),
  };

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
    campaignService = moduleFixture.get(CampaignService);
    poll = moduleFixture.get(CentralRolloutPollService);
    retry = moduleFixture.get(FieldApplyRetryService);
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
    commandSeq = 0;
    outcomes.clear();
    central.pushConfig.mockReset().mockImplementation(() => {
      commandSeq += 1;
      return Promise.resolve({
        kind: 'sent',
        commandId: `CMD-${commandSeq}`,
        configVersion: commandSeq,
      });
    });
    central.getCommandOutcome
      .mockReset()
      .mockImplementation((commandId: string) =>
        Promise.resolve(outcomes.get(commandId) ?? { kind: 'pending' }),
      );
  });

  const failed = (errorCode: string): CentralCommandOutcome => ({
    kind: 'failed',
    detail: `ล้ม ${errorCode}`,
    errorCode,
  });

  /** ปล่อย Rollout ของ Campaign ปกติ n เครื่องเข้า Server กลาง (โหมด central) */
  async function seedReleased(n: number, autoRetry?: boolean) {
    const model = await getOrCreateDeviceModel(prisma, 'GT06N');
    const op1 = await makeUser(prisma, { role: 'Operation' });
    const op2 = await makeUser(prisma, { role: 'Operation' });
    const engineer = await makeUser(prisma, { role: 'ConfigEngineer' });
    const devices: Device[] = [];
    for (let i = 0; i < n; i += 1) {
      devices.push(
        await prisma.device.create({
          data: {
            deviceId: `DEV-${randomUUID().slice(0, 8)}`,
            simNumber: `89660000${Math.floor(Math.random() * 1e8)}`,
            deviceModel: 'GT06N',
            protocol: 'TCP',
            status: 'installed',
            modelId: model.id,
          },
        }),
      );
    }
    const config = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID().slice(0, 8)}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        status: 'approved',
        fields: { SPEED_LIMIT: 120, APN: 'internet' },
        createdBy: engineer.id,
        approvedBy: op2.id,
      },
    });
    const campaign = await prisma.campaign.create({
      data: {
        name: `กลุ่ม-${randomUUID().slice(0, 6)}`,
        createdBy: op1.id,
        ...(autoRetry === undefined ? {} : { autoRetry }),
      },
    });
    await prisma.campaignTarget.createMany({
      data: devices.map((d) => ({
        campaignId: campaign.id,
        deviceId: d.deviceId,
      })),
    });
    const created = await rolloutService.create(
      campaign.id,
      { payloadType: 'Config', configId: config.id },
      { id: op1.id, role: 'Operation' },
    );
    const operation = { id: op2.id, role: 'Operation' };
    await rolloutService.approve(created.id, operation);
    const rollout = await rolloutService.release(created.id, operation);
    return { rollout, campaign, devices, operation };
  }

  const targetOf = (rolloutId: string, deviceId: string) =>
    prisma.campaignRolloutTarget.findFirstOrThrow({
      where: { rolloutId, deviceId },
    });
  const rolloutOf = (id: string) =>
    prisma.campaignRollout.findUniqueOrThrow({ where: { id } });
  /** เลื่อนเวลา: ให้รอบใหม่ (หรือ lease) ถึงกำหนดแล้ว */
  async function makeDue(rolloutId: string) {
    await prisma.campaignRolloutTarget.updateMany({
      where: { rolloutId, nextRetryAt: { not: null } },
      data: { nextRetryAt: new Date(Date.now() - 1000) },
    });
  }
  /** ตั้งผลของคำสั่งล่าสุดที่ส่งให้เครื่องนี้ */
  async function setOutcome(
    rolloutId: string,
    deviceId: string,
    outcome: CentralCommandOutcome,
  ) {
    const t = await targetOf(rolloutId, deviceId);
    outcomes.set(t.centralCommandId as string, outcome);
  }

  it('3 เครื่อง: ล้ม/ลองใหม่สำเร็จ/ล้มครบ 3 ครั้ง ปนกัน -> ระหว่างรอ Rollout ไม่จบและไม่นับล้ม · นับล้มเฉพาะเครื่องที่ครบ 3 ครั้ง · แล้วจบ', async () => {
    const { rollout, devices } = await seedReleased(3);
    const [a, b, c] = devices.map((d) => d.deviceId);
    await setOutcome(rollout.id, a, failed('DEVICE_DISCONNECTED'));
    await setOutcome(rollout.id, b, failed('ROLLED_BACK'));
    await setOutcome(rollout.id, c, { kind: 'success' });

    const r1 = await poll.poll();

    expect(r1).toMatchObject({ retrying: 2, failed: 0, success: 1 });
    expect(await targetOf(rollout.id, a)).toMatchObject({
      status: 'pending',
      attemptCount: 1,
    });
    // ยังไม่จบ (C1/C2): มี pending อยู่ · ไม่มีใครนับเป็นล้ม
    expect(await rolloutOf(rollout.id)).toMatchObject({
      status: 'active',
      successCount: 1,
      failureCount: 0,
    });

    // รอบ 2: A สำเร็จ B ล้มอีก
    await makeDue(rollout.id);
    expect((await poll.poll()).retried).toBe(2);
    await setOutcome(rollout.id, a, { kind: 'success' });
    await setOutcome(rollout.id, b, failed('ROLLED_BACK'));
    await poll.poll();
    expect(await targetOf(rollout.id, a)).toMatchObject({ status: 'success' });
    expect(await targetOf(rollout.id, b)).toMatchObject({
      status: 'pending',
      attemptCount: 2,
    });
    expect(await rolloutOf(rollout.id)).toMatchObject({
      status: 'active',
      failureCount: 0,
    });

    // รอบ 3: B ล้มอีก = ครบ 3 ครั้ง -> failed ครั้งเดียว · Rollout จบ
    await makeDue(rollout.id);
    expect((await poll.poll()).retried).toBe(1);
    await setOutcome(rollout.id, b, failed('ROLLED_BACK'));
    const last = await poll.poll();

    expect(last.failed).toBe(1);
    const tb = await targetOf(rollout.id, b);
    expect(tb.status).toBe('failed');
    expect(tb.resultDetail).toContain('ส่ง 3 ครั้งไม่สำเร็จ');
    // ข้อความที่ผู้ใช้เห็น ไม่ใช้ em dash หรือ middle dot
    expect(tb.resultDetail).not.toMatch(/[—·]/);
    expect(await rolloutOf(rollout.id)).toMatchObject({
      status: 'completed',
      successCount: 2,
      failureCount: 1,
    });
    expect(central.pushConfig).toHaveBeenCalledTimes(3 + 2 + 1);
  });

  it('ปิดสวิตช์ autoRetry: ล้มครั้งเดียวนับเป็นล้มทันทีเหมือนเดิม ไม่มีรอบใหม่ · Campaign ใหม่ที่ไม่ระบุ = เปิดเป็นค่าเริ่มต้น', async () => {
    const off = await seedReleased(1, false);
    await setOutcome(
      off.rollout.id,
      off.devices[0].deviceId,
      failed('ROLLED_BACK'),
    );

    const result = await poll.poll();

    expect(result).toMatchObject({ failed: 1, retrying: 0 });
    const target = await targetOf(off.rollout.id, off.devices[0].deviceId);
    expect(target).toMatchObject({ status: 'failed', nextRetryAt: null });
    expect(await rolloutOf(off.rollout.id)).toMatchObject({
      status: 'completed',
      failureCount: 1,
    });

    const defaultOn = await prisma.campaign.create({
      data: { name: 'ค่าเริ่มต้น', createdBy: off.operation.id },
    });
    expect(defaultOn.autoRetry).toBe(true);
  });

  it('Pause ระหว่างรอรอบใหม่: ไม่ claim ไม่จบเป็น failed ปล่อยรอ · Resume แล้ว poll ถัดไปหยิบไปส่ง', async () => {
    const { rollout, devices, operation } = await seedReleased(2);
    const [a, b] = devices.map((d) => d.deviceId);
    await setOutcome(rollout.id, a, failed('DEVICE_DISCONNECTED'));
    await setOutcome(rollout.id, b, { kind: 'success' });
    await poll.poll();
    expect((await targetOf(rollout.id, a)).nextRetryAt).not.toBeNull();

    await prisma.campaignRollout.update({
      where: { id: rollout.id },
      data: { status: 'paused' },
    });
    await makeDue(rollout.id);
    const pushesBefore = central.pushConfig.mock.calls.length;

    expect(await retry.claimDueRetries()).toEqual([]);
    await poll.poll();

    const waiting = await targetOf(rollout.id, a);
    expect(waiting.status).toBe('pending'); // ไม่ถูกจบเป็น failed
    expect(waiting.attemptCount).toBe(1);
    expect(central.pushConfig.mock.calls.length).toBe(pushesBefore);

    await rolloutService.resume(rollout.id, operation);
    await makeDue(rollout.id);
    expect((await poll.poll()).retried).toBe(1);
    expect(await targetOf(rollout.id, a)).toMatchObject({
      status: 'pending',
      attemptCount: 2,
    });
    expect(central.pushConfig.mock.calls.length).toBe(pushesBefore + 1);
  });

  it('claim หลุดจาก Rollout ที่ถูก Pause พอดีระหว่างหาผู้สมัครกับ claim (สถานะที่อ่านมาเก่า): ไม่ claim ตัวนั้นไม่แตะ', async () => {
    const { rollout, devices } = await seedReleased(1);
    const a = devices[0].deviceId;
    await setOutcome(rollout.id, a, failed('DEVICE_DISCONNECTED'));
    await poll.poll();
    await makeDue(rollout.id);
    const before = await targetOf(rollout.id, a);
    // ผู้สมัครที่อ่านมาตอน Rollout ยัง active แต่ตอน claim จริงถูก Pause ไปแล้ว
    await prisma.campaignRollout.update({
      where: { id: rollout.id },
      data: { status: 'paused' },
    });
    const staleCandidate = {
      ...before,
      rollout: {
        status: 'active' as const,
        payloadType: 'Config',
        configId: rollout.configId,
        firmwareId: null,
        approvedBy: rollout.approvedBy,
        createdBy: rollout.createdBy,
        campaign: { name: 'กลุ่มปกติ', autoRetry: true },
      },
    };

    const action = await (
      retry as unknown as {
        claimOne: (
          t: typeof staleCandidate,
          now: Date,
        ) => Promise<FieldApplyDueAction | null>;
      }
    ).claimOne(staleCandidate, new Date());

    expect(action).toBeNull();
    expect(await targetOf(rollout.id, a)).toMatchObject({
      status: 'pending',
      attemptCount: before.attemptCount,
    });
  });

  it('ปิดสวิตช์ระหว่างที่เครื่องรอรอบใหม่ -> จบทันทีที่ poll ถัดไป (ยังไม่ถึงเวลาก็จบ) ไม่ส่ง จบด้วยผลรอบล่าสุดพร้อมบอกว่าปิดการลองใหม่ · เครื่องอื่นของ Rollout ไม่ถูกแตะ', async () => {
    const { rollout, campaign, devices } = await seedReleased(2);
    const [a, b] = devices.map((d) => d.deviceId);
    await setOutcome(rollout.id, a, failed('DEVICE_DISCONNECTED'));
    await poll.poll();
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { autoRetry: false },
    });
    // ไม่เรียก makeDue: nextRetryAt ยังอยู่ในอนาคต (รีวิว B บน #457)
    expect(
      (await targetOf(rollout.id, a)).nextRetryAt!.getTime(),
    ).toBeGreaterThan(Date.now());
    const pushesBefore = central.pushConfig.mock.calls.length;

    await poll.poll();

    const ta = await targetOf(rollout.id, a);
    expect(ta.status).toBe('failed');
    expect(ta.resultDetail).toContain('ล้ม DEVICE_DISCONNECTED');
    expect(ta.resultDetail).toContain('ปิดการลองส่งใหม่');
    expect(central.pushConfig.mock.calls.length).toBe(pushesBefore);
    expect((await targetOf(rollout.id, b)).status).toBe('pending'); // ยังรอผลรอบแรกอยู่
  });

  it('ปิดสวิตช์ตอน Rollout paused: เครื่องที่รอไม่ถูกจบ ปล่อยรอจน Resume · Resume แล้วจบด้วยผลรอบล่าสุด', async () => {
    const { rollout, campaign, devices } = await seedReleased(1);
    const a = devices[0].deviceId;
    await setOutcome(rollout.id, a, failed('DEVICE_DISCONNECTED'));
    await poll.poll();
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { autoRetry: false },
    });
    await prisma.campaignRollout.update({
      where: { id: rollout.id },
      data: { status: 'paused' },
    });

    await poll.poll();
    expect((await targetOf(rollout.id, a)).status).toBe('pending');

    await prisma.campaignRollout.update({
      where: { id: rollout.id },
      data: { status: 'active' },
    });
    await poll.poll();
    expect((await targetOf(rollout.id, a)).status).toBe('failed');
  });

  it('claim ทีละตัวตอนจะส่ง + จำกัดต่อรอบ: ตัวที่เหลือไม่ถูก claim ก่อนถึงตา · เกินเพดานไม่ถูกแตะ', async () => {
    const { rollout, devices } = await seedReleased(3);
    for (const d of devices) {
      await setOutcome(rollout.id, d.deviceId, failed('DEVICE_DISCONNECTED'));
    }
    await poll.poll();
    await makeDue(rollout.id);

    const seenWhileHandling: number[][] = [];
    const processed = await retry.processDueRetries(
      async () => {
        // ระหว่างจัดการตัวหนึ่ง ตัวอื่นต้องยังไม่ถูก claim (attemptCount ยังเป็น 1)
        const all = await prisma.campaignRolloutTarget.findMany({
          where: { rolloutId: rollout.id },
          orderBy: { nextRetryAt: 'asc' },
        });
        seenWhileHandling.push(all.map((t) => t.attemptCount));
        return;
      },
      undefined,
      2,
    );

    expect(processed).toBe(2);
    // ตอนจัดการตัวแรก: claim แล้ว 1 ตัว (attemptCount 2) อีก 2 ตัวยัง 1 · ตอนตัวที่สอง: 2 ตัวแล้ว
    expect(seenWhileHandling[0].filter((n) => n === 2)).toHaveLength(1);
    expect(seenWhileHandling[1].filter((n) => n === 2)).toHaveLength(2);
    const after = await prisma.campaignRolloutTarget.findMany({
      where: { rolloutId: rollout.id },
    });
    expect(after.filter((t) => t.attemptCount === 1)).toHaveLength(1); // ตัวที่เกินเพดานไม่ถูกแตะ
    // รอบ poll ถัดไปหยิบตัวที่เหลือ
    const rest = await retry.processDueRetries(
      () => Promise.resolve(),
      undefined,
      2,
    );
    expect(rest).toBe(1);
  });

  it('CampaignService: สร้างด้วย autoRetry=false · PATCH ส่งแค่ autoRetry ได้ · ไม่ส่งอะไรเลย 400', async () => {
    const op = await makeUser(prisma, { role: 'Operation' });
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
    const actor = { id: op.id, role: 'Operation' };

    const created = await campaignService.create(
      {
        name: 'ปิดลองใหม่',
        targets: [{ deviceId: device.deviceId }],
        autoRetry: false,
      },
      actor,
    );
    expect(created.autoRetry).toBe(false);

    const on = await campaignService.update(
      created.id,
      { autoRetry: true },
      actor,
    );
    expect(on.autoRetry).toBe(true);
    expect(on.name).toBe('ปิดลองใหม่');

    await expect(campaignService.update(created.id, {}, actor)).rejects.toThrow(
      BadRequestException,
    );
  });
});
