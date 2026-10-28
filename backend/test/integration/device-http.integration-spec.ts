import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import {
  ActionType,
  CampaignRolloutStatus,
  DeviceLifecycleStatus,
  PrismaClient,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { DeviceModule } from '../../src/device/device.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { ConfigApplyRequestService } from '../../src/config-apply-request/config-apply-request.service';
import { TaskService } from '../../src/task/task.service';
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

  describe('POST /devices (issue #157 PR 1 — ลงทะเบียนอุปกรณ์ใหม่)', () => {
    async function adminToken(): Promise<string> {
      const adminUser = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Create, 'device-registration');
      return tokenFor(adminUser.id, 'Admin');
    }

    it('ไม่ส่ง Authorization header -> 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .send({
          deviceId: 'NEW-401',
          simNumber: '0899999999',
          imei: '860000000000001',
          serialNumber: 'SN-INT-0001',
          blackboxId: 'BB-INT-0001',
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
        })
        .expect(401);
    });

    it('บันทึก AuditLog ไม่ได้ (ผู้ทำรายการไม่มีในระบบ) -> 500 และเครื่องที่เพิ่งสร้างถูกย้อนกลับ ไม่ค้างในระบบ (issue #292)', async () => {
      await grant('Admin', ActionType.Create, 'device-registration');
      // token ที่ผ่าน guard ได้ (role มีสิทธิ์) แต่ userId ไม่มีในตาราง User ->
      // FK ของ AuditLog.userId ล้ม ต้องทำให้การสร้างเครื่องล้มตามด้วย (atomic)
      // เดิมได้ 500 แต่เครื่องถูกสร้างไปแล้ว และ apiKey (แสดงครั้งเดียว) หาย
      const token = tokenFor('00000000-0000-4000-8000-000000000099', 'Admin');
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');

      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          deviceId: 'ATOMIC-REG-1',
          simNumber: '0899999999',
          imei: '860000000000001',
          serialNumber: 'SN-INT-0001',
          blackboxId: 'BB-INT-0001',
          modelId: model.id,
          protocol: 'TCP',
        })
        .expect(500);

      expect(
        await prisma.device.count({ where: { deviceId: 'ATOMIC-REG-1' } }),
      ).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('role ไม่มีสิทธิ์ device-registration.Create (ST) -> 403', async () => {
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'devices');
      const token = tokenFor(stUser.id, 'ST');
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');

      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          deviceId: 'NEW-403',
          simNumber: '0899999999',
          imei: '860000000000001',
          serialNumber: 'SN-INT-0001',
          blackboxId: 'BB-INT-0001',
          modelId: model.id,
          protocol: 'TCP',
        })
        .expect(403);
    });

    it('ขาด field บังคับ (ไม่ส่ง modelId) -> 400', async () => {
      const token = await adminToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceId: 'NEW-400', simNumber: '0899999999', protocol: 'TCP' })
        .expect(400);
    });

    describe('IMEI / Serial Number / Blackbox ID บังคับกรอก (มติ A กับ B 13 ต.ค. 2569)', () => {
      async function body(overrides: Record<string, unknown>) {
        const model = await getOrCreateDeviceModel(prisma, 'GT06N');
        return {
          deviceId: `REQ-${randomUUID().slice(0, 8)}`,
          simNumber: '0899999999',
          imei: '860000000000001',
          serialNumber: 'SN-INT-0001',
          blackboxId: 'BB-INT-0001',
          modelId: model.id,
          protocol: 'TCP',
          ...overrides,
        };
      }

      it.each(['imei', 'serialNumber', 'blackboxId'])(
        'ไม่ส่ง %s -> 400 และไม่สร้างเครื่อง',
        async (field) => {
          const token = await adminToken();
          const payload = await body({});
          delete (payload as Record<string, unknown>)[field];
          const before = await prisma.device.count();

          await request(app.getHttpServer())
            .post('/api/v1/devices')
            .set('Authorization', `Bearer ${token}`)
            .send(payload)
            .expect(400);

          expect(await prisma.device.count()).toBe(before);
        },
      );

      it.each(['imei', 'serialNumber', 'blackboxId'])(
        '%s เป็นช่องว่างล้วน -> 400 (ไม่นับว่ากรอกแล้ว)',
        async (field) => {
          const token = await adminToken();

          await request(app.getHttpServer())
            .post('/api/v1/devices')
            .set('Authorization', `Bearer ${token}`)
            .send(await body({ [field]: '   ' }))
            .expect(400);
        },
      );

      it('ช่องว่างหัวท้ายถูกตัดก่อนบันทึก', async () => {
        const token = await adminToken();
        const payload = await body({
          imei: '  860000000000009  ',
          blackboxId: ' BB-TRIM ',
        });

        await request(app.getHttpServer())
          .post('/api/v1/devices')
          .set('Authorization', `Bearer ${token}`)
          .send(payload)
          .expect(201);

        const row = await prisma.device.findUniqueOrThrow({
          where: { deviceId: payload.deviceId },
        });
        expect(row.imei).toBe('860000000000009');
        expect(row.blackboxId).toBe('BB-TRIM');
      });

      it('อุปกรณ์เก่าที่ไม่มีค่าทั้งสามช่องยังอ่านได้ปกติ (คอลัมน์ยัง nullable)', async () => {
        const adminUser = await makeUser(prisma, { role: 'Admin' });
        await grant('Admin', ActionType.Read, 'devices');
        const token = tokenFor(adminUser.id, 'Admin');
        await makeDevice('LEGACY-NOID', 'installed');

        const res = await request(app.getHttpServer())
          .get('/api/v1/devices/LEGACY-NOID')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        const row = res.body as {
          imei: string | null;
          serialNumber: string | null;
          blackboxId: string | null;
        };
        expect(row.imei).toBeNull();
        expect(row.serialNumber).toBeNull();
        expect(row.blackboxId).toBeNull();
      });
    });

    it('modelId ไม่พบในทะเบียน -> 404', async () => {
      const token = await adminToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          deviceId: 'NEW-404',
          simNumber: '0899999999',
          imei: '860000000000001',
          serialNumber: 'SN-INT-0001',
          blackboxId: 'BB-INT-0001',
          modelId: randomUUID(),
          protocol: 'TCP',
        })
        .expect(404);
    });

    it('protocol ไม่อยู่ใน supportedProtocols ของรุ่นนั้น -> 400', async () => {
      const token = await adminToken();
      const model = await prisma.deviceModel.upsert({
        where: { name: 'TCP-ONLY-MODEL' },
        update: {},
        create: { name: 'TCP-ONLY-MODEL', supportedProtocols: ['TCP'] },
      });

      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          deviceId: 'NEW-400B',
          simNumber: '0899999999',
          imei: '860000000000001',
          serialNumber: 'SN-INT-0001',
          blackboxId: 'BB-INT-0001',
          modelId: model.id,
          protocol: 'UDP',
        })
        .expect(400);
    });

    it('deviceId ซ้ำ -> 409', async () => {
      const token = await adminToken();
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');
      await makeDevice('NEW-409', 'registered');

      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          deviceId: 'NEW-409',
          simNumber: '0899999999',
          imei: '860000000000001',
          serialNumber: 'SN-INT-0001',
          blackboxId: 'BB-INT-0001',
          modelId: model.id,
          protocol: 'TCP',
        })
        .expect(409);
    });

    // #246 review B — customerId รูปแบบ UUID ถูกแต่ไม่มีอยู่จริง เดิมปล่อยให้
    // Prisma โยน P2003 (FK violation) กลายเป็น 500 แทน error ที่สื่อความหมาย
    it('customerId รูปแบบ UUID ถูกแต่ไม่มีอยู่จริง -> 404 ไม่ใช่ 500', async () => {
      const token = await adminToken();
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');

      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          deviceId: 'NEW-NOCUSTOMER',
          simNumber: '0899999999',
          imei: '860000000000001',
          serialNumber: 'SN-INT-0001',
          blackboxId: 'BB-INT-0001',
          modelId: model.id,
          protocol: 'TCP',
          customerId: randomUUID(),
        })
        .expect(404);
    });

    it('customerId มีอยู่จริง -> 201, Device ผูกกับ customer นั้น', async () => {
      const token = await adminToken();
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');
      const customer = await prisma.customer.create({
        data: { companyName: `Cus-${randomUUID()}` },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          deviceId: 'NEW-CUSTOMER',
          simNumber: '0899999999',
          imei: '860000000000001',
          serialNumber: 'SN-INT-0001',
          blackboxId: 'BB-INT-0001',
          modelId: model.id,
          protocol: 'TCP',
          customerId: customer.id,
        })
        .expect(201);

      const body = res.body as { deviceId: string };
      expect(body.deviceId).toBe('NEW-CUSTOMER');
      const row = await prisma.device.findUniqueOrThrow({
        where: { deviceId: 'NEW-CUSTOMER' },
      });
      expect(row.customerId).toBe(customer.id);
    });

    it('สำเร็จ -> 201, คืน apiKey จริง ไม่มี apiKeyHash, DB เก็บ hash ที่ compare กับ apiKey ผ่านจริง', async () => {
      const token = await adminToken();
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          deviceId: 'NEW-201',
          simNumber: '0899999999',
          imei: '860000000000001',
          serialNumber: 'SN-INT-0001',
          blackboxId: 'BB-INT-0001',
          modelId: model.id,
          protocol: 'TCP',
          hardwareRevisionCode: 'RevA',
        })
        .expect(201);

      const body = res.body as {
        deviceId: string;
        deviceModel: string;
        protocol: string;
        status: string;
        apiKey: string;
        apiKeyHash?: string;
      };
      expect(body.deviceId).toBe('NEW-201');
      expect(body.deviceModel).toBe('GT06N'); // มาจาก model.name เสมอ
      expect(body.status).toBe('registered');
      expect(typeof body.apiKey).toBe('string');
      expect(body.apiKey.length).toBeGreaterThan(0);
      expect(body.apiKeyHash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('apiKeyHash');

      const row = await prisma.device.findUniqueOrThrow({
        where: { deviceId: 'NEW-201' },
      });
      expect(row.apiKeyHash).not.toBeNull();
      await expect(
        bcrypt.compare(body.apiKey, row.apiKeyHash ?? ''),
      ).resolves.toBe(true);
    });

    it('เขียน AuditLog action register', async () => {
      const token = await adminToken();
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');

      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          deviceId: 'NEW-AUDIT',
          simNumber: '0899999999',
          imei: '860000000000001',
          serialNumber: 'SN-INT-0001',
          blackboxId: 'BB-INT-0001',
          modelId: model.id,
          protocol: 'TCP',
        })
        .expect(201);

      const logRow = await prisma.auditLog.findFirst({
        where: { auditModule: 'device', action: 'register' },
      });
      expect(logRow).not.toBeNull();
      // IP ต้องติดมาด้วยแม้ audit จะเขียนในทรานแซกชัน (#299 + #301)
      expect(logRow?.ipAddress).toBeTruthy();
      expect(JSON.stringify(logRow?.metadata ?? {})).not.toContain(
        'apiKeyHash',
      );
    });

    it('apiKeyHash ไม่หลุดออกมาทาง GET /devices หรือ GET /devices/{id} หลังลงทะเบียน', async () => {
      const token = await adminToken();
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');
      await request(app.getHttpServer())
        .post('/api/v1/devices')
        .set('Authorization', `Bearer ${token}`)
        .send({
          deviceId: 'NEW-NOLEAK',
          simNumber: '0899999999',
          imei: '860000000000001',
          serialNumber: 'SN-INT-0001',
          blackboxId: 'BB-INT-0001',
          modelId: model.id,
          protocol: 'TCP',
        })
        .expect(201);

      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'devices');
      const stToken = tokenFor(stUser.id, 'ST');

      const listRes = await request(app.getHttpServer())
        .get('/api/v1/devices')
        .set('Authorization', `Bearer ${stToken}`)
        .expect(200);
      expect(JSON.stringify(listRes.body)).not.toContain('apiKeyHash');

      const detailRes = await request(app.getHttpServer())
        .get('/api/v1/devices/NEW-NOLEAK')
        .set('Authorization', `Bearer ${stToken}`)
        .expect(200);
      expect(JSON.stringify(detailRes.body)).not.toContain('apiKeyHash');
    });
  });

  describe('POST /devices/:deviceId/rotate-key (issue #157 PR 1 — เพิ่มระหว่างทำ)', () => {
    async function adminToken(): Promise<string> {
      const adminUser = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Update, 'device-registration');
      return tokenFor(adminUser.id, 'Admin');
    }

    it('ไม่ส่ง Authorization header -> 401', async () => {
      await makeDevice('ROT-401', 'installed');

      await request(app.getHttpServer())
        .post('/api/v1/devices/ROT-401/rotate-key')
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ device-registration.Update (ST) -> 403', async () => {
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'devices');
      const token = tokenFor(stUser.id, 'ST');
      await makeDevice('ROT-403', 'installed');

      await request(app.getHttpServer())
        .post('/api/v1/devices/ROT-403/rotate-key')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('บันทึก AuditLog ไม่ได้ (ผู้ทำรายการไม่มีในระบบ) -> 500 และ key เดิมไม่ถูกแทนที่ ยังใช้ได้อยู่ (issue #292)', async () => {
      await grant('Admin', ActionType.Update, 'device-registration');
      // token ที่ผ่าน guard ได้ แต่ userId ไม่มีในตาราง User -> FK ของ AuditLog
      // ล้ม ต้องย้อนกลับการแทนที่ key ด้วย เดิม key เดิมถูกแทนที่ไปแล้วแต่ key
      // ใหม่ไม่ถูกส่งกลับ อุปกรณ์ติดต่อระบบไม่ได้จนกว่าจะออก key ซ้ำ
      const token = tokenFor('00000000-0000-4000-8000-000000000099', 'Admin');
      const oldHash = await bcrypt.hash('old-key', 10);
      await makeDevice('ATOMIC-ROT-1', 'installed');
      await prisma.device.update({
        where: { deviceId: 'ATOMIC-ROT-1' },
        data: { apiKeyHash: oldHash },
      });

      await request(app.getHttpServer())
        .post('/api/v1/devices/ATOMIC-ROT-1/rotate-key')
        .set('Authorization', `Bearer ${token}`)
        .expect(500);

      const after = await prisma.device.findUniqueOrThrow({
        where: { deviceId: 'ATOMIC-ROT-1' },
        omit: { apiKeyHash: false },
      });
      expect(after.apiKeyHash).toBe(oldHash);
      await expect(bcrypt.compare('old-key', after.apiKeyHash!)).resolves.toBe(
        true,
      );
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('ไม่พบ deviceId -> 404', async () => {
      const token = await adminToken();

      await request(app.getHttpServer())
        .post('/api/v1/devices/DOES-NOT-EXIST/rotate-key')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('เครื่องเก่าที่ไม่เคยมี apiKeyHash (สร้างก่อนฟีเจอร์นี้) -> ออก key ให้ครั้งแรกได้, 200, DB เก็บ hash คู่กับ apiKey จริง', async () => {
      const token = await adminToken();
      await makeDevice('ROT-OLD', 'installed'); // ไม่มี apiKeyHash ตั้งแต่สร้าง

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/ROT-OLD/rotate-key')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { deviceId: string; apiKey: string };
      expect(body.deviceId).toBe('ROT-OLD');
      expect(typeof body.apiKey).toBe('string');
      expect(JSON.stringify(res.body)).not.toContain('apiKeyHash');

      const row = await prisma.device.findUniqueOrThrow({
        where: { deviceId: 'ROT-OLD' },
      });
      expect(row.apiKeyHash).not.toBeNull();
      await expect(
        bcrypt.compare(body.apiKey, row.apiKeyHash ?? ''),
      ).resolves.toBe(true);
    });

    it('เครื่องที่มี apiKeyHash เดิมอยู่แล้ว -> key เดิมใช้ต่อไม่ได้ทันที (hash เปลี่ยน)', async () => {
      const token = await adminToken();
      await makeDevice('ROT-EXIST', 'installed');
      const firstRes = await request(app.getHttpServer())
        .post('/api/v1/devices/ROT-EXIST/rotate-key')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const firstBody = firstRes.body as { apiKey: string };
      const firstRow = await prisma.device.findUniqueOrThrow({
        where: { deviceId: 'ROT-EXIST' },
      });

      const secondRes = await request(app.getHttpServer())
        .post('/api/v1/devices/ROT-EXIST/rotate-key')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const secondBody = secondRes.body as { apiKey: string };
      const secondRow = await prisma.device.findUniqueOrThrow({
        where: { deviceId: 'ROT-EXIST' },
      });

      expect(secondBody.apiKey).not.toBe(firstBody.apiKey);
      expect(secondRow.apiKeyHash).not.toBe(firstRow.apiKeyHash);
      // key รอบแรก compare กับ hash ปัจจุบัน (รอบสอง) ต้องไม่ผ่านแล้ว
      await expect(
        bcrypt.compare(firstBody.apiKey, secondRow.apiKeyHash ?? ''),
      ).resolves.toBe(false);
    });

    it('เขียน AuditLog action rotate-key', async () => {
      const token = await adminToken();
      await makeDevice('ROT-AUDIT', 'installed');

      await request(app.getHttpServer())
        .post('/api/v1/devices/ROT-AUDIT/rotate-key')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const logRow = await prisma.auditLog.findFirst({
        where: { auditModule: 'device', action: 'rotate-key' },
      });
      expect(logRow).not.toBeNull();
      // IP ต้องติดมาด้วยแม้ audit จะเขียนในทรานแซกชัน (#299 + #301)
      expect(logRow?.ipAddress).toBeTruthy();
      expect(JSON.stringify(logRow?.metadata ?? {})).not.toContain(
        'apiKeyHash',
      );
    });
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

    it('ambiguous case — อุปกรณ์เดียวกันเป็น pending target ของ 2 rollout พร้อมกันด้วย configId เดียวกันเป๊ะ -> ส่ง rolloutId มาระบุให้ชัด แก้เฉพาะ rollout ที่ตั้งใจ ไม่แตะอีกอัน (issue #243)', async () => {
      await makeDevice('AC-AMBIGUOUS', 'installed');
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'device-config-apply');
      const token = tokenFor(stUser.id, 'ST');
      const configId = await makeConfig('approved');
      const opUser = await makeUser(prisma, { role: 'Operation' });

      // 2 รอบคนละแคมเปญ แต่ใช้ configId เดียวกัน และอุปกรณ์เครื่องนี้เป็น
      // pending target ของทั้งคู่พร้อมกัน — เดิม recordTargetResult() ไม่มีทาง
      // แยกว่าควรอัปเดตรอบไหน (match ได้ทั้งคู่ด้วย deviceId+configId)
      const campaignX = await prisma.campaign.create({
        data: { name: 'กลุ่ม X', createdBy: opUser.id },
      });
      const rolloutX = await prisma.campaignRollout.create({
        data: {
          campaignId: campaignX.id,
          payloadType: 'Config',
          configId,
          status: 'active',
          targetCount: 1,
          createdBy: opUser.id,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: { rolloutId: rolloutX.id, deviceId: 'AC-AMBIGUOUS' },
      });

      const campaignY = await prisma.campaign.create({
        data: { name: 'กลุ่ม Y', createdBy: opUser.id },
      });
      const rolloutY = await prisma.campaignRollout.create({
        data: {
          campaignId: campaignY.id,
          payloadType: 'Config',
          configId,
          status: 'active',
          targetCount: 1,
          createdBy: opUser.id,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: { rolloutId: rolloutY.id, deviceId: 'AC-AMBIGUOUS' },
      });

      // ระบุ rolloutId ของ Y ตรงๆ — ต้องแก้แค่ target ของ Y เท่านั้น
      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-AMBIGUOUS/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId, rolloutId: rolloutY.id })
        .expect(200);

      const targetY = await prisma.campaignRolloutTarget.findFirstOrThrow({
        where: { rolloutId: rolloutY.id, deviceId: 'AC-AMBIGUOUS' },
      });
      expect(targetY.status).toBe('success');

      // target ของ X ต้องยังเป็น pending — ไม่ถูกแตะเลย
      const targetX = await prisma.campaignRolloutTarget.findFirstOrThrow({
        where: { rolloutId: rolloutX.id, deviceId: 'AC-AMBIGUOUS' },
      });
      expect(targetX.status).toBe('pending');
    });

    it('issue #268 — เครื่องค้าง pending ใน 2 rollout คนละ configId: rolloutId จาก GET /status เป็นของรอบล่าสุด (B) แต่ช่างส่ง configId ของรอบเก่า (A) -> target ของ A ถูกบันทึกผลจริง (fallback match ด้วย payload) ไม่ค้าง pending เงียบๆ และ target ของ B ไม่ถูกแตะ', async () => {
      await makeDevice('AC-MISMATCH-268', 'installed');
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'device-config-apply');
      await grant('ST', ActionType.Read, 'devices');
      const token = tokenFor(stUser.id, 'ST');
      const configA = await makeConfig('approved');
      const configB = await makeConfig('approved');
      const opUser = await makeUser(prisma, { role: 'Operation' });

      // รอบ A (เก่ากว่า) ใช้ configA · รอบ B (ใหม่กว่า) ใช้ configB — เครื่องเดียวกัน
      // เป็น pending target ของทั้งคู่ GET /status คืน target ล่าสุดแค่รายการเดียว
      const makeRollout = async (configId: string, name: string) => {
        const campaign = await prisma.campaign.create({
          data: { name, createdBy: opUser.id },
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
          data: { rolloutId: rollout.id, deviceId: 'AC-MISMATCH-268' },
        });
        return rollout;
      };
      const rolloutA = await makeRollout(configA, 'รอบ A (เก่า)');
      await new Promise((resolve) => setTimeout(resolve, 20));
      const rolloutB = await makeRollout(configB, 'รอบ B (ล่าสุด)');

      // เงื่อนไขของบั๊ก: status ชี้รอบ B
      const status = await request(app.getHttpServer())
        .get('/api/v1/devices/AC-MISMATCH-268/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((status.body as { configRolloutId: string }).configRolloutId).toBe(
        rolloutB.id,
      );

      // Mobile ส่ง rolloutId ของรอบ B คู่กับ configId ของรอบ A (Task ผูก Config A)
      await request(app.getHttpServer())
        .post('/api/v1/devices/AC-MISMATCH-268/apply-config')
        .set('Authorization', `Bearer ${token}`)
        .send({ configId: configA, rolloutId: rolloutB.id })
        .expect(200);

      const targetA = await prisma.campaignRolloutTarget.findFirstOrThrow({
        where: { rolloutId: rolloutA.id, deviceId: 'AC-MISMATCH-268' },
      });
      expect(targetA.status).toBe('success');
      const targetB = await prisma.campaignRolloutTarget.findFirstOrThrow({
        where: { rolloutId: rolloutB.id, deviceId: 'AC-MISMATCH-268' },
      });
      expect(targetB.status).toBe('pending');
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

    it('ambiguous case — อุปกรณ์เดียวกันเป็น pending target ของ 2 rollout พร้อมกันด้วย firmwareId เดียวกันเป๊ะ -> ส่ง rolloutId มาระบุให้ชัด แก้เฉพาะ rollout ที่ตั้งใจ ไม่แตะอีกอัน (issue #243)', async () => {
      await makeDevice('CF-AMBIGUOUS', 'installed');
      const token = await stToken();
      const firmwareId = await makeFirmware();
      const opUser = await makeUser(prisma, { role: 'Operation' });

      const campaignX = await prisma.campaign.create({
        data: { name: 'กลุ่ม X', createdBy: opUser.id },
      });
      const rolloutX = await prisma.campaignRollout.create({
        data: {
          campaignId: campaignX.id,
          payloadType: 'Firmware',
          firmwareId,
          status: 'active',
          targetCount: 1,
          createdBy: opUser.id,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: { rolloutId: rolloutX.id, deviceId: 'CF-AMBIGUOUS' },
      });

      const campaignY = await prisma.campaign.create({
        data: { name: 'กลุ่ม Y', createdBy: opUser.id },
      });
      const rolloutY = await prisma.campaignRollout.create({
        data: {
          campaignId: campaignY.id,
          payloadType: 'Firmware',
          firmwareId,
          status: 'active',
          targetCount: 1,
          createdBy: opUser.id,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: { rolloutId: rolloutY.id, deviceId: 'CF-AMBIGUOUS' },
      });

      await request(app.getHttpServer())
        .post('/api/v1/devices/CF-AMBIGUOUS/confirm-firmware-install')
        .set('Authorization', `Bearer ${token}`)
        .send({ firmwareId, rolloutId: rolloutY.id })
        .expect(200);

      const targetY = await prisma.campaignRolloutTarget.findFirstOrThrow({
        where: { rolloutId: rolloutY.id, deviceId: 'CF-AMBIGUOUS' },
      });
      expect(targetY.status).toBe('success');

      const targetX = await prisma.campaignRolloutTarget.findFirstOrThrow({
        where: { rolloutId: rolloutX.id, deviceId: 'CF-AMBIGUOUS' },
      });
      expect(targetX.status).toBe('pending');
    });

    describe('Firmware Override deviation gate (Sprint 3 แถวที่ 24)', () => {
      async function makeActiveFirmwareRollout(
        deviceId: string,
        firmwareId: string,
        status: CampaignRolloutStatus = 'active',
      ): Promise<void> {
        const opUser = await makeUser(prisma, { role: 'Operation' });
        const campaign = await prisma.campaign.create({
          data: {
            name: `กลุ่ม override gate ${randomUUID()}`,
            createdBy: opUser.id,
          },
        });
        const rollout = await prisma.campaignRollout.create({
          data: {
            campaignId: campaign.id,
            payloadType: 'Firmware',
            firmwareId,
            status,
            targetCount: 1,
            createdBy: opUser.id,
          },
        });
        await prisma.campaignRolloutTarget.create({
          data: { rolloutId: rollout.id, deviceId },
        });
      }

      it('มี Campaign Rollout active กำหนด firmware อื่นไว้ + ไม่มี override -> 409', async () => {
        await makeDevice('FOV-GATE-409', 'installed');
        const token = await stToken();
        const assignedFirmwareId = await makeFirmware();
        const otherFirmwareId = await makeFirmware();
        await makeActiveFirmwareRollout('FOV-GATE-409', assignedFirmwareId);

        await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-GATE-409/confirm-firmware-install')
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId: otherFirmwareId })
          .expect(409);
      });

      it.each(['approved', 'paused'] as const)(
        'rollout สถานะ %s (ยังเป็นแผนที่ Campaign ตั้งใจจริง — แก้ตามรีวิว B PR #257 ข้อ 4) กำหนด firmware อื่นไว้ + ไม่มี override -> 409 เหมือน active',
        async (status) => {
          const deviceId = `FOV-GATE-409-${status.toUpperCase()}`;
          await makeDevice(deviceId, 'installed');
          const token = await stToken();
          const assignedFirmwareId = await makeFirmware();
          const otherFirmwareId = await makeFirmware();
          await makeActiveFirmwareRollout(deviceId, assignedFirmwareId, status);

          await request(app.getHttpServer())
            .post(`/api/v1/devices/${deviceId}/confirm-firmware-install`)
            .set('Authorization', `Bearer ${token}`)
            .send({ firmwareId: otherFirmwareId })
            .expect(409);
        },
      );

      it('rollout สถานะ pending_approval (ยังไม่ผ่านอนุมัติ ไม่ใช่แผนที่ยืนยันแล้ว) กำหนด firmware อื่นไว้ -> 200 ผ่านปกติ ไม่ gate', async () => {
        await makeDevice('FOV-GATE-200-PENDING', 'installed');
        const token = await stToken();
        const assignedFirmwareId = await makeFirmware();
        const otherFirmwareId = await makeFirmware();
        await makeActiveFirmwareRollout(
          'FOV-GATE-200-PENDING',
          assignedFirmwareId,
          'pending_approval',
        );

        await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-GATE-200-PENDING/confirm-firmware-install')
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId: otherFirmwareId })
          .expect(200);
      });

      it('มี Campaign Rollout active กำหนด firmware ตรงกับที่ขอ confirm -> 200 ผ่านปกติ', async () => {
        await makeDevice('FOV-GATE-200', 'installed');
        const token = await stToken();
        const assignedFirmwareId = await makeFirmware();
        await makeActiveFirmwareRollout('FOV-GATE-200', assignedFirmwareId);

        await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-GATE-200/confirm-firmware-install')
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId: assignedFirmwareId })
          .expect(200);
      });

      it('มี Campaign Rollout active กำหนด firmware อื่นไว้ แต่มี DeviceFirmwareOverride approved ตรงกับ firmware ที่ขอ -> 200', async () => {
        await makeDevice('FOV-GATE-OV200', 'installed');
        const token = await stToken();
        const assignedFirmwareId = await makeFirmware();
        const overrideFirmwareId = await makeFirmware();
        await makeActiveFirmwareRollout('FOV-GATE-OV200', assignedFirmwareId);

        const stUser = await makeUser(prisma, { role: 'ST' });
        const opUser = await makeUser(prisma, { role: 'Operation' });
        await prisma.deviceFirmwareOverride.create({
          data: {
            deviceId: 'FOV-GATE-OV200',
            firmwareId: overrideFirmwareId,
            versionNumber: 1,
            reason: 'ทดสอบ gate',
            status: 'approved',
            overriddenBy: stUser.id,
            decidedBy: opUser.id,
            decidedAt: new Date(),
          },
        });

        await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-GATE-OV200/confirm-firmware-install')
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId: overrideFirmwareId })
          .expect(200);
      });

      it('override single-use (แก้ตามรีวิว B PR #257 ข้อ 1): ใช้ override แล้ว consumedAt ถูก mark จริง และใช้ซ้ำครั้งที่ 2 ไม่ได้ -> 409', async () => {
        await makeDevice('FOV-GATE-ONCE', 'installed');
        const token = await stToken();
        const assignedFirmwareId = await makeFirmware();
        const overrideFirmwareId = await makeFirmware();
        await makeActiveFirmwareRollout('FOV-GATE-ONCE', assignedFirmwareId);

        const stUser = await makeUser(prisma, { role: 'ST' });
        const opUser = await makeUser(prisma, { role: 'Operation' });
        const override = await prisma.deviceFirmwareOverride.create({
          data: {
            deviceId: 'FOV-GATE-ONCE',
            firmwareId: overrideFirmwareId,
            versionNumber: 1,
            reason: 'ทดสอบ single-use',
            status: 'approved',
            overriddenBy: stUser.id,
            decidedBy: opUser.id,
            decidedAt: new Date(),
          },
        });

        // ครั้งแรก — ผ่านปกติ
        await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-GATE-ONCE/confirm-firmware-install')
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId: overrideFirmwareId })
          .expect(200);

        const reloaded = await prisma.deviceFirmwareOverride.findUniqueOrThrow({
          where: { id: override.id },
        });
        expect(reloaded.consumedAt).not.toBeNull();

        // ครั้งที่สอง — override เดิมถูกใช้ไปแล้ว ไม่มีแถว approved+ยังไม่ใช้
        // เหลือให้ gate ผ่านได้อีก
        await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-GATE-ONCE/confirm-firmware-install')
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId: overrideFirmwareId })
          .expect(409);
      });
    });
  });

  describe('POST /devices/:deviceId/firmware-override, /device-firmware-overrides (Sprint 3 แถวที่ 24)', () => {
    let stGranted = false;
    let opGranted = false;
    beforeEach(() => {
      stGranted = false;
      opGranted = false;
    });

    async function stToken(): Promise<string> {
      if (!stGranted) {
        await grant('ST', ActionType.Override, 'device-firmware-override');
        stGranted = true;
      }
      const stUser = await makeUser(prisma, { role: 'ST' });
      return tokenFor(stUser.id, 'ST');
    }

    async function opToken(): Promise<string> {
      if (!opGranted) {
        await grant(
          'Operation',
          ActionType.Approve,
          'device-firmware-override',
        );
        await grant('Operation', ActionType.Read, 'device-firmware-override');
        opGranted = true;
      }
      const opUser = await makeUser(prisma, { role: 'Operation' });
      return tokenFor(opUser.id, 'Operation');
    }

    describe('POST /devices/:deviceId/firmware-override', () => {
      it('ไม่ส่ง Authorization -> 401', async () => {
        await makeDevice('FOV-401', 'installed');
        await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-401/firmware-override')
          .send({ firmwareId: randomUUID(), reason: 'x' })
          .expect(401);
      });

      it('role OT (ไม่มี grant device-firmware-override เลย — mirror config override) -> 403', async () => {
        await makeDevice('FOV-403', 'installed');
        const otUser = await makeUser(prisma, { role: 'OT' });
        await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-403/firmware-override')
          .set('Authorization', `Bearer ${tokenFor(otUser.id, 'OT')}`)
          .send({ firmwareId: randomUUID(), reason: 'x' })
          .expect(403);
      });

      it('deviceId ไม่พบ -> 404', async () => {
        const token = await stToken();
        const firmwareId = await makeFirmware();
        await request(app.getHttpServer())
          .post('/api/v1/devices/NOPE/firmware-override')
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId, reason: 'x' })
          .expect(404);
      });

      it('firmwareId ไม่พบ -> 404', async () => {
        await makeDevice('FOV-404', 'installed');
        const token = await stToken();
        await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-404/firmware-override')
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId: randomUUID(), reason: 'x' })
          .expect(404);
      });

      it('firmware ยังติดตั้งไม่ได้ (uploadStatus ยังไม่ stored) -> 409', async () => {
        await makeDevice('FOV-409U', 'installed');
        const token = await stToken();
        const firmwareId = await makeFirmware({ uploadStatus: 'pending' });
        await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-409U/firmware-override')
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId, reason: 'x' })
          .expect(409);
      });

      it('ST ส่งคำขอสำเร็จ -> 200 สถานะ pending + AuditLog device-firmware-override-request', async () => {
        await makeDevice('FOV-200', 'installed');
        const token = await stToken();
        const firmwareId = await makeFirmware();

        const res = await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-200/firmware-override')
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId, reason: 'ต้องใช้รุ่นเก่ากว่าเฉพาะเครื่องนี้' })
          .expect(200);

        const body = res.body as { status: string; versionNumber: number };
        expect(body.status).toBe('pending');
        expect(body.versionNumber).toBe(1);

        const audit = await prisma.auditLog.findFirst({
          where: {
            auditModule: 'device',
            action: 'device-firmware-override-request',
          },
        });
        expect(audit).not.toBeNull();
      });

      it('มีคำขอ pending ของอุปกรณ์นี้อยู่แล้ว -> 409', async () => {
        await makeDevice('FOV-409DUP', 'installed');
        const token = await stToken();
        const firmwareId = await makeFirmware();

        await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-409DUP/firmware-override')
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId, reason: 'รอบแรก' })
          .expect(200);

        await request(app.getHttpServer())
          .post('/api/v1/devices/FOV-409DUP/firmware-override')
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId, reason: 'รอบสอง' })
          .expect(409);
      });
    });

    describe('POST /device-firmware-overrides/:id/approve, /reject, GET /device-firmware-overrides', () => {
      async function setupPending(deviceId: string): Promise<{
        overrideId: string;
      }> {
        await makeDevice(deviceId, 'installed');
        const token = await stToken();
        const firmwareId = await makeFirmware();
        const res = await request(app.getHttpServer())
          .post(`/api/v1/devices/${deviceId}/firmware-override`)
          .set('Authorization', `Bearer ${token}`)
          .send({ firmwareId, reason: 'ทดสอบ' })
          .expect(200);
        return { overrideId: (res.body as { id: string }).id };
      }

      it('ไม่ส่ง Authorization -> 401 (approve)', async () => {
        const { overrideId } = await setupPending('FOV-APR-401');
        await request(app.getHttpServer())
          .post(`/api/v1/device-firmware-overrides/${overrideId}/approve`)
          .expect(401);
      });

      it('role ST (ไม่มีสิทธิ์อนุมัติ) -> 403', async () => {
        const { overrideId } = await setupPending('FOV-APR-403');
        const otUser = await makeUser(prisma, { role: 'OT' });
        await request(app.getHttpServer())
          .post(`/api/v1/device-firmware-overrides/${overrideId}/approve`)
          .set('Authorization', `Bearer ${tokenFor(otUser.id, 'OT')}`)
          .expect(403);
      });

      it('ไม่พบคำขอ -> 404', async () => {
        const opTok = await opToken();
        await request(app.getHttpServer())
          .post(`/api/v1/device-firmware-overrides/${randomUUID()}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(404);
      });

      it('Operation approve คำขอ pending -> 200 สถานะ approved + AuditLog device-firmware-override-approve', async () => {
        const { overrideId } = await setupPending('FOV-APR-200');
        const opTok = await opToken();

        const res = await request(app.getHttpServer())
          .post(`/api/v1/device-firmware-overrides/${overrideId}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(200);
        expect((res.body as { status: string }).status).toBe('approved');

        const audit = await prisma.auditLog.findFirst({
          where: {
            auditModule: 'device',
            action: 'device-firmware-override-approve',
          },
        });
        expect(audit).not.toBeNull();
      });

      it('Operation reject คำขอ pending พร้อม rejectReason -> 200 สถานะ rejected', async () => {
        const { overrideId } = await setupPending('FOV-REJ-200');
        const opTok = await opToken();

        const res = await request(app.getHttpServer())
          .post(`/api/v1/device-firmware-overrides/${overrideId}/reject`)
          .set('Authorization', `Bearer ${opTok}`)
          .send({ rejectReason: 'ไม่มีเหตุผลเพียงพอ' })
          .expect(200);

        const body = res.body as { status: string; rejectReason: string };
        expect(body.status).toBe('rejected');
        expect(body.rejectReason).toBe('ไม่มีเหตุผลเพียงพอ');
      });

      it('approve ซ้ำคำขอที่ตัดสินใจไปแล้ว -> 409', async () => {
        const { overrideId } = await setupPending('FOV-APR-409');
        const opTok = await opToken();
        await request(app.getHttpServer())
          .post(`/api/v1/device-firmware-overrides/${overrideId}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(200);

        await request(app.getHttpServer())
          .post(`/api/v1/device-firmware-overrides/${overrideId}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(409);
      });

      it('GET /device-firmware-overrides?status=pending -> คืนเฉพาะคำขอ pending', async () => {
        const { overrideId: pendingId } = await setupPending('FOV-LIST-1');
        const { overrideId: toApproveId } = await setupPending('FOV-LIST-2');
        const opTok = await opToken();
        await request(app.getHttpServer())
          .post(`/api/v1/device-firmware-overrides/${toApproveId}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(200);

        const res = await request(app.getHttpServer())
          .get('/api/v1/device-firmware-overrides?status=pending')
          .set('Authorization', `Bearer ${opTok}`)
          .expect(200);

        const ids = (res.body as { id: string }[]).map((o) => o.id);
        expect(ids).toContain(pendingId);
        expect(ids).not.toContain(toApproveId);
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

  describe('GET /devices/:deviceId/status (issue #245 เวอร์ชันย่อ)', () => {
    async function auditorToken(): Promise<string> {
      const user = await makeUser(prisma, { role: 'Auditor' });
      await grant('Auditor', ActionType.Read, 'devices');
      return tokenFor(user.id, 'Auditor');
    }

    it('ไม่ส่ง Authorization -> 401', async () => {
      await makeDevice('STAT-401', 'installed');

      await request(app.getHttpServer())
        .get('/api/v1/devices/STAT-401/status')
        .expect(401);
    });

    it('role ไม่มี devices.Read -> 403', async () => {
      const user = await makeUser(prisma, { role: 'ConfigEngineer' });
      await grant('ConfigEngineer', ActionType.Read, 'config');
      const token = tokenFor(user.id, 'ConfigEngineer');
      await makeDevice('STAT-403', 'installed');

      await request(app.getHttpServer())
        .get('/api/v1/devices/STAT-403/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('ไม่พบ deviceId -> 404', async () => {
      const token = await auditorToken();

      await request(app.getHttpServer())
        .get('/api/v1/devices/NOPE-STAT/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('ไม่เคยอยู่ใน CampaignRolloutTarget ไหนเลย -> unknown ทั้งคู่, lastCheckInMessage เป็น null', async () => {
      const token = await auditorToken();
      await makeDevice('STAT-UNKNOWN', 'installed');

      const res = await request(app.getHttpServer())
        .get('/api/v1/devices/STAT-UNKNOWN/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({
        deviceId: 'STAT-UNKNOWN',
        configStatus: 'unknown',
        firmwareStatus: 'unknown',
        configRolloutId: null,
        firmwareRolloutId: null,
        lastCheckInMessage: null,
        // docs/19 §4.3 — ไม่เคยติดต่อเข้ามาเลย
        lastSeenAt: null,
        online: false,
        pendingFirmwareOverride: null,
      });
    });

    it('เคยติดต่อมาเมื่อสักครู่ -> online true พร้อม lastSeenAt (docs/19 §4.3)', async () => {
      const token = await auditorToken();
      await makeDevice('STAT-ONLINE', 'installed');
      const seen = new Date(Date.now() - 30_000);
      await prisma.device.update({
        where: { deviceId: 'STAT-ONLINE' },
        data: { lastSeenAt: seen },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/devices/STAT-ONLINE/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { online: boolean; lastSeenAt: string };
      expect(body.online).toBe(true);
      expect(body.lastSeenAt).toBe(seen.toISOString());
    });

    it('มีคำขอ Firmware Override pending ของเครื่องนี้ -> pendingFirmwareOverride คืนแถวนั้น (แก้ตามรีวิว B บน PR #257)', async () => {
      const token = await auditorToken();
      await makeDevice('STAT-PENDING-FO', 'installed');
      const stUser = await makeUser(prisma, { role: 'ST' });
      const firmwareId = await makeFirmware();
      const override = await prisma.deviceFirmwareOverride.create({
        data: {
          deviceId: 'STAT-PENDING-FO',
          firmwareId,
          versionNumber: 1,
          reason: 'ทดสอบ',
          overriddenBy: stUser.id,
          status: 'pending',
        },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/devices/STAT-PENDING-FO/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as {
        pendingFirmwareOverride: {
          id: string;
          deviceId: string;
          firmwareId: string;
          status: string;
        } | null;
      };
      expect(body.pendingFirmwareOverride).toMatchObject({
        id: override.id,
        deviceId: 'STAT-PENDING-FO',
        firmwareId,
        status: 'pending',
      });
    });

    it('Config success + Firmware pending -> up_to_date / pending แยกกันถูกต้อง', async () => {
      const token = await auditorToken();
      await makeDevice('STAT-MIX', 'installed');
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const campaign = await prisma.campaign.create({
        data: { name: 'กลุ่มทดสอบ status', createdBy: opUser.id },
      });
      const configId = await makeConfig('approved');
      const configRollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          configId,
          status: 'completed',
          targetCount: 1,
          createdBy: opUser.id,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: {
          rolloutId: configRollout.id,
          deviceId: 'STAT-MIX',
          status: 'success',
        },
      });
      const firmwareId = await makeFirmware();
      const firmwareRollout = await prisma.campaignRollout.create({
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
        data: { rolloutId: firmwareRollout.id, deviceId: 'STAT-MIX' },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/devices/STAT-MIX/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toMatchObject({
        deviceId: 'STAT-MIX',
        configStatus: 'up_to_date',
        firmwareStatus: 'pending',
        // issue #243 — configRolloutId เป็น null เพราะ status ไม่ใช่ pending
        // (success แล้ว ไม่มี target ให้รายงานผลกลับอีก) ส่วน firmwareRolloutId
        // ต้องตรงกับ rollout ที่ยังรอผลจริง ให้ client ส่งกลับมาตอน confirm
        configRolloutId: null,
        firmwareRolloutId: firmwareRollout.id,
      });
    });

    it('rollout ที่ rejected ไม่นับ — target ค้าง pending ของรอบที่ reject แล้วไม่ทำให้เห็นเป็น pending ผิดๆ', async () => {
      const token = await auditorToken();
      await makeDevice('STAT-REJECTED', 'installed');
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const campaign = await prisma.campaign.create({
        data: { name: 'กลุ่มทดสอบ status rejected', createdBy: opUser.id },
      });
      const configId = await makeConfig('approved');
      const rejectedRollout = await prisma.campaignRollout.create({
        data: {
          campaignId: campaign.id,
          payloadType: 'Config',
          configId,
          status: 'rejected',
          targetCount: 1,
          createdBy: opUser.id,
        },
      });
      await prisma.campaignRolloutTarget.create({
        data: { rolloutId: rejectedRollout.id, deviceId: 'STAT-REJECTED' },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/devices/STAT-REJECTED/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toMatchObject({ configStatus: 'unknown' });
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

    it('มีคำขอ pending เก่าผูกกับ configId เดิม แล้ว Confirm Install ใหม่ทับเป็น Config อื่น -> ส่งคำขอใหม่กับ configId ปัจจุบันได้ ไม่ติด 409 (issue #226 ข้อ 3)', async () => {
      await makeDevice('DCO-STALE-PENDING', 'installed');
      const configIdOld = await makeConfig('approved');
      await makeCompletedTask('DCO-STALE-PENDING', configIdOld);
      await makeOverridableField('APN', true);
      const token = await stToken();

      // รอบแรก — ส่งคำขอ override ผูกกับ configIdOld (pending, ยังไม่มี
      // Operation ตัดสินใจ)
      await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-STALE-PENDING/config-override')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fields: { APN: 'apn-รอบแรก' },
          reason: 'รอบแรก (configId เก่า)',
        })
        .expect(200);

      // Confirm Install ใหม่ทับ -> Config ปัจจุบันของอุปกรณ์เปลี่ยนเป็น
      // configIdNew (Task completed ล่าสุด) — คำขอ pending รอบแรกที่ผูกกับ
      // configIdOld ตอนนี้ approve ไม่ได้แล้วในทางปฏิบัติ แต่ยังเป็นแถวจริง
      // ในตาราง (Operation ยังไม่ได้ reject)
      const configIdNew = await makeConfig('approved');
      await makeCompletedTask('DCO-STALE-PENDING', configIdNew);

      // รอบสอง — ส่งคำขอใหม่ผูกกับ configId ปัจจุบัน (configIdNew) ต้องผ่าน
      // ได้ ไม่ควรติด 409 จากคำขอเก่าที่ผูกกับ configId คนละตัวแล้ว
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-STALE-PENDING/config-override')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fields: { APN: 'apn-รอบสอง' },
          reason: 'รอบสอง (configId ใหม่)',
        })
        .expect(200);

      const body2 = res2.body as { configId: string; status: string };
      expect(body2.configId).toBe(configIdNew);
      expect(body2.status).toBe('pending');

      // ทั้ง 2 แถวต้องยังอยู่ในตาราง (คำขอเก่าไม่ได้ถูกลบ/reject อัตโนมัติ —
      // ตามมติ scope-by-configId ไม่ใช่ auto-reject)
      const overrides = await prisma.deviceConfigOverride.findMany({
        where: { deviceId: 'DCO-STALE-PENDING' },
        orderBy: { versionNumber: 'asc' },
      });
      expect(overrides).toHaveLength(2);
      expect(overrides[0].configId).toBe(configIdOld);
      expect(overrides[0].status).toBe('pending');
      expect(overrides[1].configId).toBe(configIdNew);
      expect(overrides[1].status).toBe('pending');

      // GET /config ต้องเห็น pendingOverride เป็นคำขอรอบสอง (configIdNew,
      // ปัจจุบัน) เท่านั้น — ไม่ใช่คำขอรอบแรกที่ตายไปแล้ว (bug fix comment A
      // บน PR #234: เดิมกรองแค่ deviceId ทำให้ orderBy versionNumber desc ได้
      // แถวไหนก็ได้ที่เป็น pending ล่าสุดของเครื่องนี้ ซึ่งบังเอิญถูกต้องกรณีนี้
      // เพราะรอบสองมี versionNumber สูงกว่าอยู่แล้ว — เทสถัดไปคุมกรณีที่มีแค่
      // คำขอเก่าอย่างเดียวแทน)
      const getRes = await request(app.getHttpServer())
        .get('/api/v1/devices/DCO-STALE-PENDING/config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const getBody = getRes.body as {
        pendingOverride: { configId: string; status: string } | null;
      };
      expect(getBody.pendingOverride?.configId).toBe(configIdNew);
    });

    it('bug fix (comment A บน PR #234): มีแค่คำขอ pending เก่าผูกกับ configId ที่ไม่ใช่ปัจจุบันแล้ว -> GET /config เห็น pendingOverride:null (ไม่ใช่แถวเก่าที่ approve ไม่ได้แล้ว)', async () => {
      await makeDevice('DCO-STALE-ONLY', 'installed');
      const configIdOld = await makeConfig('approved');
      await makeCompletedTask('DCO-STALE-ONLY', configIdOld);
      await makeOverridableField('APN', true);
      const token = await stToken();

      // ส่งคำขอ override ผูกกับ configIdOld (pending, ยังไม่มี Operation
      // ตัดสินใจ)
      await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-STALE-ONLY/config-override')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fields: { APN: 'apn-เก่า' },
          reason: 'ก่อน Confirm Install ใหม่',
        })
        .expect(200);

      // Confirm Install ใหม่ทับ -> Config ปัจจุบันเปลี่ยนเป็น configIdNew —
      // คำขอ pending ข้างบนตอนนี้ approve ไม่ได้แล้ว (ดู
      // approveDeviceConfigOverride ที่เช็ค configId staleness) แต่ยังไม่มี
      // ใครส่งคำขอใหม่/reject คำขอเก่าเลย
      const configIdNew = await makeConfig('approved');
      await makeCompletedTask('DCO-STALE-ONLY', configIdNew);

      // เดิม (บั๊ก) จุดนี้จะคืนคำขอเก่าเป็น pendingOverride ทำให้ Mobile ขึ้น
      // banner "มีคำขอรออนุมัติ" หลอกๆ ทั้งที่ ST ส่งคำขอใหม่ได้เลย
      const getRes = await request(app.getHttpServer())
        .get('/api/v1/devices/DCO-STALE-ONLY/config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const getBody = getRes.body as { pendingOverride: unknown };
      expect(getBody.pendingOverride).toBeNull();
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

    it('Notification flow (issue #226) — pending แจ้ง Operation, approve แจ้ง ST ผู้ request จริงผ่าน DB', async () => {
      await makeDevice('DCO-NOTIFY-APPROVE', 'installed');
      const configId = await makeConfig('approved');
      await makeCompletedTask('DCO-NOTIFY-APPROVE', configId);
      await makeOverridableField('APN', true);
      await grantStOnce();
      const stUser = await makeUser(prisma, { role: 'ST' });
      const stTok = tokenFor(stUser.id, 'ST');
      await grantOpOnce();
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const opTok = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-NOTIFY-APPROVE/config-override')
        .set('Authorization', `Bearer ${stTok}`)
        .send({ fields: { APN: 'new-apn' }, reason: 'ทดสอบ notification' })
        .expect(200);
      const override = res.body as { id: string };

      // Operation ต้องได้รับ notification ว่ามีคำขอ pending ใหม่
      const pendingNotification = await prisma.notification.findFirstOrThrow({
        where: { userId: opUser.id, type: 'config_override_pending' },
      });
      expect(
        (pendingNotification.payload as { overrideId: string }).overrideId,
      ).toBe(override.id);

      await request(app.getHttpServer())
        .post(`/api/v1/device-config-overrides/${override.id}/approve`)
        .set('Authorization', `Bearer ${opTok}`)
        .expect(200);

      // ST ผู้ request ต้องได้รับ notification ว่า Operation อนุมัติแล้ว
      const approvedNotification = await prisma.notification.findFirstOrThrow({
        where: { userId: stUser.id, type: 'config_override_approved' },
      });
      expect(
        (approvedNotification.payload as { overrideId: string }).overrideId,
      ).toBe(override.id);
    });

    it('Notification flow (issue #226) — reject แจ้ง ST ผู้ request พร้อม rejectReason จริงผ่าน DB', async () => {
      await makeDevice('DCO-NOTIFY-REJECT', 'installed');
      const configId = await makeConfig('approved');
      await makeCompletedTask('DCO-NOTIFY-REJECT', configId);
      await makeOverridableField('APN', true);
      await grantStOnce();
      const stUser = await makeUser(prisma, { role: 'ST' });
      const stTok = tokenFor(stUser.id, 'ST');
      const opTok = await opToken();

      const res = await request(app.getHttpServer())
        .post('/api/v1/devices/DCO-NOTIFY-REJECT/config-override')
        .set('Authorization', `Bearer ${stTok}`)
        .send({ fields: { APN: 'new-apn' }, reason: 'ทดสอบ notification' })
        .expect(200);
      const override = res.body as { id: string };

      await request(app.getHttpServer())
        .post(`/api/v1/device-config-overrides/${override.id}/reject`)
        .set('Authorization', `Bearer ${opTok}`)
        .send({ rejectReason: 'ค่าไม่เหมาะสม' })
        .expect(200);

      const rejectedNotification = await prisma.notification.findFirstOrThrow({
        where: { userId: stUser.id, type: 'config_override_rejected' },
      });
      const payload = rejectedNotification.payload as {
        overrideId: string;
        rejectReason: string;
      };
      expect(payload.overrideId).toBe(override.id);
      expect(payload.rejectReason).toBe('ค่าไม่เหมาะสม');
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

    describe('docs/30 — โหมด central: Override ส่งผ่านคำขอส่งเข้ากล่อง', () => {
      const previousMode = process.env.DEVICE_CONFIG_APPLY_MODE;
      beforeEach(() => {
        process.env.DEVICE_CONFIG_APPLY_MODE = 'central';
      });
      afterEach(() => {
        // กำหนด undefined ตรงๆ จะได้สตริง "undefined" (CI ไม่ตั้ง env นี้)
        if (previousMode === undefined) {
          delete process.env.DEVICE_CONFIG_APPLY_MODE;
        } else {
          process.env.DEVICE_CONFIG_APPLY_MODE = previousMode;
        }
      });

      /** Config ที่อนุมัติแล้วโดย Operation อีกคน (SoD ข้อ Config.approvedBy) +
       * Task completed เป็น base ของเครื่อง + field ที่ช่างแก้ได้ */
      async function setupCentralDevice(deviceId: string): Promise<{
        configId: string;
        stTok: string;
        stId: string;
        opTok: string;
      }> {
        await makeDevice(deviceId, 'installed');
        const configApprover = await makeUser(prisma, { role: 'Operation' });
        const configId = await makeConfig('approved');
        await prisma.config.update({
          where: { id: configId },
          data: { approvedBy: configApprover.id },
        });
        await makeCompletedTask(deviceId, configId);
        await makeOverridableField('APN', true);
        await grantStOnce();
        await grantOpOnce();
        await grant('Operation', ActionType.Approve, 'config-apply-request');
        const st = await makeUser(prisma, { role: 'ST' });
        const op = await makeUser(prisma, { role: 'Operation' });
        return {
          configId,
          stTok: tokenFor(st.id, 'ST'),
          stId: st.id,
          opTok: tokenFor(op.id, 'Operation'),
        };
      }

      async function submit(
        deviceId: string,
        stTok: string,
      ): Promise<{ id: string }> {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/devices/${deviceId}/config-override`)
          .set('Authorization', `Bearer ${stTok}`)
          .send({
            fields: { APN: 'apn-central' },
            reason: 'ลูกค้าขอเปลี่ยน APN',
          })
          .expect(200);
        return res.body as { id: string };
      }

      it('ส่งตรง (direct): Config ที่อนุมัติแล้วไม่แก้ค่า -> คำขอ approved ทันที ไม่มีผู้อนุมัติ · applyOptions บอกค่าของแต่ละ Config', async () => {
        const { configId, stId } = await setupCentralDevice('DCO-C-DIRECT');
        const actor = { id: stId, role: 'ST' };
        const { task } = await app
          .get(TaskService)
          .start({ deviceId: 'DCO-C-DIRECT' }, actor);
        const service = app.get(ConfigApplyRequestService);

        const options = await service.applyOptions('DCO-C-DIRECT', actor);
        expect(options.configs.find((c) => c.id === configId)?.fields).toEqual({
          APN: 'internet',
        });

        const created = await service.create(
          task.id,
          { configId, direct: true },
          actor,
        );
        expect(created).toMatchObject({
          configId,
          status: 'approved',
          decidedBy: null,
        });
        expect(created.approvedConfigVersion).not.toBeNull();
        const audit = await prisma.auditLog.findFirst({
          where: { userId: stId, action: 'config_apply_direct' },
        });
        expect(audit).not.toBeNull();
      });

      it('เลือก Config อื่นแล้วแก้ค่า (configId) -> Override + คำขอ pending ผูกกับ Config ที่เลือก', async () => {
        const { stTok } = await setupCentralDevice('DCO-C-PICK');
        const otherConfig = await makeConfig('approved');

        const res = await request(app.getHttpServer())
          .post('/api/v1/devices/DCO-C-PICK/config-override')
          .set('Authorization', `Bearer ${stTok}`)
          .send({
            fields: { APN: 'apn-picked' },
            reason: 'ใช้ Config อื่นแต่แก้ APN',
            configId: otherConfig,
          })
          .expect(200);

        expect(res.body).toMatchObject({
          configId: otherConfig,
          status: 'pending',
        });
        const requests = await prisma.configApplyRequest.findMany({
          where: { deviceId: 'DCO-C-PICK' },
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          configId: otherConfig,
          status: 'pending',
          overrideId: (res.body as { id: string }).id,
        });
      });

      it('ช่างขอ Override -> เริ่มงานให้ + สร้างคำขอ pending ผูก Override (แถวเดียว) · คิว Override ไม่แสดงซ้ำ · อนุมัติ Override ตรงๆ ได้ 409', async () => {
        const { configId, stTok, stId, opTok } =
          await setupCentralDevice('DCO-C-FLOW');

        const override = await submit('DCO-C-FLOW', stTok);

        const requests = await prisma.configApplyRequest.findMany({
          where: { deviceId: 'DCO-C-FLOW' },
          include: { task: true },
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          kind: 'config',
          configId,
          overrideId: override.id,
          status: 'pending',
          requestedBy: stId,
        });
        expect(requests[0].task).toMatchObject({
          assignedTo: stId,
          deviceId: 'DCO-C-FLOW',
          status: 'in_progress',
        });

        const list = await request(app.getHttpServer())
          .get('/api/v1/device-config-overrides?status=pending')
          .set('Authorization', `Bearer ${opTok}`)
          .expect(200);
        expect((list.body as { id: string }[]).map((o) => o.id)).not.toContain(
          override.id,
        );

        await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${override.id}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(409);
        await request(app.getHttpServer())
          .post(`/api/v1/device-config-overrides/${override.id}/reject`)
          .set('Authorization', `Bearer ${opTok}`)
          .send({ rejectReason: 'x' })
          .expect(409);
      });

      it('Operation อนุมัติคำขอ -> Override อนุมัติด้วยในครั้งเดียว', async () => {
        const { stTok, opTok } = await setupCentralDevice('DCO-C-APPROVE');
        const override = await submit('DCO-C-APPROVE', stTok);
        const car = await prisma.configApplyRequest.findUniqueOrThrow({
          where: { overrideId: override.id },
        });

        await request(app.getHttpServer())
          .post(`/api/v1/config-apply-requests/${car.id}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(200);

        const [after, ov] = await Promise.all([
          prisma.configApplyRequest.findUniqueOrThrow({
            where: { id: car.id },
          }),
          prisma.deviceConfigOverride.findUniqueOrThrow({
            where: { id: override.id },
          }),
        ]);
        expect(after.status).toBe('approved');
        expect(ov.status).toBe('approved');
        expect(ov.decidedBy).toBe(after.decidedBy);
      });

      it('ช่างปิดงานขณะคำขอยัง pending -> คำขอ cancelled + Override ปิดเป็น rejected (ไม่ค้าง pending)', async () => {
        const { stTok, stId } = await setupCentralDevice('DCO-C-CLOSE');
        const override = await submit('DCO-C-CLOSE', stTok);
        const car = await prisma.configApplyRequest.findUniqueOrThrow({
          where: { overrideId: override.id },
        });

        // เส้นทางเดียวกับ PATCH /tasks/{id} (TaskController → TaskService.update)
        await app
          .get(TaskService)
          .update(
            car.taskId,
            { status: 'completed' },
            { id: stId, role: 'ST' },
          );

        const [after, ov] = await Promise.all([
          prisma.configApplyRequest.findUniqueOrThrow({
            where: { id: car.id },
          }),
          prisma.deviceConfigOverride.findUniqueOrThrow({
            where: { id: override.id },
          }),
        ]);
        expect(after.status).toBe('cancelled');
        expect(ov).toMatchObject({
          status: 'rejected',
          rejectReason: 'ช่างปิดงานแล้ว ระบบยกเลิกคำขอให้อัตโนมัติ',
          decidedBy: null,
        });
        expect(ov.decidedAt).not.toBeNull();
      });

      it('ช่างปิดงานหลังคำขออนุมัติแล้ว -> คำขอ cancelled แต่ Override คง approved', async () => {
        const { stTok, stId, opTok } =
          await setupCentralDevice('DCO-C-CLOSE-OK');
        const override = await submit('DCO-C-CLOSE-OK', stTok);
        const car = await prisma.configApplyRequest.findUniqueOrThrow({
          where: { overrideId: override.id },
        });
        await request(app.getHttpServer())
          .post(`/api/v1/config-apply-requests/${car.id}/approve`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(200);

        await app
          .get(TaskService)
          .update(
            car.taskId,
            { status: 'completed' },
            { id: stId, role: 'ST' },
          );

        const [after, ov] = await Promise.all([
          prisma.configApplyRequest.findUniqueOrThrow({
            where: { id: car.id },
          }),
          prisma.deviceConfigOverride.findUniqueOrThrow({
            where: { id: override.id },
          }),
        ]);
        expect(after.status).toBe('cancelled');
        expect(ov.status).toBe('approved');
      });

      it('Operation ปฏิเสธคำขอ -> Override ถูกปิดเป็น rejected ด้วยเหตุผลเดียวกัน', async () => {
        const { stTok, opTok } = await setupCentralDevice('DCO-C-REJECT');
        const override = await submit('DCO-C-REJECT', stTok);
        const car = await prisma.configApplyRequest.findUniqueOrThrow({
          where: { overrideId: override.id },
        });

        await request(app.getHttpServer())
          .post(`/api/v1/config-apply-requests/${car.id}/reject`)
          .set('Authorization', `Bearer ${opTok}`)
          .send({ rejectReason: 'ค่าไม่ตรงสัญญา' })
          .expect(200);

        const ov = await prisma.deviceConfigOverride.findUniqueOrThrow({
          where: { id: override.id },
        });
        expect(ov).toMatchObject({
          status: 'rejected',
          rejectReason: 'ค่าไม่ตรงสัญญา',
        });
      });

      it('เครื่องมีคำขอส่งเข้ากล่องค้างอยู่ -> 409 และไม่เหลือ Override ค้าง (rollback ทั้งทรานแซกชัน)', async () => {
        const { stTok, stId } = await setupCentralDevice('DCO-C-OPEN');
        const task = await prisma.task.create({
          data: {
            title: 'งานค้าง',
            assignedTo: stId,
            deviceId: 'DCO-C-OPEN',
            status: 'in_progress',
          },
        });
        const otherConfig = await makeConfig('approved');
        await prisma.configApplyRequest.create({
          data: {
            taskId: task.id,
            deviceId: 'DCO-C-OPEN',
            kind: 'config',
            configId: otherConfig,
            requestedBy: stId,
            expiresAt: new Date(Date.now() + 3600_000),
          },
        });

        await request(app.getHttpServer())
          .post('/api/v1/devices/DCO-C-OPEN/config-override')
          .set('Authorization', `Bearer ${stTok}`)
          .send({ fields: { APN: 'apn-central' }, reason: 'ลองซ้ำ' })
          .expect(409);

        expect(
          await prisma.deviceConfigOverride.count({
            where: { deviceId: 'DCO-C-OPEN' },
          }),
        ).toBe(0);
      });

      it('ค่าตัวเลขนอกช่วง minValue/maxValue -> 400 ไม่สร้างอะไร', async () => {
        const { stTok } = await setupCentralDevice('DCO-C-RANGE');
        await prisma.configFieldDefinition.create({
          data: {
            fieldName: 'speed_limit.max_kmh',
            dataType: 'integer',
            allowedValues: [],
            required: false,
            stOverridable: true,
            unit: 'km/h',
            minValue: 1,
            maxValue: 200,
            supportedModels: {
              create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
            },
          },
        });

        await request(app.getHttpServer())
          .post('/api/v1/devices/DCO-C-RANGE/config-override')
          .set('Authorization', `Bearer ${stTok}`)
          .send({ fields: { 'speed_limit.max_kmh': 250 }, reason: 'เกินช่วง' })
          .expect(400);

        expect(
          await prisma.configApplyRequest.count({
            where: { deviceId: 'DCO-C-RANGE' },
          }),
        ).toBe(0);
      });
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
  describe('GET /devices/:deviceId/history', () => {
    async function readerToken(role: RoleCode = 'ST'): Promise<string> {
      const user = await makeUser(prisma, { role });
      await grant(role, ActionType.Read, 'devices');
      return tokenFor(user.id, role);
    }

    it('ไม่ส่ง Authorization -> 401', async () => {
      await makeDevice('HIS-401', 'installed');
      await request(app.getHttpServer())
        .get('/api/v1/devices/HIS-401/history')
        .expect(401);
    });

    it('ไม่พบเครื่อง -> 404', async () => {
      const token = await readerToken();
      await request(app.getHttpServer())
        .get('/api/v1/devices/NOPE/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it.each([
      ['limit เกิน 100', 'limit=101'],
      ['limit เป็น 0', 'limit=0'],
      ['ชนิดที่ไม่รู้จัก', 'types=rollout,whatever'],
      ['cursor รูปแบบผิด', 'before=not-a-cursor'],
    ])('query ไม่ถูกต้อง (%s) -> 400', async (_name, qs) => {
      const token = await readerToken();
      await makeDevice('HIS-400', 'installed');
      await request(app.getHttpServer())
        .get(`/api/v1/devices/HIS-400/history?${qs}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('เครื่องใหม่ที่ยังไม่มีเหตุการณ์ใด: มีแค่ลงทะเบียน และสรุปเป็น null ไม่ 404', async () => {
      const token = await readerToken();
      await makeDevice('HIS-NEW', 'registered');

      const res = await request(app.getHttpServer())
        .get('/api/v1/devices/HIS-NEW/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as {
        summary: { currentConfig: unknown; currentFirmware: unknown };
        items: { type: string; status: string }[];
        nextCursor: string | null;
      };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        type: 'lifecycle',
        status: 'registered',
      });
      expect(body.summary).toEqual({
        currentConfig: null,
        currentFirmware: null,
      });
      expect(body.nextCursor).toBeNull();
    });

    it('รวม Task, คำขอแก้ค่า, Incident และ Rollout ของเครื่องนี้ ไม่ปนเครื่องอื่น และเรียงใหม่ไปเก่า', async () => {
      const token = await readerToken('Operation');
      await makeDevice('HIS-A', 'installed');
      await makeDevice('HIS-B', 'installed');
      const configId = await makeConfig('approved');
      const st = await makeUser(prisma, { role: 'ST' });
      const op = await makeUser(prisma, { role: 'Operation' });

      await prisma.task.create({
        data: {
          title: 'ติดตั้ง Config',
          assignedTo: st.id,
          deviceId: 'HIS-A',
          configId,
          status: 'completed',
        },
      });
      await prisma.task.create({
        data: { title: 'ของเครื่องอื่น', assignedTo: st.id, deviceId: 'HIS-B' },
      });
      await prisma.deviceConfigOverride.create({
        data: {
          deviceId: 'HIS-A',
          configId,
          versionNumber: 1,
          fields: { APN: 'x' },
          reason: 'รถจอดนาน',
          status: 'approved',
          overriddenBy: st.id,
          decidedBy: op.id,
          decidedAt: new Date(),
        },
      });
      await prisma.incident.create({
        data: {
          title: 'เครื่องรีบูต',
          severity: 'high',
          status: 'open',
          source: 'field-report',
          reportedBy: st.id,
          deviceId: 'HIS-A',
        },
      });
      // Incident จาก Rollout ที่เครื่องนี้อยู่ในรายชื่อเครื่องที่ล้ม (ไม่ได้ผูก deviceId ตรงๆ)
      await prisma.incident.create({
        data: {
          title: 'Rollout ล้มเหลว',
          severity: 'high',
          status: 'open',
          source: 'rollout-failure',
          metadata: { failedDeviceIds: ['HIS-A', 'HIS-Z'], failureCount: 2 },
        },
      });
      // Incident จาก Rollout ที่เครื่องนี้ไม่อยู่ในรายชื่อ ต้องไม่โผล่
      await prisma.incident.create({
        data: {
          title: 'Rollout อื่น',
          severity: 'low',
          status: 'open',
          source: 'rollout-failure',
          metadata: { failedDeviceIds: ['HIS-B'], failureCount: 1 },
        },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/devices/HIS-A/history')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as {
        items: {
          id: string;
          type: string;
          title: string | null;
          occurredAt: string;
          config: { name: string } | null;
          decision: { byId: string | null } | null;
        }[];
      };
      const titles = body.items.map((i) => i.title ?? i.type);
      expect(titles).toEqual(
        expect.arrayContaining([
          'ติดตั้ง Config',
          'เครื่องรีบูต',
          'Rollout ล้มเหลว',
          'config-override',
          'lifecycle',
        ]),
      );
      expect(titles).not.toContain('ของเครื่องอื่น');
      expect(titles).not.toContain('Rollout อื่น');

      // เรียงใหม่ไปเก่า
      const times = body.items.map((i) => i.occurredAt);
      expect([...times].sort().reverse()).toEqual(times);

      const task = body.items.find((i) => i.title === 'ติดตั้ง Config');
      expect(task?.config?.name).toMatch(/^cfg-/);
      const override = body.items.find((i) => i.type === 'config-override');
      expect(override?.decision?.byId).toBe(op.id);
    });

    it('กรองตามสิทธิ์ของ actor (แก้ครั้งที่ 97): ST เห็นแค่งาน/คำขอ override ของตัวเอง, QAEngineer ไม่เห็น task เลย', async () => {
      await makeDevice('HIS-SCOPE', 'installed');
      const configId = await makeConfig('approved');
      const stOwner = await makeUser(prisma, { role: 'ST' });
      const stOther = await makeUser(prisma, { role: 'ST' });
      const op = await makeUser(prisma, { role: 'Operation' });

      await prisma.task.create({
        data: {
          title: 'งานของ stOwner',
          assignedTo: stOwner.id,
          deviceId: 'HIS-SCOPE',
        },
      });
      await prisma.deviceConfigOverride.create({
        data: {
          deviceId: 'HIS-SCOPE',
          configId,
          versionNumber: 1,
          fields: { APN: 'x' },
          reason: 'ของ stOwner',
          status: 'pending',
          overriddenBy: stOwner.id,
        },
      });

      const ownerToken = tokenFor(stOwner.id, 'ST');
      const otherToken = tokenFor(stOther.id, 'ST');
      await grant('ST', ActionType.Read, 'devices');
      await grant('Operation', ActionType.Read, 'devices');
      const qaToken = await readerToken('QAEngineer');

      const ownerRes = await request(app.getHttpServer())
        .get('/api/v1/devices/HIS-SCOPE/history')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      const ownerTitles = (
        ownerRes.body as { items: { title: string | null; type: string }[] }
      ).items.map((i) => i.title ?? i.type);
      expect(ownerTitles).toContain('งานของ stOwner');
      expect(ownerTitles).toContain('config-override');

      const otherRes = await request(app.getHttpServer())
        .get('/api/v1/devices/HIS-SCOPE/history')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);
      const otherTitles = (
        otherRes.body as { items: { title: string | null; type: string }[] }
      ).items.map((i) => i.title ?? i.type);
      expect(otherTitles).not.toContain('งานของ stOwner');
      expect(otherTitles).not.toContain('config-override');

      const qaRes = await request(app.getHttpServer())
        .get('/api/v1/devices/HIS-SCOPE/history')
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(200);
      const qaTitles = (
        qaRes.body as { items: { title: string | null; type: string }[] }
      ).items.map((i) => i.title ?? i.type);
      expect(qaTitles).not.toContain('งานของ stOwner');

      // Operation เห็นทุกอย่างไม่ว่าใครเป็นคนทำ
      const opToken = tokenFor(op.id, 'Operation');
      const opRes = await request(app.getHttpServer())
        .get('/api/v1/devices/HIS-SCOPE/history')
        .set('Authorization', `Bearer ${opToken}`)
        .expect(200);
      const opTitles = (
        opRes.body as { items: { title: string | null; type: string }[] }
      ).items.map((i) => i.title ?? i.type);
      expect(opTitles).toContain('งานของ stOwner');
      expect(opTitles).toContain('config-override');
    });

    it('ชนิดที่ขอ (types) และแบ่งหน้าด้วย cursor: ไม่ข้ามและไม่ซ้ำ', async () => {
      // ใช้ Operation (เห็นงานของทุกคน) ไม่ใช่ ST ค่าเริ่มต้นของ readerToken()
      // — เทสนี้ทดสอบ pagination/cursor ไม่ใช่การกรองสิทธิ์ (แก้ครั้งที่ 97
      // ทำให้ ST ที่ไม่ใช่ `assignedTo` ของ Task เหล่านี้เห็นเป็นรายการว่าง)
      const token = await readerToken('Operation');
      await makeDevice('HIS-P', 'installed');
      const st = await makeUser(prisma, { role: 'ST' });
      for (let i = 0; i < 5; i += 1) {
        await prisma.task.create({
          data: {
            title: `งาน ${i}`,
            assignedTo: st.id,
            deviceId: 'HIS-P',
            updatedAt: new Date(Date.UTC(2026, 9, 10, 0, 0, i)),
          },
        });
      }

      const first = await request(app.getHttpServer())
        .get('/api/v1/devices/HIS-P/history?types=task&limit=3')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const firstBody = first.body as {
        items: { title: string }[];
        nextCursor: string | null;
      };
      expect(firstBody.items.map((i) => i.title)).toEqual([
        'งาน 4',
        'งาน 3',
        'งาน 2',
      ]);
      expect(firstBody.nextCursor).not.toBeNull();

      const second = await request(app.getHttpServer())
        .get(
          `/api/v1/devices/HIS-P/history?types=task&limit=3&before=${encodeURIComponent(firstBody.nextCursor!)}`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const secondBody = second.body as {
        items: { title: string }[];
        nextCursor: string | null;
      };
      expect(secondBody.items.map((i) => i.title)).toEqual(['งาน 1', 'งาน 0']);
      expect(secondBody.nextCursor).toBeNull();
    });
  });
});
