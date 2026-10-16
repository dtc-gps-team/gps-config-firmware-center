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
  getOrCreateDeviceModel,
  getOrCreateRole,
  makeUser,
  resetDb,
  RoleCode,
  TEST_DATABASE_URL,
} from './setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * CampaignRollout — `POST/GET /campaigns/{campaignId}/rollouts` ผ่าน HTTP จริง
 * (JwtAuthGuard -> PermissionGuard เต็มเส้นทาง) — แยกออกมาจาก
 * `campaign-http.integration-spec.ts` เดิม (แก้ไข 2026-09-24, Campaign
 * Monitor #22) เพราะ payload/approval ทั้งหมดย้ายมาอยู่ที่ `CampaignRollout`
 * แล้ว ดู comment เหนือ `model CampaignRollout` ใน schema.prisma
 */
describe('CampaignRolloutController (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

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
  });

  function tokenFor(sub: string, role: string): string {
    return jwtService.sign({ sub, role });
  }

  async function grant(
    roleCode: RoleCode,
    action: ActionType,
    resource = 'campaign',
  ): Promise<void> {
    const role = await getOrCreateRole(prisma, roleCode);
    await prisma.rolePermission.create({
      data: { roleId: role.id, resource, action },
    });
  }

  async function seedApprovedConfig(overrides?: {
    deviceModel?: string;
    protocol?: string;
  }) {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    return prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        deviceModel: overrides?.deviceModel ?? 'GT06N',
        protocol: overrides?.protocol ?? 'TCP',
        status: 'approved',
        fields: { APN: 'internet' },
        createdBy: configEngineerUser.id,
      },
    });
  }

  async function seedInstalledDevice(overrides?: {
    deviceModel?: string;
    protocol?: string;
    status?: 'registered' | 'installed' | 'decommissioned';
  }) {
    const deviceModel = overrides?.deviceModel ?? 'GT06N';
    const model = await getOrCreateDeviceModel(prisma, deviceModel);
    return prisma.device.create({
      data: {
        deviceId: `DEV-${randomUUID().slice(0, 8)}`,
        simNumber: `89660000${Math.floor(Math.random() * 1e8)}`,
        deviceModel,
        protocol: overrides?.protocol ?? 'TCP',
        status: overrides?.status ?? 'installed',
        modelId: model.id,
      },
    });
  }

  async function seedGroup(opUserId: string, deviceIds: string[]) {
    const campaign = await prisma.campaign.create({
      data: { name: 'กลุ่มทดสอบ', createdBy: opUserId },
    });
    await prisma.campaignTarget.createMany({
      data: deviceIds.map((deviceId) => ({
        campaignId: campaign.id,
        deviceId,
      })),
    });
    return campaign;
  }

  describe('POST /campaigns/:campaignId/rollouts', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(opUser.id, []);

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
        .send({ payloadType: 'Config' })
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ campaign.Create (ST) -> 403', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(opUser.id, []);
      const stUser = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ payloadType: 'Config' })
        .expect(403);
    });

    it('เป้าหมายครบถ้วน ผ่านทุกเงื่อนไข -> 201 + สร้าง CampaignRolloutTarget จริงใน DB จากสมาชิกกลุ่มทั้งหมด', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const deviceA = await seedInstalledDevice();
      const deviceB = await seedInstalledDevice();
      const campaign = await seedGroup(opUser.id, [
        deviceA.deviceId,
        deviceB.deviceId,
      ]);
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ payloadType: 'Config', configId: config.id })
        .expect(201);

      const body = res.body as {
        id: string;
        status: string;
        targetCount: number;
      };
      expect(body.status).toBe('pending_approval');
      expect(body.targetCount).toBe(2);

      const targets = await prisma.campaignRolloutTarget.findMany({
        where: { rolloutId: body.id },
      });
      expect(targets).toHaveLength(2);
      expect(targets.map((t) => t.deviceId).sort()).toEqual(
        [deviceA.deviceId, deviceB.deviceId].sort(),
      );
    });

    it('excludeDeviceIds เอาเครื่องออก 1 เครื่อง -> Rollout เหลือแค่เครื่องที่เหลือ', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const deviceA = await seedInstalledDevice();
      const deviceB = await seedInstalledDevice();
      const campaign = await seedGroup(opUser.id, [
        deviceA.deviceId,
        deviceB.deviceId,
      ]);
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          payloadType: 'Config',
          configId: config.id,
          excludeDeviceIds: [deviceB.deviceId],
        })
        .expect(201);

      const body = res.body as { id: string; targetCount: number };
      expect(body.targetCount).toBe(1);

      const targets = await prisma.campaignRolloutTarget.findMany({
        where: { rolloutId: body.id },
      });
      expect(targets.map((t) => t.deviceId)).toEqual([deviceA.deviceId]);
    });

    it('กลุ่มนี้มี Rollout pending_approval ค้างอยู่ -> 409, ไม่สร้าง Rollout ที่สอง', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice();
      const campaign = await seedGroup(opUser.id, [device.deviceId]);
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ payloadType: 'Config', configId: config.id })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ payloadType: 'Config', configId: config.id })
        .expect(409);

      expect(await prisma.campaignRollout.count()).toBe(1);
    });

    it('payloadType Firmware, ไม่พบ Firmware -> 404', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const device = await seedInstalledDevice();
      const campaign = await seedGroup(opUser.id, [device.deviceId]);
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ payloadType: 'Firmware', firmwareId: randomUUID() })
        .expect(404);
    });

    it('deviceModel/protocol ของ Device ไม่ตรงกับ Config -> 409', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig({
        deviceModel: 'GT06N',
        protocol: 'TCP',
      });
      const device = await seedInstalledDevice({
        deviceModel: 'GT06E',
        protocol: 'UDP',
      });
      const campaign = await seedGroup(opUser.id, [device.deviceId]);
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ payloadType: 'Config', configId: config.id })
        .expect(409);
    });

    it('สำเร็จ -> เขียน AuditLog action create (module campaign)', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice();
      const campaign = await seedGroup(opUser.id, [device.deviceId]);
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ payloadType: 'Config', configId: config.id })
        .expect(201);

      const logs = await prisma.auditLog.findMany({
        where: { userId: opUser.id, auditModule: 'campaign' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('create');
    });
  });

  describe('POST /campaigns/:campaignId/rollouts/:id/approve, .../reject', () => {
    async function seedPendingRollout(campaignId: string, createdBy: string) {
      return prisma.campaignRollout.create({
        data: { campaignId, payloadType: 'Config', createdBy },
      });
    }

    it('role ไม่มีสิทธิ์ campaign.Approve (ST) -> 403', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(opUser.id, []);
      const rollout = await seedPendingRollout(campaign.id, opUser.id);
      const stUser = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('Operation คนอื่น (ไม่ใช่ผู้สร้าง) อนุมัติ pending_approval -> 200, status approved + approvedBy (ยังไม่แตะอุปกรณ์จนกว่าจะกด release)', async () => {
      const creator = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(creator.id, []);
      const rollout = await seedPendingRollout(campaign.id, creator.id);
      const approver = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve);
      const token = tokenFor(approver.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { status: string; approvedBy: string };
      expect(body.status).toBe('approved');
      expect(body.approvedBy).toBe(approver.id);
    });

    it('มี payload/target จริง -> อนุมัติแล้วยังไม่แตะอุปกรณ์ ต้องกด release ต่อถึงจะ auto-apply ให้ทุกเครื่อง (แยก "อนุมัติ"/"ปล่อย" เป็น 2 ขั้นตอน)', async () => {
      const creator = await makeUser(prisma, { role: 'Operation' });
      const config = await seedApprovedConfig();
      const deviceA = await seedInstalledDevice();
      const deviceB = await seedInstalledDevice();
      const campaign = await seedGroup(creator.id, [
        deviceA.deviceId,
        deviceB.deviceId,
      ]);
      await grant('Operation', ActionType.Create);
      await grant('Operation', ActionType.Approve);
      const createRes = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
        .set('Authorization', `Bearer ${tokenFor(creator.id, 'Operation')}`)
        .send({ payloadType: 'Config', configId: config.id })
        .expect(201);
      const rolloutId = (createRes.body as { id: string }).id;
      const approver = await makeUser(prisma, { role: 'Operation' });

      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rolloutId}/approve`)
        .set('Authorization', `Bearer ${tokenFor(approver.id, 'Operation')}`)
        .expect(200);
      expect((approveRes.body as { status: string }).status).toBe('approved');

      // ยังไม่แตะอุปกรณ์เลยตอนอนุมัติ — target ต้องยังค้าง pending ทั้งคู่
      const targetsAfterApprove = await prisma.campaignRolloutTarget.findMany({
        where: { rolloutId },
      });
      expect(targetsAfterApprove.every((t) => t.status === 'pending')).toBe(
        true,
      );

      const releaseRes = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rolloutId}/release`)
        .set('Authorization', `Bearer ${tokenFor(approver.id, 'Operation')}`)
        .expect(200);

      const body = releaseRes.body as {
        status: string;
        successCount: number;
        failureCount: number;
      };
      expect(body.status).toBe('completed');
      expect(body.successCount).toBe(2);
      expect(body.failureCount).toBe(0);

      const targets = await prisma.campaignRolloutTarget.findMany({
        where: { rolloutId },
      });
      expect(targets.every((t) => t.status === 'success')).toBe(true);
    });

    it('ผู้สร้าง Rollout พยายามอนุมัติเอง -> 403 (Separation of Duty)', async () => {
      const creator = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(creator.id, []);
      const rollout = await seedPendingRollout(campaign.id, creator.id);
      await grant('Operation', ActionType.Approve);
      const token = tokenFor(creator.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('สถานะไม่ใช่ pending_approval (active อยู่แล้ว) -> 409', async () => {
      const creator = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(creator.id, []);
      const rollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          status: 'active',
          createdBy: creator.id,
        },
      });
      const approver = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve);
      const token = tokenFor(approver.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('Operation คนอื่นปฏิเสธ pending_approval -> 200, status rejected ไม่ตั้ง approvedBy — เปิด rollout ใหม่ในกลุ่มเดิมได้ทันที', async () => {
      const creator = await makeUser(prisma, { role: 'Operation' });
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice();
      const campaign = await seedGroup(creator.id, [device.deviceId]);
      const rollout = await seedPendingRollout(campaign.id, creator.id);
      const approver = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve);
      await grant('Operation', ActionType.Create);
      const token = tokenFor(approver.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { status: string; approvedBy: string | null };
      expect(body.status).toBe('rejected');
      expect(body.approvedBy).toBeNull();

      // rejected ไม่นับเป็น "ค้างอยู่" -> เปิดรอบใหม่ในกลุ่มเดิมได้ทันที
      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
        .set('Authorization', `Bearer ${tokenFor(creator.id, 'Operation')}`)
        .send({ payloadType: 'Config', configId: config.id })
        .expect(201);
    });

    // #250 review comment B — approved ที่ยังไม่ปล่อยเข้าอุปกรณ์ต้องมีทางถอย
    // ได้ก่อนแตะอุปกรณ์จริง ไม่งั้นทางเดียวที่หลุดออกจากสถานะนี้คือกด release
    // จริงแล้วค่อย rollback ซึ่งขัดเจตนาหลักของการแยกอนุมัติ/ปล่อย
    it('Operation คนอื่นปฏิเสธ approved (อนุมัติไปแล้วแต่ยังไม่ปล่อย) -> 200, status rejected — เปิด rollout ใหม่ในกลุ่มเดิมได้ทันที', async () => {
      const creator = await makeUser(prisma, { role: 'Operation' });
      const approver1 = await makeUser(prisma, { role: 'Operation' });
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice();
      const campaign = await seedGroup(creator.id, [device.deviceId]);
      const rollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          status: 'approved',
          createdBy: creator.id,
          approvedBy: approver1.id,
          approvedAt: new Date(),
        },
      });
      const approver2 = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve);
      await grant('Operation', ActionType.Create);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/reject`)
        .set('Authorization', `Bearer ${tokenFor(approver2.id, 'Operation')}`)
        .expect(200);

      expect((res.body as { status: string }).status).toBe('rejected');

      // rejected ไม่นับเป็น "ค้างอยู่" -> เปิดรอบใหม่ในกลุ่มเดิมได้ทันที
      // (ก่อนแก้ครั้งที่ 63 ข้อนี้ทำไม่ได้เลย เพราะ approved ค้างอยู่ใน
      // OPEN_CAMPAIGN_ROLLOUT_STATUSES แล้วไม่มีทางออกนอกจาก release)
      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts`)
        .set('Authorization', `Bearer ${tokenFor(creator.id, 'Operation')}`)
        .send({ payloadType: 'Config', configId: config.id })
        .expect(201);
    });

    /**
     * ส่งคำขอ approve/reject เข้า rollout เดียวกันพร้อมกัน — helper ของ 3 เคส
     * race ด้านล่าง
     */
    function decide(
      campaignId: string,
      rolloutId: string,
      action: 'approve' | 'reject',
      userId: string,
    ) {
      return request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignId}/rollouts/${rolloutId}/${action}`)
        .set('Authorization', `Bearer ${tokenFor(userId, 'Operation')}`);
    }

    it('2 request approve พร้อมกันบน rollout เดียวกัน -> ผ่านได้แค่ 1 อีกอันได้ 409 (race condition)', async () => {
      const creator = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(creator.id, []);
      const rollout = await seedPendingRollout(campaign.id, creator.id);
      const approver1 = await makeUser(prisma, { role: 'Operation' });
      const approver2 = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve);

      const [res1, res2] = await Promise.all([
        decide(campaign.id, rollout.id, 'approve', approver1.id),
        decide(campaign.id, rollout.id, 'approve', approver2.id),
      ]);

      expect([res1.status, res2.status].sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      // ผู้อนุมัติใน DB ต้องเป็นคนที่ชนะจริง ไม่ใช่ทั้งคู่ทับกัน
      const final = await prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rollout.id },
      });
      expect(final.status).toBe('approved');
      expect(final.approvedBy).toBe(
        res1.status === 200 ? approver1.id : approver2.id,
      );
    });

    it('2 request reject พร้อมกันบน rollout เดียวกัน -> ผ่านได้แค่ 1 อีกอันได้ 409 (race condition)', async () => {
      const creator = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(creator.id, []);
      const rollout = await seedPendingRollout(campaign.id, creator.id);
      const rejecter1 = await makeUser(prisma, { role: 'Operation' });
      const rejecter2 = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve);

      const [res1, res2] = await Promise.all([
        decide(campaign.id, rollout.id, 'reject', rejecter1.id),
        decide(campaign.id, rollout.id, 'reject', rejecter2.id),
      ]);

      expect([res1.status, res2.status].sort((a, b) => a - b)).toEqual([
        200, 409,
      ]);
      const final = await prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rollout.id },
      });
      expect(final.status).toBe('rejected');
    });

    // approve + reject พร้อมกัน **ผลไม่ตายตัวโดยออกแบบ** (แก้ครั้งที่ 63,
    // PR #250): reject() รับทั้ง pending_approval และ approved (ถอยก่อนปล่อย
    // เข้าอุปกรณ์) เดิมเคสนี้คาดว่าต้องได้ [200, 409] เสมอ ซึ่งผิดตั้งแต่ #250
    // — ถ้า approve commit ก่อน reject จะเห็น approved แล้วปฏิเสธต่อได้ 200
    // ทั้งคู่ (ล้ม ~2 ใน 3 รอบ) · สิ่งที่ต้องเป็นจริงเสมอไม่ว่าลำดับไหน: reject
    // ผ่านเสมอ, approve ผ่านหรือได้ 409, และผลสุดท้ายเป็น rejected
    it('approve กับ reject พร้อมกัน -> reject ผ่านเสมอ, approve ผ่านหรือ 409, ผลสุดท้ายต้องเป็น rejected', async () => {
      const creator = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(creator.id, []);
      const rollout = await seedPendingRollout(campaign.id, creator.id);
      const approver = await makeUser(prisma, { role: 'Operation' });
      const rejecter = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve);

      const [approveRes, rejectRes] = await Promise.all([
        decide(campaign.id, rollout.id, 'approve', approver.id),
        decide(campaign.id, rollout.id, 'reject', rejecter.id),
      ]);

      expect(rejectRes.status).toBe(200);
      expect([200, 409]).toContain(approveRes.status);
      const final = await prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rollout.id },
      });
      expect(final.status).toBe('rejected');
    });
  });

  describe('POST /campaigns/:campaignId/rollouts/:id/release (แยก "อนุมัติ"/"ปล่อยเข้าอุปกรณ์" เป็น 2 ขั้นตอน)', () => {
    async function seedApprovedRollout(campaignId: string, createdBy: string) {
      return prisma.campaignRollout.create({
        data: {
          campaignId,
          payloadType: 'Config',
          status: 'approved',
          createdBy,
        },
      });
    }

    it('role ไม่มีสิทธิ์ campaign.Approve (ST) -> 403', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(opUser.id, []);
      const rollout = await seedApprovedRollout(campaign.id, opUser.id);
      const stUser = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/release`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('approved -> 200, status active — ผู้อนุมัติเดิมเป็นคนกด release เองก็ได้ (ไม่เช็ค Separation of Duty)', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(opUser.id, []);
      const rollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          status: 'approved',
          createdBy: opUser.id,
          approvedBy: opUser.id,
          approvedAt: new Date(),
        },
      });
      await grant('Operation', ActionType.Approve);
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/release`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { status: string };
      expect(body.status).toBe('active');
    });

    it('สถานะปัจจุบันไม่ใช่ approved (pending_approval อยู่) -> 409', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(opUser.id, []);
      const rollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          createdBy: opUser.id,
        },
      });
      await grant('Operation', ActionType.Approve);
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/release`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });
  });

  describe('POST /campaigns/:campaignId/rollouts/:id/resume (Incident & Rollback #28)', () => {
    async function seedPausedRollout(campaignId: string, createdBy: string) {
      return prisma.campaignRollout.create({
        data: {
          campaignId,
          payloadType: 'Config',
          status: 'paused',
          createdBy,
        },
      });
    }

    it('role ไม่มีสิทธิ์ campaign.Approve (ST) -> 403', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(opUser.id, []);
      const rollout = await seedPausedRollout(campaign.id, opUser.id);
      const stUser = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/resume`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('paused -> 200, status active — ผู้สร้าง rollout เองก็ resume ได้ (ไม่เช็ค Separation of Duty)', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(opUser.id, []);
      const rollout = await seedPausedRollout(campaign.id, opUser.id);
      await grant('Operation', ActionType.Approve);
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/resume`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { status: string };
      expect(body.status).toBe('active');
    });

    it('สถานะปัจจุบันไม่ใช่ paused (active อยู่แล้ว) -> 409', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(opUser.id, []);
      const rollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          status: 'active',
          createdBy: opUser.id,
        },
      });
      await grant('Operation', ActionType.Approve);
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/resume`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });
  });

  describe('POST /campaigns/:campaignId/rollouts/:id/rollback (Incident & Rollback #28)', () => {
    async function seedCompletedRollout(
      campaignId: string,
      createdBy: string,
      configId: string,
      ageMs: number,
    ) {
      return prisma.campaignRollout.create({
        data: {
          campaignId,
          payloadType: 'Config',
          configId,
          status: 'completed',
          createdBy,
          targetCount: 1,
          successCount: 1,
          createdAt: new Date(Date.now() - ageMs),
        },
      });
    }

    it('role ไม่มีสิทธิ์ campaign.Create (ST) -> 403', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const config = await seedApprovedConfig();
      const campaign = await seedGroup(opUser.id, []);
      const badRollout = await seedCompletedRollout(
        campaign.id,
        opUser.id,
        config.id,
        1_000,
      );
      const stUser = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .post(
          `/api/v1/campaigns/${campaign.id}/rollouts/${badRollout.id}/rollback`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(403);
    });

    it('สำเร็จ -> 201, สร้าง Rollout ใหม่ isRollback=true จาก payload ของรอบก่อนหน้าที่ completed ล่าสุด', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice();
      const campaign = await seedGroup(opUser.id, [device.deviceId]);
      const previousRollout = await seedCompletedRollout(
        campaign.id,
        opUser.id,
        config.id,
        60_000,
      );
      const badRollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          configId: config.id,
          status: 'active',
          createdBy: opUser.id,
          targetCount: 1,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: {
          rolloutId: badRollout.id,
          deviceId: device.deviceId,
          status: 'success',
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(
          `/api/v1/campaigns/${campaign.id}/rollouts/${badRollout.id}/rollback`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      const body = res.body as {
        id: string;
        status: string;
        isRollback: boolean;
        rollbackOfId: string;
        configId: string;
        targetCount: number;
      };
      expect(body.status).toBe('pending_approval');
      expect(body.isRollback).toBe(true);
      expect(body.rollbackOfId).toBe(badRollout.id);
      expect(body.configId).toBe(previousRollout.configId);
      expect(body.targetCount).toBe(1);

      const newTargets = await prisma.campaignRolloutTarget.findMany({
        where: { rolloutId: body.id },
      });
      expect(newTargets.map((t) => t.deviceId)).toEqual([device.deviceId]);

      // #238 review B รอบ 2 ข้อ 2 — รอบเดิมที่ active ต้องถูก cancel ไม่งั้น
      // จะค้างเป็น 2 รอบ active พร้อมกัน + การ์ด "Rollout หยุดชั่วคราว" นับผิด
      const reloadedBadRollout = await prisma.campaignRollout.findUniqueOrThrow(
        { where: { id: badRollout.id } },
      );
      expect(reloadedBadRollout.status).toBe('cancelled');
    });

    it('รอบเดิม status paused (Auto Pause) -> cancel รอบเดิมด้วยเหมือนกันหลัง rollback สำเร็จ', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice();
      const campaign = await seedGroup(opUser.id, [device.deviceId]);
      await seedCompletedRollout(campaign.id, opUser.id, config.id, 60_000);
      const badRollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          configId: config.id,
          status: 'paused',
          createdBy: opUser.id,
          targetCount: 1,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: {
          rolloutId: badRollout.id,
          deviceId: device.deviceId,
          status: 'success',
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(
          `/api/v1/campaigns/${campaign.id}/rollouts/${badRollout.id}/rollback`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      const reloadedBadRollout = await prisma.campaignRollout.findUniqueOrThrow(
        { where: { id: badRollout.id } },
      );
      expect(reloadedBadRollout.status).toBe('cancelled');
    });

    it('รอบเดิม status completed -> ไม่แตะสถานะ (ไม่มีอะไรค้างให้ cancel)', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice();
      const campaign = await seedGroup(opUser.id, [device.deviceId]);
      await seedCompletedRollout(campaign.id, opUser.id, config.id, 120_000);
      const badRollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          configId: config.id,
          status: 'completed',
          createdBy: opUser.id,
          targetCount: 1,
          successCount: 1,
          createdAt: new Date(Date.now() - 60_000),
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: {
          rolloutId: badRollout.id,
          deviceId: device.deviceId,
          status: 'success',
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(
          `/api/v1/campaigns/${campaign.id}/rollouts/${badRollout.id}/rollback`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      const reloadedBadRollout = await prisma.campaignRollout.findUniqueOrThrow(
        { where: { id: badRollout.id } },
      );
      expect(reloadedBadRollout.status).toBe('completed');
    });

    it('สถานะยังไม่เคยส่ง payload จริง (pending_approval) -> 409', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const campaign = await seedGroup(opUser.id, []);
      const badRollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          configId: config.id,
          status: 'pending_approval',
          createdBy: opUser.id,
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(
          `/api/v1/campaigns/${campaign.id}/rollouts/${badRollout.id}/rollback`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(409);
    });

    it('ไม่มีรอบก่อนหน้าที่ completed ของ payloadType เดียวกัน -> 400', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const campaign = await seedGroup(opUser.id, []);
      const badRollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          configId: config.id,
          status: 'active',
          createdBy: opUser.id,
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(
          `/api/v1/campaigns/${campaign.id}/rollouts/${badRollout.id}/rollback`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('excludeDeviceIds มีเครื่องที่ไม่ได้อยู่ในรายการที่ได้รับ payload สำเร็จ -> 400', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice();
      const campaign = await seedGroup(opUser.id, [device.deviceId]);
      await seedCompletedRollout(campaign.id, opUser.id, config.id, 60_000);
      const badRollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          configId: config.id,
          status: 'active',
          createdBy: opUser.id,
          targetCount: 1,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: {
          rolloutId: badRollout.id,
          deviceId: device.deviceId,
          status: 'success',
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(
          `/api/v1/campaigns/${campaign.id}/rollouts/${badRollout.id}/rollback`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({ excludeDeviceIds: ['DEV-NOT-IN-LIST'] })
        .expect(400);
    });
  });

  describe('GET /campaigns/:campaignId/rollouts/:id/targets', () => {
    it('เจอ rollout -> 200 คืนผลต่อเครื่อง', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Read);
      const device = await seedInstalledDevice();
      const campaign = await seedGroup(opUser.id, [device.deviceId]);
      const rollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          createdBy: opUser.id,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: { rolloutId: rollout.id, deviceId: device.deviceId },
      });
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/targets`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect((res.body as { status: string }[])[0].status).toBe('pending');
    });
  });

  describe('ค่าเฉพาะเครื่องตอนสร้าง/ปล่อย Rollout (docs/17)', () => {
    async function seedDefinitions() {
      await prisma.configFieldDefinition.deleteMany();
      for (const def of [
        { fieldName: 'SPEED_LIMIT', dataType: 'integer', sensitive: false },
        { fieldName: 'COMMAND_PASSWORD', dataType: 'string', sensitive: true },
      ]) {
        await prisma.configFieldDefinition.create({
          data: {
            fieldName: def.fieldName,
            dataType: def.dataType,
            allowedValues: [],
            sensitive: def.sensitive,
            supportedModels: {
              create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
            },
          },
        });
      }
    }

    async function seedScenario() {
      await seedDefinitions();
      const creator = await makeUser(prisma, { role: 'Operation' });
      const approver = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      await grant('Operation', ActionType.Approve);
      await grant('Operation', ActionType.Read);
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice();
      const other = await seedInstalledDevice();
      const campaign = await seedGroup(creator.id, [
        device.deviceId,
        other.deviceId,
      ]);
      return { creator, approver, config, device, other, campaign };
    }

    function createWithValues(
      campaignId: string,
      token: string,
      body: Record<string, unknown>,
    ) {
      return request(app.getHttpServer())
        .post(`/api/v1/campaigns/${campaignId}/rollouts`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    it('สร้างพร้อม deviceValues -> เก็บ proposedFields ที่ target และเหตุผลที่ Rollout ยังไม่มี override', async () => {
      const s = await seedScenario();

      const res = await createWithValues(
        s.campaign.id,
        tokenFor(s.creator.id, 'Operation'),
        {
          payloadType: 'Config',
          configId: s.config.id,
          deviceValues: [
            { deviceId: s.device.deviceId, fields: { SPEED_LIMIT: 180 } },
          ],
          deviceValuesReason: 'ลูกค้าขอเพดานความเร็วสูงกว่าปกติ',
        },
      ).expect(201);

      const rolloutId = (res.body as { id: string }).id;
      const rollout = await prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rolloutId },
      });
      expect(rollout.deviceValuesReason).toBe(
        'ลูกค้าขอเพดานความเร็วสูงกว่าปกติ',
      );
      const targets = await prisma.campaignRolloutTarget.findMany({
        where: { rolloutId },
      });
      const withValues = targets.find((t) => t.deviceId === s.device.deviceId);
      expect(withValues?.proposedFields).toEqual({ SPEED_LIMIT: 180 });
      expect(
        targets.find((t) => t.deviceId === s.other.deviceId)?.proposedFields,
      ).toBeNull();
      expect(await prisma.deviceConfigOverride.count()).toBe(0);
    });

    describe('field นอกชุดของรุ่นที่ template ใส่ไว้ (รีวิวพี่เลี้ยง 12 ต.ค.)', () => {
      /** field ที่ผูกกับรุ่นอื่นเท่านั้น (VT300) ไม่ใช่ GT06N ที่ Config นี้ใช้ */
      async function seedOutsideModelScenario(inTemplate: boolean) {
        const s = await seedScenario();
        await prisma.configFieldDefinition.create({
          data: {
            fieldName: 'OUTSIDE_FIELD',
            dataType: 'string',
            allowedValues: [],
            sensitive: false,
            supportedModels: {
              create: [{ deviceModel: 'VT300', protocol: 'TCP' }],
            },
          },
        });
        const config = await prisma.config.update({
          where: { id: s.config.id },
          data: {
            fields: inTemplate
              ? { APN: 'internet', OUTSIDE_FIELD: 'default' }
              : { APN: 'internet' },
          },
        });
        return { ...s, config };
      }

      it('field อยู่ใน template ของ Config -> ตั้งค่าเฉพาะเครื่องได้ (201)', async () => {
        const s = await seedOutsideModelScenario(true);

        await createWithValues(
          s.campaign.id,
          tokenFor(s.creator.id, 'Operation'),
          {
            payloadType: 'Config',
            configId: s.config.id,
            deviceValues: [
              {
                deviceId: s.device.deviceId,
                fields: { OUTSIDE_FIELD: 'custom' },
              },
            ],
            deviceValuesReason: 'ลูกค้าใช้ค่านอกชุดของรุ่น',
          },
        ).expect(201);
      });

      it('field ไม่อยู่ใน template -> 400 (เพิ่ม field นอกชุดเองไม่ได้)', async () => {
        const s = await seedOutsideModelScenario(false);

        await createWithValues(
          s.campaign.id,
          tokenFor(s.creator.id, 'Operation'),
          {
            payloadType: 'Config',
            configId: s.config.id,
            deviceValues: [
              {
                deviceId: s.device.deviceId,
                fields: { OUTSIDE_FIELD: 'custom' },
              },
            ],
            deviceValuesReason: 'x',
          },
        ).expect(400);
        expect(await prisma.campaignRollout.count()).toBe(0);
      });
    });

    it('field ที่ไม่รู้จักหรือชนิดผิด -> 400 ไม่สร้าง Rollout', async () => {
      const s = await seedScenario();

      await createWithValues(
        s.campaign.id,
        tokenFor(s.creator.id, 'Operation'),
        {
          payloadType: 'Config',
          configId: s.config.id,
          deviceValues: [
            {
              deviceId: s.device.deviceId,
              fields: { SPEED_LIMIT: 'เร็ว', NO_SUCH_FIELD: 1 },
            },
          ],
          deviceValuesReason: 'x',
        },
      ).expect(400);

      expect(await prisma.campaignRollout.count()).toBe(0);
    });

    it('มี deviceValues แต่ไม่กรอกเหตุผล -> 400', async () => {
      const s = await seedScenario();

      await createWithValues(
        s.campaign.id,
        tokenFor(s.creator.id, 'Operation'),
        {
          payloadType: 'Config',
          configId: s.config.id,
          deviceValues: [
            { deviceId: s.device.deviceId, fields: { SPEED_LIMIT: 180 } },
          ],
        },
      ).expect(400);
    });

    it('เครื่องที่ช่างมีคำขอ override รออนุมัติของ Config นี้ -> 409', async () => {
      const s = await seedScenario();
      const st = await makeUser(prisma, { role: 'ST' });
      await prisma.deviceConfigOverride.create({
        data: {
          deviceId: s.device.deviceId,
          configId: s.config.id,
          versionNumber: 1,
          fields: { SPEED_LIMIT: 150 },
          reason: 'ช่างขอ',
          status: 'pending',
          overriddenBy: st.id,
        },
      });

      await createWithValues(
        s.campaign.id,
        tokenFor(s.creator.id, 'Operation'),
        {
          payloadType: 'Config',
          configId: s.config.id,
          deviceValues: [
            { deviceId: s.device.deviceId, fields: { SPEED_LIMIT: 180 } },
          ],
          deviceValuesReason: 'x',
        },
      ).expect(409);
      expect(await prisma.campaignRollout.count()).toBe(0);
    });

    it('อนุมัติแล้วปล่อย -> บันทึก DeviceConfigOverride approved ต่อเครื่อง (รวมค่า approved เดิม) และอนุมัติไม่ได้สร้างอะไรก่อนปล่อย', async () => {
      const s = await seedScenario();
      // ค่า approved เดิมของ (เครื่อง, Config นี้) version 3
      await prisma.deviceConfigOverride.create({
        data: {
          deviceId: s.device.deviceId,
          configId: s.config.id,
          versionNumber: 3,
          fields: { COMMAND_PASSWORD: 'old-secret' },
          reason: 'เดิม',
          status: 'approved',
          overriddenBy: s.creator.id,
          decidedBy: s.approver.id,
          decidedAt: new Date(),
        },
      });
      const res = await createWithValues(
        s.campaign.id,
        tokenFor(s.creator.id, 'Operation'),
        {
          payloadType: 'Config',
          configId: s.config.id,
          deviceValues: [
            { deviceId: s.device.deviceId, fields: { SPEED_LIMIT: 180 } },
          ],
          deviceValuesReason: 'ลูกค้าขอเพดานความเร็วสูงกว่าปกติ',
        },
      ).expect(201);
      const rolloutId = (res.body as { id: string }).id;
      const base = `/api/v1/campaigns/${s.campaign.id}/rollouts/${rolloutId}`;
      const approverToken = tokenFor(s.approver.id, 'Operation');

      await request(app.getHttpServer())
        .post(`${base}/approve`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);
      // อนุมัติแล้วแต่ยังไม่ปล่อย: ยังไม่มี override ใหม่
      expect(await prisma.deviceConfigOverride.count()).toBe(1);

      await request(app.getHttpServer())
        .post(`${base}/release`)
        .set('Authorization', `Bearer ${approverToken}`)
        .expect(200);

      const rows = await prisma.deviceConfigOverride.findMany({
        where: { deviceId: s.device.deviceId },
        orderBy: { versionNumber: 'asc' },
      });
      expect(rows).toHaveLength(2);
      const created = rows[1];
      expect(created.versionNumber).toBe(4);
      expect(created.status).toBe('approved');
      expect(created.fields).toEqual({
        COMMAND_PASSWORD: 'old-secret',
        SPEED_LIMIT: 180,
      });
      expect(created.reason).toBe('ลูกค้าขอเพดานความเร็วสูงกว่าปกติ');
      expect(created.overriddenBy).toBe(s.creator.id);
      expect(created.decidedBy).toBe(s.approver.id);
      // เครื่องที่ไม่มีค่าเฉพาะเครื่องไม่มี override
      expect(
        await prisma.deviceConfigOverride.count({
          where: { deviceId: s.other.deviceId },
        }),
      ).toBe(0);
    });

    it('GET device-values: คืนค่าพิเศษเดิมที่ใช้ต่อได้ และธงคำขอของช่างที่ค้าง', async () => {
      const s = await seedScenario();
      const st = await makeUser(prisma, { role: 'ST' });
      const oldConfig = await seedApprovedConfig();
      await prisma.deviceConfigOverride.create({
        data: {
          deviceId: s.device.deviceId,
          configId: oldConfig.id,
          versionNumber: 1,
          fields: { SPEED_LIMIT: 180, GHOST_FIELD: 1 },
          reason: 'เดิม',
          status: 'approved',
          overriddenBy: st.id,
          decidedBy: s.approver.id,
          decidedAt: new Date(),
        },
      });
      await prisma.deviceConfigOverride.create({
        data: {
          deviceId: s.other.deviceId,
          configId: s.config.id,
          versionNumber: 1,
          fields: { SPEED_LIMIT: 150 },
          reason: 'ช่างขอ',
          status: 'pending',
          overriddenBy: st.id,
        },
      });

      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/campaigns/${s.campaign.id}/rollouts/device-values?configId=${s.config.id}`,
        )
        .set('Authorization', `Bearer ${tokenFor(s.creator.id, 'Operation')}`)
        .expect(200);

      const items = res.body as {
        deviceId: string;
        hasPendingRequest: boolean;
        previous: {
          fields: Record<string, unknown>;
          dropped: { fieldName: string }[];
          fromConfigId: string;
        } | null;
      }[];
      const first = items.find((i) => i.deviceId === s.device.deviceId);
      expect(first?.hasPendingRequest).toBe(false);
      expect(first?.previous?.fields).toEqual({ SPEED_LIMIT: 180 });
      expect(first?.previous?.dropped.map((d) => d.fieldName)).toEqual([
        'GHOST_FIELD',
      ]);
      expect(first?.previous?.fromConfigId).toBe(oldConfig.id);
      const second = items.find((i) => i.deviceId === s.other.deviceId);
      expect(second).toMatchObject({ hasPendingRequest: true, previous: null });
    });

    it('GET device-values: role ที่ไม่มีสิทธิ์ Create (Auditor) -> 403', async () => {
      const s = await seedScenario();
      const auditor = await makeUser(prisma, { role: 'Auditor' });
      await grant('Auditor', ActionType.Read);

      await request(app.getHttpServer())
        .get(
          `/api/v1/campaigns/${s.campaign.id}/rollouts/device-values?configId=${s.config.id}`,
        )
        .set('Authorization', `Bearer ${tokenFor(auditor.id, 'Auditor')}`)
        .expect(403);
    });

    it('GET targets: Operation เห็นค่า sensitive จริง role อื่นเห็น mask', async () => {
      const s = await seedScenario();
      const auditor = await makeUser(prisma, { role: 'Auditor' });
      await grant('Auditor', ActionType.Read);
      const res = await createWithValues(
        s.campaign.id,
        tokenFor(s.creator.id, 'Operation'),
        {
          payloadType: 'Config',
          configId: s.config.id,
          deviceValues: [
            {
              deviceId: s.device.deviceId,
              fields: { SPEED_LIMIT: 180, COMMAND_PASSWORD: 'new-secret' },
            },
          ],
          deviceValuesReason: 'x',
        },
      ).expect(201);
      const url = `/api/v1/campaigns/${s.campaign.id}/rollouts/${
        (res.body as { id: string }).id
      }/targets`;
      type Row = {
        deviceId: string;
        proposedFields: Record<string, unknown> | null;
      };

      const asOperation = await request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${tokenFor(s.creator.id, 'Operation')}`)
        .expect(200);
      const asAuditor = await request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${tokenFor(auditor.id, 'Auditor')}`)
        .expect(200);

      const pick = (rows: Row[]) =>
        rows.find((r) => r.deviceId === s.device.deviceId)?.proposedFields;
      expect(pick(asOperation.body as Row[])).toEqual({
        SPEED_LIMIT: 180,
        COMMAND_PASSWORD: 'new-secret',
      });
      expect(pick(asAuditor.body as Row[])).toEqual({
        SPEED_LIMIT: 180,
        COMMAND_PASSWORD: '********',
      });
    });
  });
});
