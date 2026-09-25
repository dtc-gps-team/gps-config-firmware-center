import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import {
  ActionType,
  DeviceLifecycleStatus,
  PrismaClient,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { DeviceModule } from '../../src/device/device.module';
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
 * Device — `POST /devices/:deviceId/test-connection` ผ่าน HTTP จริง
 * (JwtAuthGuard -> PermissionGuard เต็มเส้นทาง) — ไม่มี `GET /status` ในรอบนี้
 */
describe('DeviceController test-connection (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // DeviceModule มี provider ที่ inject @nestjs/config (DEVICE_CONNECTION_TESTER
      // useFactory) — ต้อง forRoot NestConfigModule เองเหมือน config-http spec
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        DeviceModule,
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
    // RolePermission ต้อง clean เอง (resetDb ไม่แตะ — ดู setup.ts)
    await prisma.rolePermission.deleteMany();
    // ConfigFieldDefinition เหมือนกัน (issue #223 — validateOverridableFields
    // ต้องมีนิยาม field ก่อน) mirror config-override-http.integration-spec.ts
    // — fieldName unique ทั้งระบบ กัน test ก่อนหน้าเหลือชื่อค้างชนกัน
    await prisma.configFieldDefinition.deleteMany();
  });

  function tokenFor(sub: string, role: string): string {
    return jwtService.sign({ sub, role });
  }

  async function grant(
    roleCode: RoleCode,
    action: ActionType,
    resource: string,
  ): Promise<void> {
    const role = await getOrCreateRole(prisma, roleCode);
    await prisma.rolePermission.create({
      data: { roleId: role.id, resource, action },
    });
  }

  async function makeDevice(
    deviceId: string,
    status: DeviceLifecycleStatus,
    deviceModel = 'GT06N',
  ): Promise<void> {
    const model = await getOrCreateDeviceModel(prisma, deviceModel);
    await prisma.device.create({
      data: {
        deviceId,
        simNumber: `sim-${deviceId}`,
        deviceModel,
        protocol: 'TCP',
        status,
        modelId: model.id,
      },
    });
  }

  async function makeConfig(
    status: 'draft' | 'approved' | 'synced',
    deviceModel = 'GT06N',
  ): Promise<string> {
    const user = await makeUser(prisma, { role: 'ConfigEngineer' });
    const config = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        deviceModel,
        protocol: 'TCP',
        status,
        fields: { APN: 'internet' },
        createdBy: user.id,
      },
    });
    return config.id;
  }

  async function makeFirmware(
    options: {
      uploadStatus?: 'pending' | 'stored' | 'failed';
      approvalStatus?: 'pending_review' | 'approved' | 'rejected';
      deviceModelCompatibility?: string[];
    } = {},
  ): Promise<string> {
    const uploader = await makeUser(prisma, { role: 'FirmwareEngineer' });
    const firmware = await prisma.firmware.create({
      data: {
        version: `fw-${randomUUID()}`,
        deviceModelCompatibility: options.deviceModelCompatibility ?? ['GT06N'],
        uploadStatus: options.uploadStatus ?? 'stored',
        approvalStatus: options.approvalStatus ?? 'approved',
        objectKey: `firmware/${randomUUID()}.bin`,
        originalFilename: 'fw.bin',
        fileSizeBytes: 1024,
        uploadedBy: uploader.id,
      },
    });
    return firmware.id;
  }

  it('ไม่ส่ง Authorization header -> 401', async () => {
    await makeDevice('DTC-401', 'installed');

    await request(app.getHttpServer())
      .post('/api/v1/devices/DTC-401/test-connection')
      .expect(401);
  });

  it('role ไม่มีสิทธิ์ device-connection-test.Read (ConfigEngineer) -> 403', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    // ConfigEngineer มีสิทธิ์อื่นเยอะ แต่ไม่มี device-connection-test
    await grant('ConfigEngineer', ActionType.Read, 'config-simulation');
    await makeDevice('DTC-403A', 'installed');
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .post('/api/v1/devices/DTC-403A/test-connection')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('role Auditor (ไม่มีสิทธิ์) -> 403', async () => {
    const auditorUser = await makeUser(prisma, { role: 'Auditor' });
    await grant('Auditor', ActionType.Read, 'devices');
    await makeDevice('DTC-403B', 'installed');
    const token = tokenFor(auditorUser.id, 'Auditor');

    await request(app.getHttpServer())
      .post('/api/v1/devices/DTC-403B/test-connection')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('deviceId ไม่พบ -> 404', async () => {
    const stUser = await makeUser(prisma, { role: 'ST' });
    await grant('ST', ActionType.Read, 'device-connection-test');
    const token = tokenFor(stUser.id, 'ST');

    await request(app.getHttpServer())
      .post('/api/v1/devices/DOES-NOT-EXIST/test-connection')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('Device สถานะ registered (ยังไม่ติดตั้ง) -> 409', async () => {
    const otUser = await makeUser(prisma, { role: 'OT' });
    await grant('OT', ActionType.Read, 'device-connection-test');
    await makeDevice('DTC-409R', 'registered');
    const token = tokenFor(otUser.id, 'OT');

    await request(app.getHttpServer())
      .post('/api/v1/devices/DTC-409R/test-connection')
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it('Device สถานะ decommissioned -> 409', async () => {
    const stUser = await makeUser(prisma, { role: 'ST' });
    await grant('ST', ActionType.Read, 'device-connection-test');
    await makeDevice('DTC-409D', 'decommissioned');
    const token = tokenFor(stUser.id, 'ST');

    await request(app.getHttpServer())
      .post('/api/v1/devices/DTC-409D/test-connection')
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it('ST + Device installed -> 200 passed:true + signalStrength', async () => {
    const stUser = await makeUser(prisma, { role: 'ST' });
    await grant('ST', ActionType.Read, 'device-connection-test');
    await makeDevice('DTC-200', 'installed');
    const token = tokenFor(stUser.id, 'ST');

    const res = await request(app.getHttpServer())
      .post('/api/v1/devices/DTC-200/test-connection')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      passed: boolean;
      signalStrength: number;
      details: string[];
      testedAt: string;
    };
    expect(body.passed).toBe(true);
    expect(typeof body.signalStrength).toBe('number');
    expect(body.signalStrength).toBe(-65);
    expect(body.details.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(body.testedAt))).toBe(false);
  });

  describe('POST /devices/:deviceId/apply-config', () => {
    async function stToken(): Promise<string> {
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'device-config-apply');
      return tokenFor(stUser.id, 'ST');
    }

    it('ไม่ส่ง Authorization -> 401', async () => {
      await makeDevice('AC-401', 'installed');
      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-401/apply-config')
        .send({ configId: '00000000-0000-0000-0000-000000000000' })
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ device-config-apply (ConfigEngineer) -> 403', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Read, 'config-simulation');
      await makeDevice('AC-403', 'installed');
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-403/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId: '00000000-0000-0000-0000-000000000000' })
        .expect(403);
    });

    it('configId ไม่ใช่ uuid -> 400', async () => {
      await makeDevice('AC-400', 'installed');
      const token = await stToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-400/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId: 'not-a-uuid' })
        .expect(400);
    });

    it('deviceId ไม่พบ -> 404', async () => {
      const token = await stToken();
      const configId = await makeConfig('approved');

      await request(app.getHttpServer())
        .post('/api/v1/devices/NOPE/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(404);
    });

    it('configId ไม่พบ -> 404', async () => {
      await makeDevice('AC-404C', 'installed');
      const token = await stToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-404C/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
        .expect(404);
    });

    it('Device ยัง registered -> 409', async () => {
      await makeDevice('AC-409D', 'registered');
      const token = await stToken();
      const configId = await makeConfig('approved');

      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-409D/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(409);
    });

    it('Config ยัง draft -> 409', async () => {
      await makeDevice('AC-409C', 'installed');
      const token = await stToken();
      const configId = await makeConfig('draft');

      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-409C/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(409);
    });

    it('Config คนละรุ่นกับ Device -> 409', async () => {
      await makeDevice('AC-409M', 'installed', 'GT06N');
      const token = await stToken();
      const configId = await makeConfig('approved', 'GT06L');

      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-409M/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(409);
    });

    it('ST + Device installed + Config approved -> 200 applied:true', async () => {
      await makeDevice('AC-200', 'installed');
      const token = await stToken();
      const configId = await makeConfig('approved');

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/AC-200/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(200);

      const body = res.body as {
        applied: boolean;
        details: string[];
        appliedAt: string;
      };
      expect(body.applied).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(body.appliedAt))).toBe(false);
    });

    it('ST + apply สำเร็จ -> AuditLog แถวจริงใน DB มี metadata ครบ (deviceId/configId/fieldNames, issue #205)', async () => {
      await makeDevice('AC-205', 'installed');
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'device-config-apply');
      const token = tokenFor(stUser.id, 'ST');
      const configId = await makeConfig('approved');

      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-205/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(200);

      const log = await prisma.auditLog.findFirst({
        where: {
          userId: stUser.id,
          auditModule: 'device',
          action: 'apply-config',
        },
      });
      expect(log).not.toBeNull();
      expect(log?.metadata).toEqual({
        deviceId: 'AC-205',
        configId,
        fieldNames: ['APN'],
      });
    });

    it('Campaign Monitor (#22, แก้ไข 2026-09-24) — apply สำเร็จ + เครื่องอยู่ใน Rollout active ที่ payload ตรงกัน -> CampaignRolloutTarget เปลี่ยนเป็น success, Rollout.successCount เพิ่ม', async () => {
      await makeDevice('AC-CAMPAIGN-1', 'installed');
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'device-config-apply');
      const token = tokenFor(stUser.id, 'ST');
      const configId = await makeConfig('approved');
      const opUser = await makeUser(prisma, { role: 'Operation' });

      const campaign = await prisma.campaign.create({
        data: { name: 'กลุ่มทดสอบ Monitor', createdBy: opUser.id },
      });
      const rollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          configId,
          status: 'active',
          targetCount: 1,
          createdBy: opUser.id,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: { rolloutId: rollout.id, deviceId: 'AC-CAMPAIGN-1' },
      });

      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-CAMPAIGN-1/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(200);

      const reloadedTarget =
        await prisma.campaignRolloutTarget.findFirstOrThrow({
          where: { rolloutId: rollout.id, deviceId: 'AC-CAMPAIGN-1' },
        });
      expect(reloadedTarget.status).toBe('success');

      const reloadedRollout = await prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rollout.id },
      });
      expect(reloadedRollout.successCount).toBe(1);
      // ครบทุกเครื่องในรอบแล้ว (targetCount 1) -> ปิดรอบเป็น completed
      expect(reloadedRollout.status).toBe('completed');
    });

    it('Campaign Monitor race condition fix — 2 กลุ่มต่างกันมี Rollout active ใช้ configId เดียวกันพร้อมกัน -> ผลบันทึกเข้ากลุ่มที่อุปกรณ์เป็นสมาชิกจริงเท่านั้น ไม่ใช่กลุ่มแรกที่เจอ', async () => {
      await makeDevice('AC-CAMPAIGN-2', 'installed');
      await makeDevice('AC-CAMPAIGN-OTHER', 'installed');
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'device-config-apply');
      const token = tokenFor(stUser.id, 'ST');
      const configId = await makeConfig('approved');
      const opUser = await makeUser(prisma, { role: 'Operation' });

      // กลุ่ม A (สร้างก่อน — ถ้า query เดิมหยิบ rollout แรกที่เจอแบบไม่กรอง
      // สมาชิกจะได้ตัวนี้มาผิดๆ) มี rollout active ใช้ configId เดียวกัน แต่
      // AC-CAMPAIGN-2 ไม่ได้เป็นสมาชิกของกลุ่มนี้เลย
      const campaignA = await prisma.campaign.create({
        data: { name: 'กลุ่ม A (ไม่เกี่ยวข้อง)', createdBy: opUser.id },
      });
      const rolloutA = await prisma.campaignRollout.create({
        data: {
          campaignId: campaignA.id,
          payloadType: 'Config',
          configId,
          status: 'active',
          targetCount: 1,
          createdBy: opUser.id,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: { rolloutId: rolloutA.id, deviceId: 'AC-CAMPAIGN-OTHER' },
      });

      // กลุ่ม B — AC-CAMPAIGN-2 เป็นสมาชิกจริง ใช้ configId เดียวกัน active
      // เหมือนกัน
      const campaignB = await prisma.campaign.create({
        data: { name: 'กลุ่ม B (ถูกต้อง)', createdBy: opUser.id },
      });
      const rolloutB = await prisma.campaignRollout.create({
        data: {
          campaignId: campaignB.id,
          payloadType: 'Config',
          configId,
          status: 'active',
          targetCount: 1,
          createdBy: opUser.id,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: { rolloutId: rolloutB.id, deviceId: 'AC-CAMPAIGN-2' },
      });

      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-CAMPAIGN-2/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(200);

      // กลุ่ม B (ที่เครื่องเป็นสมาชิกจริง) ต้องถูกอัปเดตผล
      const targetB = await prisma.campaignRolloutTarget.findFirstOrThrow({
        where: { rolloutId: rolloutB.id, deviceId: 'AC-CAMPAIGN-2' },
      });
      expect(targetB.status).toBe('success');
      const reloadedRolloutB = await prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rolloutB.id },
      });
      expect(reloadedRolloutB.successCount).toBe(1);
      expect(reloadedRolloutB.status).toBe('completed');

      // กลุ่ม A (ไม่เกี่ยวข้อง) ต้องไม่ถูกแตะเลย
      const targetA = await prisma.campaignRolloutTarget.findFirstOrThrow({
        where: { rolloutId: rolloutA.id, deviceId: 'AC-CAMPAIGN-OTHER' },
      });
      expect(targetA.status).toBe('pending');
      const reloadedRolloutA = await prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rolloutA.id },
      });
      expect(reloadedRolloutA.successCount).toBe(0);
      expect(reloadedRolloutA.status).toBe('active');
    });

    it('มี DeviceConfigOverride สถานะ approved ของ Config เดียวกัน -> ใช้ค่าที่ override แล้วจริง ไม่ใช่ base เดิม (issue #223/#226)', async () => {
      await makeDevice('AC-OVERRIDE-APPROVED', 'installed');
      const token = await stToken();
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const stUser = await makeUser(prisma, { role: 'ST' });
      const config = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          deviceModel: 'GT06N',
          protocol: 'TCP',
          status: 'approved',
          // ค่า base เดิมถูกต้อง (บวก) — ถ้า apply-config ไม่ merge override เลย
          // ก็จะ applied: true อยู่ดี ต้อง merge จริงถึงจะเห็น applied: false
          fields: { APN: 'internet', RETRY_INTERVAL_SEC: 30 },
          createdBy: configEngineerUser.id,
        },
      });
      await prisma.deviceConfigOverride.create({
        data: {
          deviceId: 'AC-OVERRIDE-APPROVED',
          configId: config.id,
          versionNumber: 1,
          // override ค่าติดลบ — MockConfigApplier ต้อง reject ค่านี้ ถ้า merge
          // จริงตามที่ #226 ต้องการ
          fields: { RETRY_INTERVAL_SEC: -5 },
          reason: 'ทดสอบ override ที่ approved แล้ว',
          status: 'approved',
          overriddenBy: stUser.id,
          decidedBy: configEngineerUser.id,
          decidedAt: new Date(),
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/AC-OVERRIDE-APPROVED/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId: config.id })
        .expect(200);

      const body = res.body as { applied: boolean; details: string[] };
      expect(body.applied).toBe(false);
      expect(body.details.join(' ')).toContain('RETRY_INTERVAL_SEC');
    });

    it('มี DeviceConfigOverride สถานะ rejected ของ Config เดียวกัน -> ไม่ถูกนำมาใช้ ยังคง apply ค่า base เดิม (issue #223/#226)', async () => {
      await makeDevice('AC-OVERRIDE-REJECTED', 'installed');
      const token = await stToken();
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const stUser = await makeUser(prisma, { role: 'ST' });
      const config = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          deviceModel: 'GT06N',
          protocol: 'TCP',
          status: 'approved',
          fields: { APN: 'internet', RETRY_INTERVAL_SEC: 30 },
          createdBy: configEngineerUser.id,
        },
      });
      await prisma.deviceConfigOverride.create({
        data: {
          deviceId: 'AC-OVERRIDE-REJECTED',
          configId: config.id,
          versionNumber: 1,
          fields: { RETRY_INTERVAL_SEC: -5 },
          reason: 'ทดสอบ override ที่ถูกปฏิเสธ',
          status: 'rejected',
          overriddenBy: stUser.id,
          decidedBy: configEngineerUser.id,
          decidedAt: new Date(),
          rejectReason: 'ค่าไม่เหมาะสม',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/AC-OVERRIDE-REJECTED/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId: config.id })
        .expect(200);

      const body = res.body as { applied: boolean };
      expect(body.applied).toBe(true);
    });

    it('config ถูก soft-delete แล้ว -> 404 (issue #226)', async () => {
      await makeDevice('AC-SOFT-DELETED', 'installed');
      const token = await stToken();
      const configId = await makeConfig('approved');
      await prisma.config.update({
        where: { id: configId },
        data: { deletedAt: new Date() },
      });

      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-SOFT-DELETED/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(404);
    });
  });

  describe('POST /devices/:deviceId/confirm-firmware-install (issue #181)', () => {
    async function stToken(): Promise<string> {
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Create, 'device-firmware-confirm');
      return tokenFor(stUser.id, 'ST');
    }

    it('ไม่ส่ง Authorization -> 401', async () => {
      await makeDevice('CF-401', 'installed');
      await request(app.getHttpServer())
        .post('/api/v1/devices/CF-401/confirm-firmware-install')
        .send({ firmwareId: '00000000-0000-0000-0000-000000000000' })
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ device-firmware-confirm (ConfigEngineer) -> 403', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Read, 'config-simulation');
      await makeDevice('CF-403', 'installed');
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .post('/api/v1/devices/CF-403/confirm-firmware-install')
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareId: '00000000-0000-0000-0000-000000000000' })
        .expect(403);
    });

    it('firmwareId ไม่ใช่ uuid -> 400', async () => {
      await makeDevice('CF-400', 'installed');
      const token = await stToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices/CF-400/confirm-firmware-install')
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareId: 'not-a-uuid' })
        .expect(400);
    });

    it('deviceId ไม่พบ -> 404', async () => {
      const token = await stToken();
      const firmwareId = await makeFirmware();

      await request(app.getHttpServer())
        .post('/api/v1/devices/NOPE/confirm-firmware-install')
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareId })
        .expect(404);
    });

    it('firmwareId ไม่พบ -> 404', async () => {
      await makeDevice('CF-404F', 'installed');
      const token = await stToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices/CF-404F/confirm-firmware-install')
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
        .expect(404);
    });

    it('Device ยัง registered -> 409', async () => {
      await makeDevice('CF-409D', 'registered');
      const token = await stToken();
      const firmwareId = await makeFirmware();

      await request(app.getHttpServer())
        .post('/api/v1/devices/CF-409D/confirm-firmware-install')
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareId })
        .expect(409);
    });

    it('Firmware uploadStatus ยังไม่ stored -> 409', async () => {
      await makeDevice('CF-409U', 'installed');
      const token = await stToken();
      const firmwareId = await makeFirmware({ uploadStatus: 'pending' });

      await request(app.getHttpServer())
        .post('/api/v1/devices/CF-409U/confirm-firmware-install')
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareId })
        .expect(409);
    });

    it('Firmware approvalStatus ยังไม่ approved -> 409', async () => {
      await makeDevice('CF-409A', 'installed');
      const token = await stToken();
      const firmwareId = await makeFirmware({
        approvalStatus: 'pending_review',
      });

      await request(app.getHttpServer())
        .post('/api/v1/devices/CF-409A/confirm-firmware-install')
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareId })
        .expect(409);
    });

    it('Firmware คนละรุ่นกับ Device -> 409', async () => {
      await makeDevice('CF-409M', 'installed', 'GT06N');
      const token = await stToken();
      const firmwareId = await makeFirmware({
        deviceModelCompatibility: ['GT06L'],
      });

      await request(app.getHttpServer())
        .post('/api/v1/devices/CF-409M/confirm-firmware-install')
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareId })
        .expect(409);
    });

    it('ST + Device installed + Firmware stored/approved/รุ่นตรง -> 200 พร้อม deviceId/firmwareId/confirmedAt', async () => {
      await makeDevice('CF-200', 'installed');
      const token = await stToken();
      const firmwareId = await makeFirmware();

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/CF-200/confirm-firmware-install')
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareId })
        .expect(200);

      const body = res.body as {
        deviceId: string;
        firmwareId: string;
        confirmedAt: string;
      };
      expect(body.deviceId).toBe('CF-200');
      expect(body.firmwareId).toBe(firmwareId);
      expect(Number.isNaN(Date.parse(body.confirmedAt))).toBe(false);
    });

    it('ST + ยืนยันสำเร็จ -> AuditLog แถวจริงใน DB มี metadata ครบ (deviceId/firmwareId/firmwareVersion)', async () => {
      await makeDevice('CF-205', 'installed');
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Create, 'device-firmware-confirm');
      const token = tokenFor(stUser.id, 'ST');
      const uploader = await makeUser(prisma, { role: 'FirmwareEngineer' });
      const createdFirmware = await prisma.firmware.create({
        data: {
          version: 'GT06N-v9.9.9',
          deviceModelCompatibility: ['GT06N'],
          uploadStatus: 'stored',
          approvalStatus: 'approved',
          objectKey: `firmware/${randomUUID()}.bin`,
          originalFilename: 'fw.bin',
          fileSizeBytes: 1024,
          uploadedBy: uploader.id,
        },
      });

      await request(app.getHttpServer())
        .post('/api/v1/devices/CF-205/confirm-firmware-install')
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareId: createdFirmware.id })
        .expect(200);

      const log = await prisma.auditLog.findFirst({
        where: {
          userId: stUser.id,
          auditModule: 'device',
          action: 'confirm-firmware-install',
        },
      });
      expect(log).not.toBeNull();
      expect(log?.metadata).toEqual({
        deviceId: 'CF-205',
        firmwareId: createdFirmware.id,
        firmwareVersion: 'GT06N-v9.9.9',
      });
    });

    it('Campaign Monitor (#22, แก้ไข 2026-09-24) — ยืนยันสำเร็จ + เครื่องอยู่ใน Rollout active ที่ payload ตรงกัน -> CampaignRolloutTarget เปลี่ยนเป็น success, Rollout.successCount เพิ่ม', async () => {
      await makeDevice('CF-CAMPAIGN-1', 'installed');
      const token = await stToken();
      const firmwareId = await makeFirmware();
      const opUser = await makeUser(prisma, { role: 'Operation' });

      const campaign = await prisma.campaign.create({
        data: { name: 'กลุ่มทดสอบ Monitor', createdBy: opUser.id },
      });
      const rollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Firmware',
          firmwareId,
          status: 'active',
          targetCount: 1,
          createdBy: opUser.id,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: { rolloutId: rollout.id, deviceId: 'CF-CAMPAIGN-1' },
      });

      await request(app.getHttpServer())
        .post('/api/v1/devices/CF-CAMPAIGN-1/confirm-firmware-install')
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareId })
        .expect(200);

      const reloadedTarget =
        await prisma.campaignRolloutTarget.findFirstOrThrow({
          where: { rolloutId: rollout.id, deviceId: 'CF-CAMPAIGN-1' },
        });
      expect(reloadedTarget.status).toBe('success');

      const reloadedRollout = await prisma.campaignRollout.findUniqueOrThrow({
        where: { id: rollout.id },
      });
      expect(reloadedRollout.successCount).toBe(1);
      expect(reloadedRollout.status).toBe('completed');
    });
  });

  describe('POST /devices/:deviceId/simulate-config', () => {
    async function stToken(): Promise<string> {
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'device-connection-test');
      return tokenFor(stUser.id, 'ST');
    }

    it('ไม่ส่ง Authorization -> 401', async () => {
      await makeDevice('SC-401', 'installed');
      await request(app.getHttpServer())
        .post('/api/v1/devices/SC-401/simulate-config')
        .send({ configId: '00000000-0000-0000-0000-000000000000' })
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ device-connection-test (ConfigEngineer) -> 403', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Read, 'config-simulation');
      await makeDevice('SC-403', 'installed');
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .post('/api/v1/devices/SC-403/simulate-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId: '00000000-0000-0000-0000-000000000000' })
        .expect(403);
    });

    it('configId ไม่ใช่ uuid -> 400', async () => {
      await makeDevice('SC-400', 'installed');
      const token = await stToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices/SC-400/simulate-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId: 'not-a-uuid' })
        .expect(400);
    });

    it('deviceId ไม่พบ -> 404', async () => {
      const token = await stToken();
      const configId = await makeConfig('approved');

      await request(app.getHttpServer())
        .post('/api/v1/devices/NOPE/simulate-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(404);
    });

    it('configId ไม่พบ -> 404', async () => {
      await makeDevice('SC-404C', 'installed');
      const token = await stToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices/SC-404C/simulate-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
        .expect(404);
    });

    it('Device ยัง registered -> 409', async () => {
      await makeDevice('SC-409D', 'registered');
      const token = await stToken();
      const configId = await makeConfig('approved');

      await request(app.getHttpServer())
        .post('/api/v1/devices/SC-409D/simulate-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(409);
    });

    it('Config ยัง draft -> 409', async () => {
      await makeDevice('SC-409C', 'installed');
      const token = await stToken();
      const configId = await makeConfig('draft');

      await request(app.getHttpServer())
        .post('/api/v1/devices/SC-409C/simulate-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(409);
    });

    it('ST + installed + approved + รุ่นตรง -> 200 passed:true (3 check ครบ)', async () => {
      await makeDevice('SC-200', 'installed');
      const token = await stToken();
      const configId = await makeConfig('approved');

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/SC-200/simulate-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(200);

      const body = res.body as {
        passed: boolean;
        configCheck: { passed: boolean; details: string[] };
        compatibilityCheck: { passed: boolean; details: string[] };
        connectionCheck: { passed: boolean; signalStrength: number };
      };
      expect(body.passed).toBe(true);
      expect(body.configCheck.passed).toBe(true);
      expect(body.compatibilityCheck.passed).toBe(true);
      expect(body.connectionCheck.passed).toBe(true);
      expect(typeof body.connectionCheck.signalStrength).toBe('number');
    });

    it('Config คนละรุ่นกับ Device -> 200 passed:false, compatibilityCheck.passed:false (ไม่ใช่ 409)', async () => {
      await makeDevice('SC-200M', 'installed', 'GT06N');
      const token = await stToken();
      const configId = await makeConfig('approved', 'GT06L');

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/SC-200M/simulate-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(200);

      const body = res.body as {
        passed: boolean;
        compatibilityCheck: { passed: boolean };
        connectionCheck: { passed: boolean };
      };
      expect(body.passed).toBe(false);
      expect(body.compatibilityCheck.passed).toBe(false);
      expect(body.connectionCheck.passed).toBe(true);
    });

    it('มี DeviceConfigOverride สถานะ approved ของ Config เดียวกัน -> configCheck ตรวจค่าที่ override แล้ว ไม่ใช่ base เดิม (issue #223/#226)', async () => {
      await makeDevice('SC-OVERRIDE-APPROVED', 'installed');
      const token = await stToken();
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const stUser = await makeUser(prisma, { role: 'ST' });
      const config = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          deviceModel: 'GT06N',
          protocol: 'TCP',
          status: 'approved',
          fields: { APN: 'internet', RETRY_INTERVAL_SEC: 30 },
          createdBy: configEngineerUser.id,
        },
      });
      await prisma.deviceConfigOverride.create({
        data: {
          deviceId: 'SC-OVERRIDE-APPROVED',
          configId: config.id,
          versionNumber: 1,
          fields: { RETRY_INTERVAL_SEC: -5 },
          reason: 'ทดสอบ override ที่ approved แล้ว',
          status: 'approved',
          overriddenBy: stUser.id,
          decidedBy: configEngineerUser.id,
          decidedAt: new Date(),
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/SC-OVERRIDE-APPROVED/simulate-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId: config.id })
        .expect(200);

      const body = res.body as {
        passed: boolean;
        configCheck: { passed: boolean; details: string[] };
      };
      expect(body.configCheck.passed).toBe(false);
      expect(body.configCheck.details.join(' ')).toContain(
        'RETRY_INTERVAL_SEC',
      );
      expect(body.passed).toBe(false);
    });

    it('มี DeviceConfigOverride สถานะ rejected ของ Config เดียวกัน -> ไม่ถูกนำมาใช้ configCheck ยังผ่านด้วยค่า base เดิม (issue #223/#226)', async () => {
      await makeDevice('SC-OVERRIDE-REJECTED', 'installed');
      const token = await stToken();
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const stUser = await makeUser(prisma, { role: 'ST' });
      const config = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          deviceModel: 'GT06N',
          protocol: 'TCP',
          status: 'approved',
          fields: { APN: 'internet', RETRY_INTERVAL_SEC: 30 },
          createdBy: configEngineerUser.id,
        },
      });
      await prisma.deviceConfigOverride.create({
        data: {
          deviceId: 'SC-OVERRIDE-REJECTED',
          configId: config.id,
          versionNumber: 1,
          fields: { RETRY_INTERVAL_SEC: -5 },
          reason: 'ทดสอบ override ที่ถูกปฏิเสธ',
          status: 'rejected',
          overriddenBy: stUser.id,
          decidedBy: configEngineerUser.id,
          decidedAt: new Date(),
          rejectReason: 'ค่าไม่เหมาะสม',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/SC-OVERRIDE-REJECTED/simulate-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId: config.id })
        .expect(200);

      const body = res.body as { configCheck: { passed: boolean } };
      expect(body.configCheck.passed).toBe(true);
    });

    it('config ถูก soft-delete แล้ว -> 404 (issue #226)', async () => {
      await makeDevice('SC-SOFT-DELETED', 'installed');
      const token = await stToken();
      const configId = await makeConfig('approved');
      await prisma.config.update({
        where: { id: configId },
        data: { deletedAt: new Date() },
      });

      await request(app.getHttpServer())
        .post('/api/v1/devices/SC-SOFT-DELETED/simulate-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(404);
    });
  });

  describe('GET /devices (Device Search) + GET /devices/:deviceId (Detail)', () => {
    /** ทุก Role มี `devices` Read — ใช้ Auditor เป็นตัวแทน (role ที่ไม่มีสิทธิ์
     * อื่นในโมดูล device เลย) เพื่อยืนยันว่า grant `devices` อย่างเดียวพอ */
    async function auditorToken(): Promise<string> {
      const user = await makeUser(prisma, { role: 'Auditor' });
      await grant('Auditor', ActionType.Read, 'devices');
      return tokenFor(user.id, 'Auditor');
    }

    it('ไม่ส่ง Authorization -> 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/devices').expect(401);
    });

    it('role ไม่มี devices.Read -> 403', async () => {
      const user = await makeUser(prisma, { role: 'ConfigEngineer' });
      await grant('ConfigEngineer', ActionType.Read, 'config');
      const token = tokenFor(user.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .get('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('list ทั้งหมด เรียงตาม deviceId', async () => {
      await makeDevice('DL-0002', 'installed', 'GT06N');
      await makeDevice('DL-0001', 'registered', 'GT06L');
      const token = await auditorToken();

      const res = await request(app.getHttpServer())
        .get('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { deviceId: string }[];
      expect(body.map((d) => d.deviceId)).toEqual(['DL-0001', 'DL-0002']);
    });

    it('เครื่องที่ผูกลูกค้าไว้ -> คืน customer แบบย่อ (id+companyName) ใน list และ detail, เครื่องที่ไม่ผูก -> customer เป็น null (docs/12 เฟส B)', async () => {
      const customer = await prisma.customer.create({
        data: { companyName: `Cus-${randomUUID()}` },
      });
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');
      const linked = await prisma.device.create({
        data: {
          deviceId: `DC-LINKED-${randomUUID().slice(0, 8)}`,
          simNumber: `sim-${randomUUID()}`,
          deviceModel: 'GT06N',
          protocol: 'TCP',
          status: 'installed',
          customerId: customer.id,
          modelId: model.id,
        },
      });
      const unlinked = await prisma.device.create({
        data: {
          deviceId: `DC-UNLINKED-${randomUUID().slice(0, 8)}`,
          simNumber: `sim-${randomUUID()}`,
          deviceModel: 'GT06N',
          protocol: 'TCP',
          status: 'installed',
          modelId: model.id,
        },
      });
      const token = await auditorToken();

      const list = await request(app.getHttpServer())
        .get('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const listBody = list.body as {
        deviceId: string;
        customer: { id: string; companyName: string } | null;
      }[];
      expect(
        listBody.find((d) => d.deviceId === linked.deviceId)?.customer,
      ).toEqual({ id: customer.id, companyName: customer.companyName });
      expect(
        listBody.find((d) => d.deviceId === unlinked.deviceId)?.customer,
      ).toBeNull();

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/devices/${linked.deviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        (detail.body as { customer: { companyName: string } }).customer
          .companyName,
      ).toBe(customer.companyName);
    });

    it('filter status + deviceModel', async () => {
      await makeDevice('DF-A', 'installed', 'GT06N');
      await makeDevice('DF-B', 'registered', 'GT06N');
      await makeDevice('DF-C', 'installed', 'GT06L');
      const token = await auditorToken();

      const res = await request(app.getHttpServer())
        .get('/api/v1/devices?status=installed&deviceModel=GT06N')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { deviceId: string }[];
      expect(body.map((d) => d.deviceId)).toEqual(['DF-A']);
    });

    it('filter customerId -> คืนเฉพาะอุปกรณ์ของลูกค้านั้น ไม่รวมเครื่องที่ customerId ว่าง (issue #204)', async () => {
      const customerA = await prisma.customer.create({
        data: { companyName: `Cus-A-${randomUUID()}` },
      });
      const customerB = await prisma.customer.create({
        data: { companyName: `Cus-B-${randomUUID()}` },
      });
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');
      await prisma.device.create({
        data: {
          deviceId: 'CF-A1',
          simNumber: `sim-${randomUUID()}`,
          deviceModel: 'GT06N',
          protocol: 'TCP',
          status: 'installed',
          customerId: customerA.id,
          modelId: model.id,
        },
      });
      await prisma.device.create({
        data: {
          deviceId: 'CF-B1',
          simNumber: `sim-${randomUUID()}`,
          deviceModel: 'GT06N',
          protocol: 'TCP',
          status: 'installed',
          customerId: customerB.id,
          modelId: model.id,
        },
      });
      await makeDevice('CF-UNLINKED', 'installed');
      const token = await auditorToken();

      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices?customerId=${customerA.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { deviceId: string }[];
      expect(body.map((d) => d.deviceId)).toEqual(['CF-A1']);
    });

    it('customerId ไม่ใช่ uuid -> 400', async () => {
      const token = await auditorToken();

      await request(app.getHttpServer())
        .get('/api/v1/devices?customerId=not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('search match deviceId หรือ simNumber (contains)', async () => {
      await makeDevice('SRCH-9', 'installed');
      const token = await auditorToken();

      const byId = await request(app.getHttpServer())
        .get('/api/v1/devices?search=rch-9')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        (byId.body as { deviceId: string }[]).map((d) => d.deviceId),
      ).toEqual(['SRCH-9']);

      const bySim = await request(app.getHttpServer())
        .get('/api/v1/devices?search=sim-SRCH-9')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        (bySim.body as { deviceId: string }[]).map((d) => d.deviceId),
      ).toEqual(['SRCH-9']);
    });

    it('status ไม่อยู่ใน enum -> 400', async () => {
      const token = await auditorToken();

      await request(app.getHttpServer())
        .get('/api/v1/devices?status=broken')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('GET /devices/:deviceId เจอ -> 200 record เดียว', async () => {
      await makeDevice('DET-1', 'installed', 'GT06L');
      const token = await auditorToken();

      const res = await request(app.getHttpServer())
        .get('/api/v1/devices/DET-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { deviceId: string; deviceModel: string };
      expect(body.deviceId).toBe('DET-1');
      expect(body.deviceModel).toBe('GT06L');
    });

    it('GET /devices/:deviceId ไม่พบ -> 404', async () => {
      const token = await auditorToken();

      await request(app.getHttpServer())
        .get('/api/v1/devices/NOPE-404')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('GET /devices/:deviceId/config (Config Override Phase 2, Mobile — issue #211)', () => {
    async function stToken(): Promise<string> {
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'device-current-config');
      return tokenFor(stUser.id, 'ST');
    }

    async function makeCompletedTask(
      deviceId: string,
      configId: string,
      updatedAt?: Date,
    ): Promise<void> {
      const assignee = await makeUser(prisma, { role: 'ST' });
      const task = await prisma.task.create({
        data: {
          title: `ติดตั้ง Config — ${deviceId}`,
          assignedTo: assignee.id,
          deviceId,
          configId,
          status: 'completed',
        },
      });
      // `updatedAt` เป็น `@updatedAt` — set ทับตรงๆ ผ่าน `updateMany` (ข้าม
      // auto-touch) ให้ควบคุมลำดับ "ล่าสุด" ได้แน่นอนในเทส
      if (updatedAt) {
        await prisma.$executeRaw`UPDATE "Task" SET "updatedAt" = ${updatedAt} WHERE id = ${task.id}`;
      }
    }

    it('ไม่ส่ง Authorization -> 401', async () => {
      await makeDevice('CFG-401', 'installed');
      await request(app.getHttpServer())
        .get('/api/v1/devices/CFG-401/config')
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ device-current-config (ConfigEngineer) -> 403', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Read, 'config-simulation');
      await makeDevice('CFG-403', 'installed');
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .get('/api/v1/devices/CFG-403/config')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('deviceId ไม่พบ -> 404', async () => {
      const token = await stToken();

      await request(app.getHttpServer())
        .get('/api/v1/devices/NOPE/config')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('device มีอยู่ แต่ไม่มี Task completed ที่ผูก configId เลย -> 404', async () => {
      await makeDevice('CFG-404T', 'installed');
      const token = await stToken();

      await request(app.getHttpServer())
        .get('/api/v1/devices/CFG-404T/config')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('มี Task completed ผูก configId -> 200 คืน Config นั้น', async () => {
      await makeDevice('CFG-200', 'installed');
      const configId = await makeConfig('approved');
      await makeCompletedTask('CFG-200', configId);
      const token = await stToken();

      const res = await request(app.getHttpServer())
        .get('/api/v1/devices/CFG-200/config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { id: string; fields: Record<string, unknown> };
      expect(body.id).toBe(configId);
      expect(body.fields).toEqual({ APN: 'internet' });
    });

    it('มีหลาย Task completed -> คืน Config ของ Task ล่าสุด (updatedAt มากสุด)', async () => {
      await makeDevice('CFG-200L', 'installed');
      const olderConfigId = await makeConfig('approved');
      const newerConfigId = await makeConfig('approved');
      await makeCompletedTask(
        'CFG-200L',
        olderConfigId,
        new Date('2026-01-01T00:00:00.000Z'),
      );
      await makeCompletedTask(
        'CFG-200L',
        newerConfigId,
        new Date('2026-06-01T00:00:00.000Z'),
      );
      const token = await stToken();

      const res = await request(app.getHttpServer())
        .get('/api/v1/devices/CFG-200L/config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((res.body as { id: string }).id).toBe(newerConfigId);
    });

    it('Task ที่ผูก device นี้ยัง pending (ไม่ completed) -> ไม่นับ -> 404', async () => {
      await makeDevice('CFG-404P', 'installed');
      const configId = await makeConfig('approved');
      const assignee = await makeUser(prisma, { role: 'ST' });
      await prisma.task.create({
        data: {
          title: 'ติดตั้ง Config — ยังไม่เสร็จ',
          assignedTo: assignee.id,
          deviceId: 'CFG-404P',
          configId,
          status: 'pending',
        },
      });
      const token = await stToken();

      await request(app.getHttpServer())
        .get('/api/v1/devices/CFG-404P/config')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('Per-device Config Override — pending/approve/reject workflow (issue #223, มติ 2026-09-24 / PR #225)', () => {
    // grant สิทธิ์ให้ role ST/Operation เท่านั้น (ครั้งเดียวต่อเทส กัน unique
    // constraint ชนกันถ้าเรียก stToken()/opToken() มากกว่า 1 ครั้งในเทส
    // เดียว — RolePermission unique ที่ (roleId, resource, action)) reset ทุก
    // เทส (`beforeEach` นี้รันหลัง `beforeEach` นอกที่ล้าง RolePermission แล้ว
    // เสมอ — Jest รัน beforeEach จากนอกเข้าใน) ไม่งั้น flag ค้าง `true` ข้ามเทส
    // ทั้งที่ RolePermission ถูกล้างไปแล้วจริงในเทสถัดไป
    let stGranted = false;
    let opGranted = false;
    beforeEach(() => {
      stGranted = false;
      opGranted = false;
    });
    async function grantStOnce(): Promise<void> {
      if (stGranted) return;
      await grant('ST', ActionType.Override, 'device-config-override');
      // ต้องมี device-current-config Read ด้วย เพราะเทสหลายตัวเรียก
      // GET /devices/:deviceId/config ต่อจาก POST เพื่อยืนยันผล merge
      await grant('ST', ActionType.Read, 'device-current-config');
      stGranted = true;
    }

    async function grantOpOnce(): Promise<void> {
      if (opGranted) return;
      await grant('Operation', ActionType.Approve, 'device-config-override');
      await grant('Operation', ActionType.Read, 'device-config-override');
      opGranted = true;
    }

    async function stToken(): Promise<string> {
      await grantStOnce();
      const stUser = await makeUser(prisma, { role: 'ST' });
      return tokenFor(stUser.id, 'ST');
    }

    async function opToken(): Promise<string> {
      await grantOpOnce();
      const opUser = await makeUser(prisma, { role: 'Operation' });
      return tokenFor(opUser.id, 'Operation');
    }

    async function makeCompletedTask(
      deviceId: string,
      configId: string,
    ): Promise<void> {
      const assignee = await makeUser(prisma, { role: 'ST' });
      await prisma.task.create({
        data: {
          title: `ติดตั้ง Config — ${deviceId}`,
          assignedTo: assignee.id,
          deviceId,
          configId,
          status: 'completed',
        },
      });
    }

    async function makeOverridableField(
      fieldName: string,
      overridable: boolean,
      deviceModel = 'GT06N',
    ): Promise<void> {
      // fieldName unique ทั้งระบบ — เทสบางตัวเรียก setupPending() มากกว่า 1
      // ครั้งในเทสเดียว (เช่น list test ที่สร้าง 2 คำขอ) ซึ่งแต่ละครั้งเรียก
      // makeOverridableField('APN', ...) ซ้ำ ข้ามถ้ามีอยู่แล้วแทนที่จะชน
      // unique constraint
      const existing = await prisma.configFieldDefinition.findUnique({
        where: { fieldName },
      });
      if (existing) return;
      await prisma.configFieldDefinition.create({
        data: {
          fieldName,
          dataType: 'string',
          allowedValues: [],
          required: false,
          stOverridable: overridable,
          supportedModels: {
            create: [{ deviceModel, protocol: 'TCP' }],
          },
        },
      });
    }

    it('ไม่ส่ง Authorization -> 401', async () => {
      await makeDevice('DCO-401', 'installed');
      await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-401/config-override')
        .send({ fields: {}, reason: 'x' })
        .expect(401);
    });

    it('role OT (ไม่มี grant device-config-override เลย — mirror config-override เดิม) -> 403', async () => {
      const otUser = await makeUser(prisma, { role: 'OT' });
      await makeDevice('DCO-403A', 'installed');
      const configId = await makeConfig('approved');
      await makeCompletedTask('DCO-403A', configId);
      await makeOverridableField('APN', true);

      await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-403A/config-override')
        .set('Authorization', `Bearer ${tokenFor(otUser.id, 'OT')}`)
        .send({ fields: { APN: 'new-apn' }, reason: 'ทดสอบ' })
        .expect(403);
    });

    it('role ConfigEngineer (ไม่มีสิทธิ์) -> 403', async () => {
      const ceUser = await makeUser(prisma, { role: 'ConfigEngineer' });
      await grant('ConfigEngineer', ActionType.Read, 'config-simulation');
      await makeDevice('DCO-403B', 'installed');

      await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-403B/config-override')
        .set('Authorization', `Bearer ${tokenFor(ceUser.id, 'ConfigEngineer')}`)
        .send({ fields: { APN: 'new-apn' }, reason: 'ทดสอบ' })
        .expect(403);
    });

    it('deviceId ไม่พบ -> 404', async () => {
      const token = await stToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices/NOPE/config-override')
        .set('Authorization', `Bearer ${token}`)
        .send({ fields: {}, reason: 'ทดสอบ' })
        .expect(404);
    });

    it('อุปกรณ์ยังไม่เคย Confirm Install (ไม่มี Task completed ที่ผูก configId) -> 404 ข้อความเดียวกับ GET', async () => {
      await makeDevice('DCO-404', 'installed');
      const token = await stToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-404/config-override')
        .set('Authorization', `Bearer ${token}`)
        .send({ fields: {}, reason: 'ทดสอบ' })
        .expect(404);
    });

    it('field stOverridable:false -> 400 ไม่สร้างแถวใน DB (reuse validateOverridableFields)', async () => {
      await makeDevice('DCO-400', 'installed');
      const configId = await makeConfig('approved');
      await makeCompletedTask('DCO-400', configId);
      await makeOverridableField('COMMAND_PASSWORD', false);
      const token = await stToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-400/config-override')
        .set('Authorization', `Bearer ${token}`)
        .send({ fields: { COMMAND_PASSWORD: 'x' }, reason: 'ทดสอบ' })
        .expect(400);

      const overrides = await prisma.deviceConfigOverride.findMany({
        where: { deviceId: 'DCO-400' },
      });
      expect(overrides).toHaveLength(0);
    });

    it('ไม่ส่ง reason -> 400', async () => {
      await makeDevice('DCO-400R', 'installed');
      const configId = await makeConfig('approved');
      await makeCompletedTask('DCO-400R', configId);
      await makeOverridableField('APN', true);
      const token = await stToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-400R/config-override')
        .set('Authorization', `Bearer ${token}`)
        .send({ fields: { APN: 'new-apn' } })
        .expect(400);
    });

    it('ST + field stOverridable:true -> 200 · สร้างคำขอ status pending, AuditLog device-config-override-request, ไม่กระทบ Config เดิม', async () => {
      await makeDevice('DCO-200', 'installed');
      const configId = await makeConfig('approved');
      await makeCompletedTask('DCO-200', configId);
      await makeOverridableField('APN', true);
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Override, 'device-config-override');
      // ต้องมี device-current-config Read ด้วย — เทสนี้เรียก GET /config ต่อ
      // ท้ายเพื่อยืนยันว่ายังไม่ merge (คำขอนี้ยัง pending)
      await grant('ST', ActionType.Read, 'device-current-config');
      const token = tokenFor(stUser.id, 'ST');

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-200/config-override')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fields: { APN: 'new-apn' },
          reason: 'ลูกค้าขอเปลี่ยนค่าหน้างาน',
        })
        .expect(200);

      const body = res.body as {
        status: string;
        fields: Record<string, unknown>;
      };
      expect(body.status).toBe('pending');
      expect(body.fields).toEqual({ APN: 'new-apn' });

      // Config ต้นทาง (ใช้ร่วมกันทั้งระบบ) ต้อง**ไม่ถูกแตะ** — ต่างจาก
      // POST /config/{configId}/override เดิมที่แก้ Config.fields ตรงๆ
      const untouchedConfig = await prisma.config.findUnique({
        where: { id: configId },
      });
      expect(untouchedConfig?.fields).toEqual({ APN: 'internet' });

      const overrides = await prisma.deviceConfigOverride.findMany({
        where: { deviceId: 'DCO-200' },
      });
      expect(overrides).toHaveLength(1);
      expect(overrides[0]).toMatchObject({
        versionNumber: 1,
        configId,
        overriddenBy: stUser.id,
        reason: 'ลูกค้าขอเปลี่ยนค่าหน้างาน',
        fields: { APN: 'new-apn' },
        status: 'pending',
      });

      const audit = await prisma.auditLog.findMany({
        where: {
          auditModule: 'device',
          action: 'device-config-override-request',
        },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].userId).toBe(stUser.id);
      expect(audit[0].metadata).toEqual({
        deviceId: 'DCO-200',
        configId,
        fieldNames: ['APN'],
      });

      // ยังไม่อนุมัติ -> GET /config ต้องยังไม่ merge แต่เห็น pendingOverride
      const getRes = await request(app.getHttpServer())
        .get('/api/v1/devices/DCO-200/config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const getBody = getRes.body as {
        fields: Record<string, unknown>;
        hasDeviceOverride: boolean;
        pendingOverride: { id: string; status: string } | null;
      };
      expect(getBody.hasDeviceOverride).toBe(false);
      expect(getBody.fields).toEqual({ APN: 'internet' });
      expect(getBody.pendingOverride?.status).toBe('pending');
    });

    it('เครื่องเดียวกันมีคำขอ pending อยู่แล้ว -> ส่งคำขอใหม่ 409 (ไม่ต้องรอ Operation ตัดสินใจก่อน)', async () => {
      await makeDevice('DCO-409', 'installed');
      const configId = await makeConfig('approved');
      await makeCompletedTask('DCO-409', configId);
      await makeOverridableField('APN', true);
      const token = await stToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-409/config-override')
        .set('Authorization', `Bearer ${token}`)
        .send({ fields: { APN: 'new-apn' }, reason: 'รอบแรก' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-409/config-override')
        .set('Authorization', `Bearer ${token}`)
        .send({ fields: { APN: 'another-apn' }, reason: 'รอบสอง' })
        .expect(409);

      const overrides = await prisma.deviceConfigOverride.findMany({
        where: { deviceId: 'DCO-409' },
      });
      expect(overrides).toHaveLength(1);
    });

    it('ผ่านทั้งวงจร: submit -> Operation approve -> submit รอบสองสะสมค่าจากรอบแรก -> approve -> GET merge เห็นค่าล่าสุด', async () => {
      await makeDevice('DCO-FLOW', 'installed');
      const configId = await makeConfig('approved');
      await makeCompletedTask('DCO-FLOW', configId);
      await makeOverridableField('APN', true);
      await makeOverridableField('REPORT_INTERVAL_MOVING', true);
      const stTok = await stToken();
      const opTok = await opToken();

      const res1 = await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-FLOW/config-override')
        .set('Authorization', `Bearer ${stTok}`)
        .send({ fields: { APN: 'new-apn' }, reason: 'รอบแรก' })
        .expect(200);
      const override1 = res1.body as { id: string };

      await request(app.getHttpServer())
        .post(`/api/v1/device-config-overrides/${override1.id}/approve`)
        .set('Authorization', `Bearer ${opTok}`)
        .expect(200);

      // อนุมัติแล้ว แต่ยังไม่ apply-config เข้าเครื่อง (แยก PR ถัดไป) —
      // GET /config ต้อง merge ค่า approved ทันทีไม่ต้องรอ apply
      const getRes1 = await request(app.getHttpServer())
        .get('/api/v1/devices/DCO-FLOW/config')
        .set('Authorization', `Bearer ${stTok}`)
        .expect(200);
      const getBody1 = getRes1.body as {
        fields: Record<string, unknown>;
        hasDeviceOverride: boolean;
        pendingOverride: unknown;
      };
      expect(getBody1.hasDeviceOverride).toBe(true);
      expect(getBody1.fields).toEqual({ APN: 'new-apn' });
      expect(getBody1.pendingOverride).toBeNull();

      const res2 = await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-FLOW/config-override')
        .set('Authorization', `Bearer ${stTok}`)
        .send({ fields: { REPORT_INTERVAL_MOVING: '60' }, reason: 'รอบสอง' })
        .expect(200);
      const override2 = res2.body as {
        id: string;
        versionNumber: number;
        fields: Record<string, unknown>;
      };
      // สะสมค่าจาก approved รอบก่อน (APN) ไว้ด้วย ไม่ใช่แค่ dto.fields รอบนี้
      expect(override2.fields).toEqual({
        APN: 'new-apn',
        REPORT_INTERVAL_MOVING: '60',
      });
      expect(override2.versionNumber).toBe(2);

      await request(app.getHttpServer())
        .post(`/api/v1/device-config-overrides/${override2.id}/approve`)
        .set('Authorization', `Bearer ${opTok}`)
        .expect(200);

      const getRes2 = await request(app.getHttpServer())
        .get('/api/v1/devices/DCO-FLOW/config')
        .set('Authorization', `Bearer ${stTok}`)
        .expect(200);
      const getBody2 = getRes2.body as { fields: Record<string, unknown> };
      expect(getBody2.fields).toEqual({
        APN: 'new-apn',
        REPORT_INTERVAL_MOVING: '60',
      });
    });

    it('Operation reject -> สถานะ rejected พร้อม rejectReason, ไม่กระทบ GET /config, versionNumber รอบถัดไปยังนับต่อจากแถวที่ถูก reject', async () => {
      await makeDevice('DCO-REJ', 'installed');
      const configId = await makeConfig('approved');
      await makeCompletedTask('DCO-REJ', configId);
      await makeOverridableField('APN', true);
      const stTok = await stToken();
      const opTok = await opToken();

      const res1 = await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-REJ/config-override')
        .set('Authorization', `Bearer ${stTok}`)
        .send({ fields: { APN: 'rejected-apn' }, reason: 'ขอลอง' })
        .expect(200);
      const override1 = res1.body as { id: string };

      const rejectRes = await request(app.getHttpServer())
        .post(`/api/v1/device-config-overrides/${override1.id}/reject`)
        .set('Authorization', `Bearer ${opTok}`)
        .send({ rejectReason: 'ไม่เหมาะสมกับสถานการณ์หน้างาน' })
        .expect(200);
      const rejected = rejectRes.body as {
        status: string;
        rejectReason: string;
      };
      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectReason).toBe('ไม่เหมาะสมกับสถานการณ์หน้างาน');

      const getRes = await request(app.getHttpServer())
        .get('/api/v1/devices/DCO-REJ/config')
        .set('Authorization', `Bearer ${stTok}`)
        .expect(200);
      const getBody = getRes.body as {
        fields: Record<string, unknown>;
        hasDeviceOverride: boolean;
        pendingOverride: unknown;
      };
      expect(getBody.hasDeviceOverride).toBe(false);
      expect(getBody.fields).toEqual({ APN: 'internet' });
      expect(getBody.pendingOverride).toBeNull();

      // versionNumber ต้องนับจากทุกสถานะ (รวม rejected) กัน @@unique ชน
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-REJ/config-override')
        .set('Authorization', `Bearer ${stTok}`)
        .send({ fields: { APN: 'second-try' }, reason: 'ลองใหม่' })
        .expect(200);
      const override2 = res2.body as { versionNumber: number };
      expect(override2.versionNumber).toBe(2);
    });

    it('อุปกรณ์อื่นที่ใช้ Config เดียวกัน -> ไม่เห็น override ของเครื่องนี้แม้อนุมัติแล้ว (per-device จริง, issue #223)', async () => {
      const configId = await makeConfig('approved');
      await makeDevice('DCO-SHARED-A', 'installed');
      await makeDevice('DCO-SHARED-B', 'installed');
      await makeCompletedTask('DCO-SHARED-A', configId);
      await makeCompletedTask('DCO-SHARED-B', configId);
      await makeOverridableField('APN', true);
      const stTok = await stToken();
      const opTok = await opToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-SHARED-A/config-override')
        .set('Authorization', `Bearer ${stTok}`)
        .send({ fields: { APN: 'only-for-a' }, reason: 'เฉพาะเครื่อง A' })
        .expect(200);
      const override = res.body as { id: string };
      await request(app.getHttpServer())
        .post(`/api/v1/device-config-overrides/${override.id}/approve`)
        .set('Authorization', `Bearer ${opTok}`)
        .expect(200);

      const otherStTok = await stToken();
      const resB = await request(app.getHttpServer())
        .get('/api/v1/devices/DCO-SHARED-B/config')
        .set('Authorization', `Bearer ${otherStTok}`)
        .expect(200);

      const bodyB = resB.body as {
        fields: Record<string, unknown>;
        hasDeviceOverride: boolean;
      };
      expect(bodyB.hasDeviceOverride).toBe(false);
      expect(bodyB.fields).toEqual({ APN: 'internet' });
    });

    describe('POST /device-config-overrides/:id/approve, /reject, GET /device-config-overrides (Operation, issue #223, มติ 2026-09-24 / PR #225)', () => {
      // เทสบางตัวเรียก setupPending()/opToken2() มากกว่า 1 ครั้ง (เช่น list
      // test ที่สร้าง 2 คำขอ) — guard ด้วย flag เดียวกับแพทเทิร์น
      // grantStOnce/grantOpOnce ด้านบน กัน RolePermission unique ชนกัน
      let stGranted2 = false;
      let opGranted2 = false;
      beforeEach(() => {
        stGranted2 = false;
        opGranted2 = false;
      });

      async function opToken2(): Promise<string> {
        if (!opGranted2) {
          await grant(
            'Operation',
            ActionType.Approve,
            'device-config-override',
          );
          await grant('Operation', ActionType.Read, 'device-config-override');
          opGranted2 = true;
        }
        const opUser = await makeUser(prisma, { role: 'Operation' });
        return tokenFor(opUser.id, 'Operation');
      }

      async function makePendingOverride(
        deviceId: string,
        configId: string,
        stTok: string,
        fields: Record<string, unknown> = { APN: 'x' },
      ): Promise<string> {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/devices/${deviceId}/config-override`)
          .set('Authorization', `Bearer ${stTok}`)
          .send({ fields, reason: 'ทดสอบ' })
          .expect(200);
        return (res.body as { id: string }).id;
      }

      async function setupPending(deviceId: string): Promise<{
        overrideId: string;
        stTok: string;
      }> {
        await makeDevice(deviceId, 'installed');
        const configId = await makeConfig('approved');
        await makeCompletedTask(deviceId, configId);
        await makeOverridableField('APN', true);
        if (!stGranted2) {
          await grant('ST', ActionType.Override, 'device-config-override');
          await grant('ST', ActionType.Read, 'device-current-config');
          stGranted2 = true;
        }
        const stUser = await makeUser(prisma, { role: 'ST' });
        const stTok = tokenFor(stUser.id, 'ST');
        const overrideId = await makePendingOverride(deviceId, configId, stTok);
        return { overrideId, stTok };
      }

      it('ไม่ส่ง Authorization -> 401', async () => {
        const { overrideId } = await setupPending('DCO-APR-401');
        await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${overrideId}/approve`)
          .expect(401);
      });

      it('role ST (คนส่งคำขอเอง ไม่มีสิทธิ์อนุมัติ) -> 403 (Separation of Duty)', async () => {
        const { overrideId, stTok } = await setupPending('DCO-APR-403');
        await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${overrideId}/approve`)
          .set('Authorization', `Bearer ${stTok}`)
          .expect(403);
      });

      it('role OT (ไม่มีสิทธิ์อนุมัติเช่นกัน) -> 403', async () => {
        const { overrideId } = await setupPending('DCO-APR-403B');
        const otUser = await makeUser(prisma, { role: 'OT' });
        await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${overrideId}/approve`)
          .set('Authorization', `Bearer ${tokenFor(otUser.id, 'OT')}`)
          .expect(403);
      });

      it('ไม่พบคำขอ -> 404', async () => {
        const opTok = await opToken2();
        await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${randomUUID()}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(404);
      });

      it('Operation approve คำขอ pending -> 200 สถานะ approved + AuditLog device-config-override-approve', async () => {
        const { overrideId } = await setupPending('DCO-APR-200');
        const opTok = await opToken2();

        const res = await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${overrideId}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(200);
        const body = res.body as { status: string; decidedBy: string };
        expect(body.status).toBe('approved');
        expect(body.decidedBy).toBeTruthy();

        const audit = await prisma.auditLog.findMany({
          where: {
            auditModule: 'device',
            action: 'device-config-override-approve',
          },
        });
        expect(audit).toHaveLength(1);
      });

      it('bug fix (comment A รอบ 2 บน PR #225): configId ของคำขอไม่ตรงกับ Config ปัจจุบันแล้ว (Confirm Install ใหม่ทับระหว่างรออนุมัติ) -> approve 409', async () => {
        const { overrideId } = await setupPending('DCO-APR-STALE');
        const opTok = await opToken2();
        // Confirm Install ใหม่ทับด้วย Config อีกตัว (deviceModel/protocol
        // เดียวกัน) — base Config ของอุปกรณ์เปลี่ยนไปแล้วตั้งแต่ ST ส่งคำขอ
        const newConfigId = await makeConfig('approved');
        await makeCompletedTask('DCO-APR-STALE', newConfigId);

        await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${overrideId}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(409);

        const row = await prisma.deviceConfigOverride.findUnique({
          where: { id: overrideId },
        });
        expect(row?.status).toBe('pending'); // ไม่ถูก approve
      });

      it('คำขอถูกตัดสินใจไปแล้ว -> approve ซ้ำ 409', async () => {
        const { overrideId } = await setupPending('DCO-APR-409');
        const opTok = await opToken2();

        await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${overrideId}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(200);

        await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${overrideId}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(409);
      });

      it('Operation reject คำขอ pending -> 200 สถานะ rejected + AuditLog device-config-override-reject', async () => {
        const { overrideId } = await setupPending('DCO-REJ-200');
        const opTok = await opToken2();

        const res = await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${overrideId}/reject`)
          .set('Authorization', `Bearer ${opTok}`)
          .send({ rejectReason: 'ไม่เหมาะสม' })
          .expect(200);
        const body = res.body as { status: string; rejectReason: string };
        expect(body.status).toBe('rejected');
        expect(body.rejectReason).toBe('ไม่เหมาะสม');

        const audit = await prisma.auditLog.findMany({
          where: {
            auditModule: 'device',
            action: 'device-config-override-reject',
          },
        });
        expect(audit).toHaveLength(1);
      });

      it('role ST -> reject 403 (Separation of Duty)', async () => {
        const { overrideId, stTok } = await setupPending('DCO-REJ-403');
        await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${overrideId}/reject`)
          .set('Authorization', `Bearer ${stTok}`)
          .send({})
          .expect(403);
      });

      it('GET /device-config-overrides ไม่ส่ง Authorization -> 401', async () => {
        await request(app.getHttpServer())
          .get('/api/v1/device-config-overrides')
          .expect(401);
      });

      it('role ST -> GET list 403 (ไม่มีสิทธิ์ดูคิวอนุมัติ)', async () => {
        const { stTok } = await setupPending('DCO-LIST-403');
        await request(app.getHttpServer())
          .get('/api/v1/device-config-overrides')
          .set('Authorization', `Bearer ${stTok}`)
          .expect(403);
      });

      it('Operation -> GET ?status=pending คืนเฉพาะแถว pending', async () => {
        const { overrideId: pendingId } = await setupPending('DCO-LIST-P');
        const { overrideId: toApproveId } = await setupPending('DCO-LIST-A');
        const opTok = await opToken2();
        await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${toApproveId}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(200);

        const res = await request(app.getHttpServer())
          .get('/api/v1/device-config-overrides?status=pending')
          .set('Authorization', `Bearer ${opTok}`)
          .expect(200);
        const body = res.body as Array<{ id: string; status: string }>;
        expect(body.every((row) => row.status === 'pending')).toBe(true);
        expect(body.some((row) => row.id === pendingId)).toBe(true);
        expect(body.some((row) => row.id === toApproveId)).toBe(false);
      });
    });
  });
});
