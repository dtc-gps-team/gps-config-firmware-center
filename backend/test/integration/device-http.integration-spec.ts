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
});
