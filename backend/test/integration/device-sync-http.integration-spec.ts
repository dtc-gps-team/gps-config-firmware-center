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
import { DeviceSyncModule } from '../../src/device-sync/device-sync.module';
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
 * device-sync (docs/19) ผ่าน HTTP จริง + Postgres จริง: อุปกรณ์ยืนยันตัวตนด้วย
 * `X-Device-Api-Key` (`DeviceApiKeyGuard`) ดึงงานแล้วรายงานผลกลับ · ตั้ง
 * `DEVICE_CONFIG_APPLY_MODE=real` ก่อนสร้าง module เพื่อให้ `release()` บันทึก
 * `applyMode = real` และไม่ apply ให้เอง
 *
 * สร้าง/อนุมัติ/ปล่อย Rollout ผ่าน `CampaignRolloutService` ตรงๆ (ไม่ผ่าน HTTP
 * ของ staff) เพราะที่ทดสอบคือฝั่งอุปกรณ์ — เส้นทาง staff มี integration test
 * ของตัวเองอยู่แล้ว (`campaign-rollout-http.integration-spec.ts`)
 */
describe('DeviceSyncController (integration — real postgres + DeviceApiKeyGuard)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let rolloutService: CampaignRolloutService;
  const previousMode = process.env.DEVICE_CONFIG_APPLY_MODE;

  beforeAll(async () => {
    process.env.DEVICE_CONFIG_APPLY_MODE = 'real';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        CampaignModule,
        DeviceSyncModule,
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

  const apiKeyOf = new Map<string, string>();

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

  async function seedConfig(creatorId: string, name = `cfg-${randomUUID()}`) {
    return prisma.config.create({
      data: {
        name,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'approved',
        fields: { SPEED_LIMIT: 120, APN: 'internet' },
        createdBy: creatorId,
      },
    });
  }

  /** สร้างกลุ่ม + Rollout Config -> อนุมัติโดยอีกคน -> ปล่อย (โหมด real) */
  async function seedReleasedRollout(deviceIds: string[]) {
    const op1 = await makeUser(prisma, { role: 'Operation' });
    const op2 = await makeUser(prisma, { role: 'Operation' });
    const creator = await makeUser(prisma, { role: 'ConfigEngineer' });
    const config = await seedConfig(creator.id);
    const campaign = await prisma.campaign.create({
      data: { name: 'กลุ่มทดสอบ', createdBy: op1.id },
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
    const released = await rolloutService.release(created.id, {
      id: op2.id,
      role: 'Operation',
    });
    return { op1, op2, config, campaign, rollout: released };
  }

  function jobsRequest(deviceId: string, key?: string) {
    const r = request(app.getHttpServer()).get(
      `/api/v1/device-sync/${deviceId}/jobs`,
    );
    return key === undefined ? r : r.set('X-Device-Api-Key', key);
  }

  function resultRequest(
    deviceId: string,
    jobId: string,
    body: unknown,
    key?: string,
  ) {
    const r = request(app.getHttpServer())
      .post(`/api/v1/device-sync/${deviceId}/jobs/${jobId}/result`)
      .send(body as object);
    return key === undefined ? r : r.set('X-Device-Api-Key', key);
  }

  type JobsBody = {
    jobs: {
      jobId: string;
      rolloutId: string;
      config: { configId: string; fields: Record<string, unknown> };
    }[];
    pollAfterSeconds: number;
  };

  it('ไม่แนบ key -> 401, key ผิด -> 401, ใช้ key ของเครื่องอื่นกับ path ของเครื่องนี้ -> 401', async () => {
    const a = await seedDevice();
    const b = await seedDevice();

    await jobsRequest(a.deviceId).expect(401);
    await jobsRequest(a.deviceId, 'wrong').expect(401);
    await jobsRequest(a.deviceId, apiKeyOf.get(b.deviceId)).expect(401);
  });

  it('release ในโหมด real -> Rollout applyMode=real เครื่องค้าง pending (backend ไม่ apply เอง)', async () => {
    const a = await seedDevice();
    const { rollout } = await seedReleasedRollout([a.deviceId]);

    expect(rollout.status).toBe('active');
    expect(rollout.applyMode).toBe('real');
    const target = await prisma.campaignRolloutTarget.findFirstOrThrow({
      where: { rolloutId: rollout.id },
    });
    expect(target.status).toBe('pending');
    expect(target.pulledAt).toBeNull();
  });

  it('ดึงงาน -> ได้ Config พร้อมค่าเฉพาะเครื่องที่อนุมัติแล้ว, ตั้ง pulledAt และ lastSeenAt', async () => {
    const a = await seedDevice();
    const { rollout, config, op2 } = await seedReleasedRollout([a.deviceId]);
    await prisma.deviceConfigOverride.create({
      data: {
        deviceId: a.deviceId,
        configId: config.id,
        versionNumber: 1,
        fields: { SPEED_LIMIT: 180 },
        reason: 'ลูกค้าขอ',
        status: 'approved',
        overriddenBy: op2.id,
      },
    });

    const res = await jobsRequest(a.deviceId, apiKeyOf.get(a.deviceId)).expect(
      200,
    );
    const body = res.body as JobsBody;

    expect(body.pollAfterSeconds).toBe(30);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].rolloutId).toBe(rollout.id);
    expect(body.jobs[0].config.configId).toBe(config.id);
    expect(body.jobs[0].config.fields).toEqual({
      SPEED_LIMIT: 180,
      APN: 'internet',
    });

    const target = await prisma.campaignRolloutTarget.findUniqueOrThrow({
      where: { id: body.jobs[0].jobId },
    });
    expect(target.status).toBe('pending');
    expect(target.pulledAt).not.toBeNull();
    const device = await prisma.device.findUniqueOrThrow({
      where: { deviceId: a.deviceId },
    });
    expect(device.lastSeenAt).not.toBeNull();
  });

  it('ดึงงานซ้ำ -> ได้งานเดิม pulledAt คงเวลาแรก', async () => {
    const a = await seedDevice();
    await seedReleasedRollout([a.deviceId]);
    const key = apiKeyOf.get(a.deviceId);

    const first = (await jobsRequest(a.deviceId, key).expect(200))
      .body as JobsBody;
    const pulledAt1 = (
      await prisma.campaignRolloutTarget.findUniqueOrThrow({
        where: { id: first.jobs[0].jobId },
      })
    ).pulledAt;
    const second = (await jobsRequest(a.deviceId, key).expect(200))
      .body as JobsBody;
    const pulledAt2 = (
      await prisma.campaignRolloutTarget.findUniqueOrThrow({
        where: { id: second.jobs[0].jobId },
      })
    ).pulledAt;

    expect(second.jobs[0].jobId).toBe(first.jobs[0].jobId);
    expect(pulledAt2?.getTime()).toBe(pulledAt1?.getTime());
  });

  it('รายงาน success -> target success, Rollout completed (เครื่องเดียว) ส่งซ้ำได้ accepted false', async () => {
    const a = await seedDevice();
    const { rollout } = await seedReleasedRollout([a.deviceId]);
    const key = apiKeyOf.get(a.deviceId);
    const { jobs } = (await jobsRequest(a.deviceId, key).expect(200))
      .body as JobsBody;

    const first = await resultRequest(
      a.deviceId,
      jobs[0].jobId,
      { result: 'success', detail: 'ใช้ค่าเรียบร้อย' },
      key,
    ).expect(200);
    expect(first.body).toEqual({ accepted: true });

    const target = await prisma.campaignRolloutTarget.findUniqueOrThrow({
      where: { id: jobs[0].jobId },
    });
    expect(target.status).toBe('success');
    expect(target.resultDetail).toBe('ใช้ค่าเรียบร้อย');
    const done = await prisma.campaignRollout.findUniqueOrThrow({
      where: { id: rollout.id },
    });
    expect(done.status).toBe('completed');
    expect(done.successCount).toBe(1);

    const again = await resultRequest(
      a.deviceId,
      jobs[0].jobId,
      { result: 'success' },
      key,
    ).expect(200);
    expect(again.body).toEqual({ accepted: false, reason: 'already-reported' });
    const unchanged = await prisma.campaignRollout.findUniqueOrThrow({
      where: { id: rollout.id },
    });
    expect(unchanged.successCount).toBe(1);

    // รายงานซ้ำที่ไม่ถูกนับ (ข้างบน) ถูกเก็บไว้ให้ Operation เห็นโดยไม่เปลี่ยน
    // สถานะ/ตัวนับ และเก็บเฉพาะรายงานแรกที่มาช้า รายงานถัดไปไม่ต่อซ้ำ
    // ข้อความไม่โตขึ้น (docs/19 §4.2)
    await resultRequest(
      a.deviceId,
      jobs[0].jobId,
      { result: 'failed', detail: 'ค่า APN ใช้ไม่ได้จริง' },
      key,
    ).expect(200);
    const withLate = await prisma.campaignRolloutTarget.findUniqueOrThrow({
      where: { id: jobs[0].jobId },
    });
    expect(withLate.status).toBe('success');
    expect(withLate.resultDetail).toBe(
      'ใช้ค่าเรียบร้อย | [รายงานล่าช้าจากเครื่อง: ใช้ Config สำเร็จ]',
    );

    // ครบแล้ว ไม่มีงานเหลือ
    const after = (await jobsRequest(a.deviceId, key).expect(200))
      .body as JobsBody;
    expect(after.jobs).toEqual([]);
  });

  it('body ผิดรูปแบบ -> 400, jobId ไม่ใช่ UUID -> 400, ข้อความยาวเกิน -> 400', async () => {
    const a = await seedDevice();
    await seedReleasedRollout([a.deviceId]);
    const key = apiKeyOf.get(a.deviceId);
    const { jobs } = (await jobsRequest(a.deviceId, key).expect(200))
      .body as JobsBody;

    await resultRequest(
      a.deviceId,
      jobs[0].jobId,
      { result: 'maybe' },
      key,
    ).expect(400);
    await resultRequest(
      a.deviceId,
      'not-a-uuid',
      { result: 'success' },
      key,
    ).expect(400);
    await resultRequest(
      a.deviceId,
      jobs[0].jobId,
      { result: 'failed', detail: 'x'.repeat(501) },
      key,
    ).expect(400);
  });

  it('jobId ของเครื่องอื่น -> 404 (IDOR) และไม่เปลี่ยนผลของเครื่องนั้น', async () => {
    const a = await seedDevice();
    const b = await seedDevice();
    await seedReleasedRollout([a.deviceId, b.deviceId]);
    const jobsA = (
      await jobsRequest(a.deviceId, apiKeyOf.get(a.deviceId)).expect(200)
    ).body as JobsBody;
    const jobsB = (
      await jobsRequest(b.deviceId, apiKeyOf.get(b.deviceId)).expect(200)
    ).body as JobsBody;

    await resultRequest(
      a.deviceId,
      jobsB.jobs[0].jobId,
      { result: 'failed' },
      apiKeyOf.get(a.deviceId),
    ).expect(404);

    const targetB = await prisma.campaignRolloutTarget.findUniqueOrThrow({
      where: { id: jobsB.jobs[0].jobId },
    });
    expect(targetB.status).toBe('pending');
    expect(jobsA.jobs[0].jobId).not.toBe(jobsB.jobs[0].jobId);
  });

  it('Auto Pause: เครื่องแรกล้มเหลว -> Rollout paused, เครื่องที่ยังไม่ดึงไม่ได้งาน, เครื่องที่ดึงไปแล้วยังรายงานผลได้, resume แล้วได้งาน', async () => {
    const a = await seedDevice();
    const b = await seedDevice();
    const c = await seedDevice();
    const { rollout, op2 } = await seedReleasedRollout([
      a.deviceId,
      b.deviceId,
      c.deviceId,
    ]);

    // a และ b ดึงงานไปแล้ว c ยังไม่ดึง
    const jobsA = (
      await jobsRequest(a.deviceId, apiKeyOf.get(a.deviceId)).expect(200)
    ).body as JobsBody;
    const jobsB = (
      await jobsRequest(b.deviceId, apiKeyOf.get(b.deviceId)).expect(200)
    ).body as JobsBody;

    await resultRequest(
      a.deviceId,
      jobsA.jobs[0].jobId,
      { result: 'failed', detail: 'ค่า APN ใช้ไม่ได้' },
      apiKeyOf.get(a.deviceId),
    ).expect(200);

    const paused = await prisma.campaignRollout.findUniqueOrThrow({
      where: { id: rollout.id },
    });
    expect(paused.status).toBe('paused');

    // เครื่อง c ยังไม่ดึง -> ไม่ได้งานระหว่างหยุด
    const jobsC = (
      await jobsRequest(c.deviceId, apiKeyOf.get(c.deviceId)).expect(200)
    ).body as JobsBody;
    expect(jobsC.jobs).toEqual([]);

    // เครื่อง b ดึงไปก่อนหยุด ยังรายงานผลได้
    const reportB = await resultRequest(
      b.deviceId,
      jobsB.jobs[0].jobId,
      { result: 'success' },
      apiKeyOf.get(b.deviceId),
    ).expect(200);
    expect(reportB.body).toEqual({ accepted: true });

    // Resume (โหมด real ไม่ apply ให้เอง) -> c ได้งาน
    await rolloutService.resume(rollout.id, { id: op2.id, role: 'Operation' });
    const afterResume = (
      await jobsRequest(c.deviceId, apiKeyOf.get(c.deviceId)).expect(200)
    ).body as JobsBody;
    expect(afterResume.jobs).toHaveLength(1);
    const targetC = await prisma.campaignRolloutTarget.findUniqueOrThrow({
      where: { id: afterResume.jobs[0].jobId },
    });
    expect(targetC.status).toBe('pending');
  });

  it('Config ถูกลบหลังปล่อย -> ดึงงานแล้วไม่ได้งาน และ target เป็น failed พร้อมเหตุผล', async () => {
    const a = await seedDevice();
    const { config, rollout } = await seedReleasedRollout([a.deviceId]);
    await prisma.config.update({
      where: { id: config.id },
      data: { deletedAt: new Date() },
    });

    const res = await jobsRequest(a.deviceId, apiKeyOf.get(a.deviceId)).expect(
      200,
    );

    expect((res.body as JobsBody).jobs).toEqual([]);
    const target = await prisma.campaignRolloutTarget.findFirstOrThrow({
      where: { rolloutId: rollout.id },
    });
    expect(target.status).toBe('failed');
    expect(target.resultDetail).toContain('ใช้งานไม่ได้อีกต่อไป');
  });

  it('Rollback ของ Rollout โหมด real -> รวมเครื่องที่สำเร็จและเครื่องที่ดึงไปแล้วแต่ยังไม่รายงาน ไม่รวมเครื่องที่ยังไม่ดึง และสืบทอด real', async () => {
    const a = await seedDevice(); // สำเร็จ
    const b = await seedDevice(); // ดึงแล้ว ยังไม่รายงาน
    const c = await seedDevice(); // ยังไม่ดึง
    const { rollout, campaign, config, op2 } = await seedReleasedRollout([
      a.deviceId,
      b.deviceId,
      c.deviceId,
    ]);
    // รอบก่อนหน้าที่ completed (เป้าหมายของ rollback)
    const oldConfig = await seedConfig(op2.id, `old-${randomUUID()}`);
    await prisma.campaignRollout.create({
      data: {
        campaignId: campaign.id,
        payloadType: 'Config',
        configId: oldConfig.id,
        status: 'completed',
        targetCount: 3,
        createdBy: op2.id,
        createdAt: new Date(Date.now() - 86_400_000),
      },
    });

    const jobsA = (
      await jobsRequest(a.deviceId, apiKeyOf.get(a.deviceId)).expect(200)
    ).body as JobsBody;
    await jobsRequest(b.deviceId, apiKeyOf.get(b.deviceId)).expect(200);
    await resultRequest(
      a.deviceId,
      jobsA.jobs[0].jobId,
      { result: 'success' },
      apiKeyOf.get(a.deviceId),
    ).expect(200);

    const rollback = await rolloutService.rollback(
      campaign.id,
      rollout.id,
      {},
      { id: op2.id, role: 'Operation' },
    );

    expect(rollback.applyMode).toBe('real');
    expect(rollback.configId).toBe(oldConfig.id);
    expect(rollback.configId).not.toBe(config.id);
    const targets = await prisma.campaignRolloutTarget.findMany({
      where: { rolloutId: rollback.id },
    });
    expect(targets.map((t) => t.deviceId).sort()).toEqual(
      [a.deviceId, b.deviceId].sort(),
    );
  });
});
