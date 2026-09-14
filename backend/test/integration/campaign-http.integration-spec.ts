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
  RoleCode,
  TEST_DATABASE_URL,
} from './setup';

// PrismaService (ผ่าน PrismaModule) อ่าน DATABASE_URL จาก env ตรงๆ — override ให้ชี้
// ไปที่ DB _test เดียวกับที่ integration test อื่นใช้ (pattern เดียวกับ
// config-http.integration-spec.ts / task-http.integration-spec.ts)
process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * Campaign Wizard (#21) — `POST/GET /campaigns` ผ่าน HTTP จริง (JwtAuthGuard ->
 * PermissionGuard เต็มเส้นทาง) + ยืนยันว่า CampaignTarget ถูกสร้างจริงใน DB
 * ครบทุกแถว ไม่ใช่แค่ response body หน้าเดียว
 *
 * **แก้ไข 2026-09-14 (1):** เดิมเทสนี้ยังยืนยันว่า `POST /campaigns` สร้าง
 * `Task` ต่อเครื่องพร้อมแจ้งเตือนผู้รับผิดชอบด้วย (`assignedTo` ต่อ target) —
 * หัวหน้าแก้ scope ว่า Campaign ไม่มอบหมายงานให้ช่างหน้างานอีกต่อไป จึงตัด
 * NotificationModule override และ target.assignedTo ออกจากทุกเทสในไฟล์นี้
 *
 * **แก้ไข 2026-09-14 (2):** เพิ่มเทส `payloadType: Firmware` (Sprint 3 #23/
 * PR #151 implement เสร็จแล้ว) แทนที่เทสเดิมที่ยืนยันว่า Firmware ยัง 400
 */
describe('CampaignController (integration — real postgres + guard chain)', () => {
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
    // RolePermission ต้อง clean เองทุกเทส (resetDb ไม่แตะ — pattern เดียวกับ
    // config-http.integration-spec.ts)
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

  async function seedStoredFirmware(overrides?: {
    deviceModelCompatibility?: string[];
    uploadStatus?: 'pending' | 'stored' | 'failed';
  }) {
    const swUser = await makeUser(prisma, { role: 'SW' });
    return prisma.firmware.create({
      data: {
        version: `1.0.${Math.floor(Math.random() * 1000)}`,
        deviceModelCompatibility: overrides?.deviceModelCompatibility ?? [
          'GT06N',
        ],
        uploadStatus: overrides?.uploadStatus ?? 'stored',
        objectKey: `firmware/${randomUUID()}/test.bin`,
        originalFilename: 'test.bin',
        fileSizeBytes: 1024,
        uploadedBy: swUser.id,
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

    it('Operation มีสิทธิ์ campaign.Create, เป้าหมายครบถ้วน -> 201 + สร้าง CampaignTarget จริงใน DB (ไม่มี Task)', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const deviceA = await seedInstalledDevice();
      const deviceB = await seedInstalledDevice();
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: config.id,
          targets: [
            { deviceId: deviceA.deviceId },
            { deviceId: deviceB.deviceId },
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

      // Campaign ไม่มอบหมายงานให้ช่างหน้างานแล้ว (แก้ไข 2026-09-14) — ต้องไม่
      // มี Task ใดถูกสร้างขึ้นจาก Campaign นี้เลย
      const tasks = await prisma.task.findMany({
        where: { campaignId: body.id },
      });
      expect(tasks).toHaveLength(0);
    });

    it('สำเร็จ -> เขียน AuditLog action create (module campaign)', async () => {
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
          targets: [{ deviceId: device.deviceId }],
        })
        .expect(201);

      const logs = await prisma.auditLog.findMany({
        where: { userId: opUser.id, auditModule: 'campaign' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('create');
    });

    it('payloadType Firmware, เป้าหมายครบถ้วน -> 201 + configId เป็น null, firmwareId ตรงกับที่เลือก', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const firmware = await seedStoredFirmware();
      const device = await seedInstalledDevice();
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญอัปเดตเฟิร์มแวร์',
          payloadType: 'Firmware',
          firmwareId: firmware.id,
          targets: [{ deviceId: device.deviceId }],
        })
        .expect(201);

      const body = res.body as {
        payloadType: string;
        configId: string | null;
        firmwareId: string | null;
      };
      expect(body.payloadType).toBe('Firmware');
      expect(body.configId).toBeNull();
      expect(body.firmwareId).toBe(firmware.id);
    });

    it('payloadType Firmware, ไม่ส่ง firmwareId -> 400', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const device = await seedInstalledDevice();
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Firmware',
          targets: [{ deviceId: device.deviceId }],
        })
        .expect(400);
    });

    it('payloadType Firmware, ไม่พบ Firmware -> 404', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const device = await seedInstalledDevice();
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Firmware',
          firmwareId: randomUUID(),
          targets: [{ deviceId: device.deviceId }],
        })
        .expect(404);
    });

    it('payloadType Firmware, uploadStatus ยัง pending -> 409', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const firmware = await seedStoredFirmware({ uploadStatus: 'pending' });
      const device = await seedInstalledDevice();
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Firmware',
          firmwareId: firmware.id,
          targets: [{ deviceId: device.deviceId }],
        })
        .expect(409);
    });

    it('payloadType Firmware, deviceModel ของ Device ไม่อยู่ใน deviceModelCompatibility -> 409', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const firmware = await seedStoredFirmware({
        deviceModelCompatibility: ['GT06N'],
      });
      const device = await seedInstalledDevice({ deviceModel: 'GT06L' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Firmware',
          firmwareId: firmware.id,
          targets: [{ deviceId: device.deviceId }],
        })
        .expect(409);
    });

    it('ไม่พบ Config -> 404', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const device = await seedInstalledDevice();
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: randomUUID(),
          targets: [{ deviceId: device.deviceId }],
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
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: draftConfig.id,
          targets: [{ deviceId: device.deviceId }],
        })
        .expect(409);
    });

    it('Device ยังไม่ installed -> 409, ไม่มี CampaignTarget ถูกสร้าง', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Create);
      const config = await seedApprovedConfig();
      const device = await seedInstalledDevice({ status: 'registered' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: config.id,
          targets: [{ deviceId: device.deviceId }],
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
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/campaigns')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'แคมเปญทดสอบ',
          payloadType: 'Config',
          configId: config.id,
          targets: [{ deviceId: device.deviceId }],
        })
        .expect(409);
    });

    it('มี deviceId ซ้ำกันในรายการเป้าหมาย -> 400', async () => {
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
          targets: [
            { deviceId: device.deviceId },
            { deviceId: device.deviceId },
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
