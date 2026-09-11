import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { CampaignModule } from '../../src/campaign/campaign.module';
import { NotificationService } from '../../src/notification/notification.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  createTestPrisma,
  getOrCreateRole,
  makeUser,
  resetDb,
  RoleCode,
  TEST_DATABASE_URL,
} from './setup';

// PrismaService (ผ่าน PrismaModule) อ่าน DATABASE_URL จาก env ตรงๆ — override ให้ชี้
// ไปที่ DB _test เดียวกับที่ integration test อื่นใช้ (pattern เดียวกับ
// config-http.integration-spec.ts / task-http.integration-spec.ts)
process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * Campaign Wizard (#21) — `POST/GET /campaigns` ผ่าน HTTP จริง (JwtAuthGuard ->
 * PermissionGuard เต็มเส้นทาง) + ยืนยันว่า CampaignTarget/Task ถูกสร้างจริงใน DB
 * ครบทุกแถว ไม่ใช่แค่ response body หน้าเดียว
 */
describe('CampaignController (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;
  let notificationSend: jest.Mock;

  beforeAll(async () => {
    notificationSend = jest.fn().mockResolvedValue(undefined);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      // CampaignModule -> NotificationModule -> NotificationService inject
      // @nestjs/config — forRoot เองเหมือน task-http spec
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        CampaignModule,
      ],
    })
      // เทสนี้เช็ค RBAC + validation ล้วน — ไม่ให้แจ้งเตือนจริงแตะ DB/FCM
      .overrideProvider(NotificationService)
      .useValue({ send: notificationSend })
      .compile();

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
    // RolePermission ต้อง clean เองทุกเทส (resetDb ไม่แตะ — pattern เดียวกับ
    // config-http.integration-spec.ts)
    await prisma.rolePermission.deleteMany();
    notificationSend.mockClear();
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
    const swUser = await makeUser(prisma, { role: 'SW' });
    return prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        deviceModel: overrides?.deviceModel ?? 'GT06N',
        protocol: overrides?.protocol ?? 'TCP',
        status: 'approved',
        fields: { APN: 'internet' },
        createdBy: swUser.id,
      },
    });
  }

  async function seedInstalledDevice(overrides?: {
    deviceModel?: string;
    protocol?: string;
    status?: 'registered' | 'installed' | 'decommissioned';
  }) {
    return prisma.device.create({
      data: {
        deviceId: `DEV-${randomUUID().slice(0, 8)}`,
        simNumber: `89660000${Math.floor(Math.random() * 1e8)}`,
        deviceModel: overrides?.deviceModel ?? 'GT06N',
        protocol: overrides?.protocol ?? 'TCP',
        status: overrides?.status ?? 'installed',
      },
    });
  }

  describe('POST /campaigns', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .send({ name: 'x', payloadType: 'Config', targets: [] })
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ campaign.Create (ST) -> 403', async () => {
      const stUser = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'x', payloadType: 'Config', targets: [] })
        .expect(403);
    });

    it('Operation มีสิทธิ์ campaign.Create, เป้าหมายครบถ้วน -> 201 + สร้าง CampaignTarget/Task จริงใน DB', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const deviceA = await seedInstalledDevice();
      const deviceB = await seedInstalledDevice();
      const tech1 = await makeUser(prisma, { role: 'ST' });
      const tech2 = await makeUser(prisma, { role: 'OT' });
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: config.id,
          targets: [
            { deviceId: deviceA.deviceId, assignedTo: tech1.id },
            { deviceId: deviceB.deviceId, assignedTo: tech2.id },
          ],
        })
        .expect(201);

      const body = res.body as {
        id: string;
        status: string;
        targetCount: number;
        createdBy: string;
      };
      expect(body.status).toBe('active');
      expect(body.targetCount).toBe(2);
      expect(body.createdBy).toBe(opUser.id);

      const targets = await prisma.campaignTarget.findMany({
        where: { campaignId: body.id },
      });
      expect(targets).toHaveLength(2);
      expect(targets.map((t) => t.deviceId).sort()).toEqual(
        [deviceA.deviceId, deviceB.deviceId].sort(),
      );

      const tasks = await prisma.task.findMany({
        where: { campaignId: body.id },
      });
      expect(tasks).toHaveLength(2);
      const task1 = tasks.find((t) => t.assignedTo === tech1.id);
      expect(task1).toMatchObject({
        deviceId: deviceA.deviceId,
        configId: config.id,
        status: 'pending',
      });

      expect(notificationSend).toHaveBeenCalledTimes(2);
    });

    it('สำเร็จ -> เขียน AuditLog action create (module campaign)', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice();
      const tech = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: config.id,
          targets: [{ deviceId: device.deviceId, assignedTo: tech.id }],
        })
        .expect(201);

      const logs = await prisma.auditLog.findMany({
        where: { userId: opUser.id, auditModule: 'campaign' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('create');
    });

    it('payloadType Firmware -> 400 ยังไม่รองรับ', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const device = await seedInstalledDevice();
      const tech = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Firmware',
          targets: [{ deviceId: device.deviceId, assignedTo: tech.id }],
        })
        .expect(400);
    });

    it('ไม่พบ Config -> 404', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const device = await seedInstalledDevice();
      const tech = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: randomUUID(),
          targets: [{ deviceId: device.deviceId, assignedTo: tech.id }],
        })
        .expect(404);
    });

    it('Config ยังไม่อนุมัติ (draft) -> 409', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const swUser = await makeUser(prisma, { role: 'SW' });
      const draftConfig = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          deviceModel: 'GT06N',
          protocol: 'TCP',
          status: 'draft',
          fields: { APN: 'internet' },
          createdBy: swUser.id,
        },
      });
      const device = await seedInstalledDevice();
      const tech = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: draftConfig.id,
          targets: [{ deviceId: device.deviceId, assignedTo: tech.id }],
        })
        .expect(409);
    });

    it('Device ยังไม่ installed -> 409, ไม่มี CampaignTarget/Task ถูกสร้าง', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice({ status: 'registered' });
      const tech = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: config.id,
          targets: [{ deviceId: device.deviceId, assignedTo: tech.id }],
        })
        .expect(409);

      expect(await prisma.campaign.count()).toBe(0);
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
      const tech = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: config.id,
          targets: [{ deviceId: device.deviceId, assignedTo: tech.id }],
        })
        .expect(409);
    });

    it('assignedTo ไม่พบ user -> 400', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice();
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: config.id,
          targets: [{ deviceId: device.deviceId, assignedTo: randomUUID() }],
        })
        .expect(400);
    });

    it('มี deviceId ซ้ำกันในรายการเป้าหมาย -> 400', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice();
      const tech1 = await makeUser(prisma, { role: 'ST' });
      const tech2 = await makeUser(prisma, { role: 'OT' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: config.id,
          targets: [
            { deviceId: device.deviceId, assignedTo: tech1.id },
            { deviceId: device.deviceId, assignedTo: tech2.id },
          ],
        })
        .expect(400);
    });

    it('targets ว่างเปล่า -> 400 (validation)', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: config.id,
          targets: [],
        })
        .expect(400);
    });
  });

  describe('GET /campaigns', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/campaigns').expect(401);
    });

    it('role มีสิทธิ์ campaign.Read (SW) -> 200 คืนรายการ', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Read);
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await prisma.campaign.create({
        data: {
          name: 'แคมเปญเก่า',
          payloadType: 'Config',
          status: 'active',
          createdBy: opUser.id,
        },
      });
      const token = tokenFor(swUser.id, 'SW');

      const res = await request(app.getHttpServer())
        .get('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
    });
  });

  describe('GET /campaigns/:id', () => {
    it('เจอ -> 200', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Read);
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const created = await prisma.campaign.create({
        data: {
          name: 'แคมเปญเก่า',
          payloadType: 'Config',
          status: 'active',
          createdBy: opUser.id,
        },
      });
      const token = tokenFor(swUser.id, 'SW');

      const res = await request(app.getHttpServer())
        .get(`/api/v1/campaigns/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((res.body as { id: string }).id).toBe(created.id);
    });

    it('ไม่เจอ -> 404', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Read);
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .get(`/api/v1/campaigns/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
