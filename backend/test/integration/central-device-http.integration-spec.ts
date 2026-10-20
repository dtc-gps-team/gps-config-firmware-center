import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { CentralDeviceModule } from '../../src/central-device/central-device.module';
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
// เทสนี้ทดสอบโหมด mock เท่านั้น (ไม่ต่อเครือข่าย)
process.env.CENTRAL_MODE = 'mock';

/**
 * GET /central/status, /central/devices, /devices/:deviceId/central
 * ผ่าน HTTP จริง (JwtAuthGuard -> PermissionGuard) ในโหมด mock
 */
describe('CentralDeviceController (integration — mock mode + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        CentralDeviceModule,
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

  async function readerToken(role: RoleCode = 'Operation'): Promise<string> {
    const user = await makeUser(prisma, { role });
    const r = await getOrCreateRole(prisma, role);
    await prisma.rolePermission.create({
      data: { roleId: r.id, resource: 'devices', action: ActionType.Read },
    });
    return jwtService.sign({ sub: user.id, role });
  }

  it.each([
    '/api/v1/central/status',
    '/api/v1/central/devices',
    '/api/v1/devices/DEV-0001/central',
  ])('ไม่ส่ง Authorization -> 401 (%s)', async (url) => {
    await request(app.getHttpServer()).get(url).expect(401);
  });

  it('login แล้วแต่ไม่มีสิทธิ์ devices Read -> 403', async () => {
    const user = await makeUser(prisma, { role: 'Auditor' });
    await getOrCreateRole(prisma, 'Auditor');
    const token = jwtService.sign({ sub: user.id, role: 'Auditor' });
    await request(app.getHttpServer())
      .get('/api/v1/central/devices')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('GET /central/status: โหมด mock ติดต่อได้เสมอ', async () => {
    const token = await readerToken();
    const res = await request(app.getHttpServer())
      .get('/api/v1/central/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toMatchObject({
      mode: 'mock',
      reachable: true,
      error: null,
    });
  });

  it('GET /central/devices: รายการตัวอย่างเรียงตาม deviceId', async () => {
    const token = await readerToken();
    const res = await request(app.getHttpServer())
      .get('/api/v1/central/devices')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as {
      mode: string;
      devices: { deviceId: string; online: boolean }[];
    };
    expect(body.mode).toBe('mock');
    expect(body.devices.map((d) => d.deviceId)).toEqual([
      'DEV-0001',
      'DEV-0002',
      'ESP32-DEMO-01',
    ]);
    expect(body.devices.map((d) => d.online)).toEqual([true, false, true]);
  });

  it('GET /devices/:deviceId/central: เครื่องที่รู้จักได้ข้อมูล ส่วนเครื่องที่ไม่รู้จักได้ device=null (ไม่ 404)', async () => {
    const token = await readerToken('ST');
    const known = await request(app.getHttpServer())
      .get('/api/v1/devices/DEV-0001/central')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(known.body).toMatchObject({
      reachable: true,
      device: { deviceId: 'DEV-0001', online: true, registered: true },
    });

    const unknown = await request(app.getHttpServer())
      .get('/api/v1/devices/NOT-IN-CENTRAL/central')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(unknown.body).toMatchObject({ reachable: true, device: null });
  });
});
