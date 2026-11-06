import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { CampaignModule } from '../../src/campaign/campaign.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  createTestPrisma,
  getOrCreateRole,
  makeUser,
  resetDb,
  TEST_DATABASE_URL,
} from './setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;

// อ่าน body ของ response (รายการของ object ทั่วไป) แบบไม่ต้อง cast ทีละจุด
const b = (res: request.Response): Record<string, unknown>[] =>
  res.body as Record<string, unknown>[];

/**
 * docs/31 §6.4 (C2) — ผลต่อเครื่องของ Rollout บอกรอบที่ลองส่ง + ประวัติรายรอบของเครื่องหนึ่ง · HTTP + Postgres จริง
 * สร้างสถานะ target ตรงใน DB (ไม่ต้องมี Server กลาง) เพื่อทดสอบการแสดงผลของ API เท่านั้น
 */
describe('GET /campaigns/:id/rollouts/:rid/targets (+ /attempts) — รอบที่ลองส่ง (integration)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        CampaignModule,
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
    jwtService = moduleFixture.get(JwtService);
    prisma = createTestPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    await prisma.rolePermission.deleteMany();
    const op = await makeUser(prisma, { role: 'Operation' });
    const role = await getOrCreateRole(prisma, 'Operation');
    await prisma.rolePermission.create({
      data: {
        roleId: role.id,
        resource: 'campaign',
        action: ActionType.Read,
      },
    });
    token = jwtService.sign({ sub: op.id, role: 'Operation' });
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000);

  async function seedRollout() {
    const creator = await makeUser(prisma, { role: 'ConfigEngineer' });
    const op = await makeUser(prisma, { role: 'Operation' });
    const config = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID().slice(0, 8)}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'approved',
        fields: { SPEED_LIMIT: 120 },
        createdBy: creator.id,
      },
    });
    const campaign = await prisma.campaign.create({
      data: { name: `กลุ่ม-${randomUUID().slice(0, 6)}`, createdBy: op.id },
    });
    const rollout = await prisma.campaignRollout.create({
      data: {
        campaignId: campaign.id,
        payloadType: 'Config',
        configId: config.id,
        status: 'active',
        targetCount: 3,
        createdBy: op.id,
        approvedBy: op.id,
        applyMode: 'central',
      },
    });
    return { campaign, rollout };
  }

  const addTarget = (
    rolloutId: string,
    deviceId: string,
    data: Record<string, unknown> = {},
  ) =>
    prisma.campaignRolloutTarget.create({
      data: { rolloutId, deviceId, ...data },
    });
  const addAttempt = (
    targetId: string,
    attemptNo: number,
    status: string,
    over: Record<string, unknown> = {},
  ) =>
    prisma.campaignRolloutTargetAttempt.create({
      data: {
        targetId,
        attemptNo,
        status,
        startedAt: new Date(Date.now() - 600_000 + attemptNo * 1000),
        ...over,
      },
    });

  it('รอส่งรอบใหม่ -> nextRetryAt + lastAttempt · กำลังส่ง (nextRetryAt เป็น lease) -> nextRetryAt เป็น null · ไม่มีประวัติ -> lastAttempt null', async () => {
    const { campaign, rollout } = await seedRollout();
    const waiting = await addTarget(rollout.id, 'DEV-WAIT', {
      attemptCount: 1,
      centralCommandId: null,
      nextRetryAt: minutesFromNow(1),
    });
    await addAttempt(waiting.id, 1, 'failed', {
      errorCode: 'DEVICE_DISCONNECTED',
      detail: 'กล่องหลุด',
      finishedAt: new Date(),
    });
    const sending = await addTarget(rollout.id, 'DEV-SEND', {
      attemptCount: 2,
      centralCommandId: 'CMD-2',
      nextRetryAt: minutesFromNow(1), // lease ไม่ใช่เวลารอ
    });
    await addAttempt(sending.id, 1, 'failed', { finishedAt: new Date() });
    await addAttempt(sending.id, 2, 'sent');
    await addTarget(rollout.id, 'DEV-OLD'); // ข้อมูลเดิมก่อน docs/31

    const res = await request(app.getHttpServer())
      .get(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/targets`)
      .set(auth());

    expect(res.status).toBe(200);
    const by = (id: string) =>
      (b(res) as { deviceId: string }[]).find(
        (t) => t.deviceId === id,
      ) as Record<string, unknown>;
    expect(by('DEV-WAIT').attemptCount).toBe(1);
    expect(by('DEV-WAIT').nextRetryAt).toBeTruthy();
    expect(by('DEV-WAIT').lastAttempt).toMatchObject({
      attemptNo: 1,
      status: 'failed',
      errorCode: 'DEVICE_DISCONNECTED',
      detail: 'กล่องหลุด',
    });
    expect(by('DEV-SEND').attemptCount).toBe(2);
    expect(by('DEV-SEND').nextRetryAt).toBeNull();
    expect(by('DEV-SEND').lastAttempt).toMatchObject({
      attemptNo: 2,
      status: 'sent',
    });
    expect(by('DEV-OLD').nextRetryAt).toBeNull();
    expect(by('DEV-OLD').lastAttempt).toBeNull();
  });

  it('ประวัติรายรอบ: เรียงรอบที่ 1 ก่อน และไม่คืนรหัสคำสั่งของ Server กลาง', async () => {
    const { campaign, rollout } = await seedRollout();
    const t = await addTarget(rollout.id, 'DEV-1', { attemptCount: 3 });
    await addAttempt(t.id, 3, 'failed', {
      finishedAt: new Date(),
      detail: 'c',
    });
    await addAttempt(t.id, 1, 'failed', {
      finishedAt: new Date(),
      detail: 'a',
      centralCommandId: 'CMD-SECRET-1',
    });
    await addAttempt(t.id, 2, 'failed', {
      finishedAt: new Date(),
      detail: 'b',
    });

    const res = await request(app.getHttpServer())
      .get(
        `/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/targets/${t.id}/attempts`,
      )
      .set(auth());

    expect(res.status).toBe(200);
    expect((b(res) as { attemptNo: number }[]).map((a) => a.attemptNo)).toEqual(
      [1, 2, 3],
    );
    expect(JSON.stringify(res.body)).not.toContain('CMD-SECRET-1');
    expect(Object.keys(b(res)[0]).sort()).toEqual(
      [
        'attemptNo',
        'detail',
        'errorCode',
        'finishedAt',
        'startedAt',
        'status',
      ].sort(),
    );
  });

  it('IDOR: target ของ Rollout/Campaign อื่น -> 404 · id ไม่มีจริง -> 404 · ไม่ใช่ uuid -> 400', async () => {
    const mine = await seedRollout();
    const other = await seedRollout();
    const foreign = await addTarget(other.rollout.id, 'DEV-OTHER');
    await addAttempt(foreign.id, 1, 'failed', { detail: 'ของคนอื่น' });
    const base = `/api/v1/campaigns/${mine.campaign.id}/rollouts/${mine.rollout.id}/targets`;

    // target ของ Rollout อื่น ถามผ่าน Campaign/Rollout ของเรา
    const crossRollout = await request(app.getHttpServer())
      .get(`${base}/${foreign.id}/attempts`)
      .set(auth());
    expect(crossRollout.status).toBe(404);
    expect(JSON.stringify(crossRollout.body)).not.toContain('ของคนอื่น');

    // target ของ Rollout เราเอง แต่ถามผ่าน Campaign อื่น (path ไม่ตรงกับความเป็นเจ้าของ)
    const own = await addTarget(mine.rollout.id, 'DEV-OWN');
    await addAttempt(own.id, 1, 'failed', { detail: 'ของเรา' });
    const wrongCampaign = await request(app.getHttpServer())
      .get(
        `/api/v1/campaigns/${other.campaign.id}/rollouts/${mine.rollout.id}/targets/${own.id}/attempts`,
      )
      .set(auth());
    expect(wrongCampaign.status).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/${own.id}/attempts`)
          .set(auth())
      ).status,
    ).toBe(200);

    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/${randomUUID()}/attempts`)
          .set(auth())
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/not-a-uuid/attempts`)
          .set(auth())
      ).status,
    ).toBe(400);
  });

  it('สิทธิ์: ไม่มี token 401 · Role ที่ไม่มีสิทธิ์ campaign Read 403 ทั้งสอง endpoint', async () => {
    const { campaign, rollout } = await seedRollout();
    const t = await addTarget(rollout.id, 'DEV-1');
    const url = `/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/targets`;

    expect((await request(app.getHttpServer()).get(url)).status).toBe(401);
    expect(
      (await request(app.getHttpServer()).get(`${url}/${t.id}/attempts`))
        .status,
    ).toBe(401);

    const st = await makeUser(prisma, { role: 'ST' });
    const stToken = jwtService.sign({ sub: st.id, role: 'ST' });
    const denied = { Authorization: `Bearer ${stToken}` };
    expect(
      (await request(app.getHttpServer()).get(url).set(denied)).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${url}/${t.id}/attempts`)
          .set(denied)
      ).status,
    ).toBe(403);
  });
});
