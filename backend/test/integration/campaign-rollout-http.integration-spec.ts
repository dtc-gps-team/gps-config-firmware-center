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

    it('2 request approve/reject พร้อมกันบน rollout เดียวกัน -> ผ่านได้แค่ 1 อีกอันได้ 409 (race condition)', async () => {
      const creator = await makeUser(prisma, { role: 'Operation' });
      const campaign = await seedGroup(creator.id, []);
      const rollout = await seedPendingRollout(campaign.id, creator.id);
      const approver1 = await makeUser(prisma, { role: 'Operation' });
      const approver2 = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve);

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post(
            `/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/approve`,
          )
          .set(
            'Authorization',
            `Bearer ${tokenFor(approver1.id, 'Operation')}`,
          ),
        request(app.getHttpServer())
          .post(
            `/api/v1/campaigns/${campaign.id}/rollouts/${rollout.id}/reject`,
          )
          .set(
            'Authorization',
            `Bearer ${tokenFor(approver2.id, 'Operation')}`,
          ),
      ]);

      const statuses = [res1.status, res2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);

      // ผลลัพธ์สุดท้ายใน DB ต้องตรงกับคำขอที่ชนะจริง ไม่ใช่ทั้งคู่ผสมกัน
      const final = await prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rollout.id },
      });
      expect(['approved', 'rejected']).toContain(final.status);
      const winner = res1.status === 200 ? 'approved' : 'rejected';
      expect(final.status).toBe(winner);
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
});
