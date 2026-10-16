import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { CampaignRolloutService } from '../../src/campaign/campaign-rollout.service';
import { CampaignModule } from '../../src/campaign/campaign.module';
import { RolloutTimeoutService } from '../../src/campaign/rollout-timeout.service';
import { DeviceSyncModule } from '../../src/device-sync/device-sync.module';
import { IncidentModule } from '../../src/incident/incident.module';
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
 * เวลารอเครื่องที่ไม่ตอบกลับ + Incident อัตโนมัติ (docs/19 §15 ถึง §16)
 * ผ่าน Postgres จริง: ตั้ง `activeWindowStartedAt` / `pulledAt` ย้อนหลังใน DB
 * แล้วเรียก `RolloutTimeoutService.sweep()` ตรงๆ แทนการรอเวลาจริง
 */
describe('Rollout timeout + auto Incident (integration — real postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let rolloutService: CampaignRolloutService;
  let timeoutService: RolloutTimeoutService;
  const previousMode = process.env.DEVICE_CONFIG_APPLY_MODE;
  const apiKeyOf = new Map<string, string>();

  beforeAll(async () => {
    process.env.DEVICE_CONFIG_APPLY_MODE = 'real';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        CampaignModule,
        DeviceSyncModule,
        IncidentModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    rolloutService = moduleFixture.get(CampaignRolloutService, {
      strict: false,
    });
    timeoutService = moduleFixture.get(RolloutTimeoutService, {
      strict: false,
    });
    prisma = createTestPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    if (previousMode === undefined) {
      delete process.env.DEVICE_CONFIG_APPLY_MODE;
    } else {
      process.env.DEVICE_CONFIG_APPLY_MODE = previousMode;
    }
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function seedDevice() {
    const model = await getOrCreateDeviceModel(prisma, 'GT06N');
    const rawKey = `key-${randomUUID()}`;
    const device = await prisma.device.create({
      data: {
        deviceId: `DEV-${randomUUID().slice(0, 8)}`,
        simNumber: `89660000${Math.floor(Math.random() * 1e8)}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'installed',
        modelId: model.id,
        apiKeyHash: await bcrypt.hash(rawKey, 4),
      },
    });
    apiKeyOf.set(device.deviceId, rawKey);
    return device;
  }

  async function seedReleasedRollout(deviceIds: string[]) {
    const op1 = await makeUser(prisma, { role: 'Operation' });
    const op2 = await makeUser(prisma, { role: 'Operation' });
    const creator = await makeUser(prisma, { role: 'ConfigEngineer' });
    const config = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'approved',
        fields: { SPEED_LIMIT: 120, APN: 'internet' },
        createdBy: creator.id,
      },
    });
    const campaign = await prisma.campaign.create({
      data: { name: 'กลุ่มทดสอบเวลารอ', createdBy: op1.id },
    });
    await prisma.campaignTarget.createMany({
      data: deviceIds.map((deviceId) => ({
        campaignId: campaign.id,
        deviceId,
      })),
    });
    const created = await rolloutService.create(
      campaign.id,
      { payloadType: 'Config', configId: config.id },
      { id: op1.id, role: 'Operation' },
    );
    await rolloutService.approve(created.id, { id: op2.id, role: 'Operation' });
    const rollout = await rolloutService.release(created.id, {
      id: op2.id,
      role: 'Operation',
    });
    return { op2, config, campaign, rollout };
  }

  /** event ถูกจัดการแบบ async (void) — รอให้ตกลง DB ก่อนตรวจ */
  async function waitFor<T>(
    read: () => Promise<T | null>,
    attempts = 40,
  ): Promise<T> {
    for (let i = 0; i < attempts; i += 1) {
      const value = await read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('waitFor: หมดเวลารอผลใน DB');
  }

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  it('ไม่เคยมาดึงงานเกิน 72 ชม. -> skipped_offline, Rollout completed, Incident severity low, ไม่นับเป็น failureCount', async () => {
    const a = await seedDevice();
    const { rollout } = await seedReleasedRollout([a.deviceId]);
    await prisma.campaignRollout.update({
      where: { id: rollout.id },
      data: { activeWindowStartedAt: hoursAgo(73) },
    });

    const result = await timeoutService.sweep();

    expect(result.skippedOffline).toBe(1);
    const target = await prisma.campaignRolloutTarget.findFirstOrThrow({
      where: { rolloutId: rollout.id },
    });
    expect(target.status).toBe('skipped_offline');
    const after = await prisma.campaignRollout.findUniqueOrThrow({
      where: { id: rollout.id },
    });
    expect(after.status).toBe('completed');
    expect(after.failureCount).toBe(0);

    const incident = await waitFor(() =>
      prisma.incident.findFirst({ where: { source: 'rollout-failure' } }),
    );
    expect(incident.severity).toBe('low');
    expect(incident.status).toBe('open');
  });

  it('ดึงงานแล้วเงียบเกิน 30 นาที -> failed นับเข้า failureCount, Incident severity critical', async () => {
    const a = await seedDevice();
    const { rollout } = await seedReleasedRollout([a.deviceId]);
    await prisma.campaignRolloutTarget.updateMany({
      where: { rolloutId: rollout.id },
      data: { pulledAt: new Date(Date.now() - 31 * 60_000) },
    });

    const result = await timeoutService.sweep();

    expect(result.applyTimedOut).toBe(1);
    const target = await prisma.campaignRolloutTarget.findFirstOrThrow({
      where: { rolloutId: rollout.id },
    });
    expect(target.status).toBe('failed');
    expect(target.resultDetail).toContain('ดึงงานแล้วไม่รายงานผลภายใน 30 นาที');

    const incident = await waitFor(() =>
      prisma.incident.findFirst({ where: { source: 'rollout-failure' } }),
    );
    expect(incident.severity).toBe('critical');
    expect(incident.relatedConfigId).toBe(rollout.configId);
  });

  it('ยังไม่ถึงเวลา -> sweep ไม่ทำอะไร', async () => {
    const a = await seedDevice();
    const { rollout } = await seedReleasedRollout([a.deviceId]);
    await prisma.campaignRolloutTarget.updateMany({
      where: { rolloutId: rollout.id },
      data: { pulledAt: new Date(Date.now() - 5 * 60_000) },
    });

    const result = await timeoutService.sweep();

    expect(result).toEqual({ skippedOffline: 0, applyTimedOut: 0 });
    expect(await prisma.incident.count()).toBe(0);
  });

  it('เครื่องที่ถูกข้ามกลับมาดึงงานเอง -> ได้งานเดิมและรายงานผลล่าช้าได้ (success)', async () => {
    const a = await seedDevice();
    const { rollout } = await seedReleasedRollout([a.deviceId]);
    await prisma.campaignRollout.update({
      where: { id: rollout.id },
      data: { activeWindowStartedAt: hoursAgo(80) },
    });
    await timeoutService.sweep();
    const key = apiKeyOf.get(a.deviceId) as string;

    const jobs = await request(app.getHttpServer())
      .get(`/api/v1/device-sync/${a.deviceId}/jobs`)
      .set('X-Device-Api-Key', key)
      .expect(200);
    const body = jobs.body as { jobs: { jobId: string }[] };
    expect(body.jobs).toHaveLength(1);

    await request(app.getHttpServer())
      .post(
        `/api/v1/device-sync/${a.deviceId}/jobs/${body.jobs[0].jobId}/result`,
      )
      .set('X-Device-Api-Key', key)
      .send({ result: 'success', detail: 'ใช้ค่าแล้ว' })
      .expect(200);

    const target = await prisma.campaignRolloutTarget.findUniqueOrThrow({
      where: { id: body.jobs[0].jobId },
    });
    expect(target.status).toBe('success');
    expect(target.resultDetail).toContain('ผลล่าช้า');
    const after = await prisma.campaignRollout.findUniqueOrThrow({
      where: { id: rollout.id },
    });
    expect(after.successCount).toBe(1);
  });

  it('Rollout ที่ค้างอยู่ในโหมด mock ไม่ถูก sweep', async () => {
    const a = await seedDevice();
    const { rollout } = await seedReleasedRollout([a.deviceId]);
    await prisma.campaignRollout.update({
      where: { id: rollout.id },
      data: { applyMode: 'mock', activeWindowStartedAt: hoursAgo(100) },
    });

    const result = await timeoutService.sweep();

    expect(result).toEqual({ skippedOffline: 0, applyTimedOut: 0 });
  });
});
