import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
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
  ): Promise<void> {
    await prisma.device.create({
      data: {
        deviceId,
        simNumber: `sim-${deviceId}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status,
      },
    });
  }

  it('ไม่ส่ง Authorization header -> 401', async () => {
    await makeDevice('DTC-401', 'installed');

    await request(app.getHttpServer())
      .post('/api/v1/devices/DTC-401/test-connection')
      .expect(401);
  });

  it('role ไม่มีสิทธิ์ device-connection-test.Read (SW) -> 403', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    // SW มีสิทธิ์อื่นเยอะ แต่ไม่มี device-connection-test
    await grant('SW', ActionType.Read, 'config-simulation');
    await makeDevice('DTC-403A', 'installed');
    const token = tokenFor(swUser.id, 'SW');

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
});
