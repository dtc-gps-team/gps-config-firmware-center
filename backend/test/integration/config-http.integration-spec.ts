import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigModule } from '../../src/config/config.module';
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
// ไปที่ DB _test เดียวกับที่ integration test อื่นใช้ (เหมือน task-http.integration-spec.ts)
process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * Stage 1-4 (issue #26) — CRUD พื้นฐาน + Import JSON + Simulate +
 * decide/approve/reject ของ ConfigController ผ่าน HTTP จริง (JwtAuthGuard ->
 * PermissionGuard เต็มเส้นทาง)
 */
describe('ConfigController Stage 1-4 CRUD + Import + Simulate + Decide/Approve/Reject (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // ConfigModule (business) ต้องมี NestConfigModule ในกราฟด้วย — ปกติได้
      // มาฟรีตอนรันแอปจริงผ่าน AppModule (ที่เรียก
      // NestConfigModule.forRoot({ isGlobal: true }) ไว้แล้ว) แต่เทสนี้ import
      // แค่ ConfigModule เดี่ยวๆ ไม่ผ่าน AppModule เลย เลยต้อง forRoot() เองที่นี่
      // ไม่งั้น DEVICE_SIMULATOR provider (useFactory ที่ inject
      // @nestjs/config ConfigService) จะ resolve dependency ไม่ได้ — ไม่ต้องตั้ง
      // envFilePath เพราะเทสนี้ไม่ได้พึ่งค่าจริงจาก .env (DEVICE_SIMULATOR_MODE
      // ใช้ default 'mock' อยู่แล้ว)
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        ConfigModule,
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
    // RolePermission ต้อง clean ทุกเทส (pattern เดียวกับ
    // permission-guard-http.integration-spec.ts) เพราะ seed.ts ไม่ได้รันก่อนเทส
    await prisma.rolePermission.deleteMany();
  });

  function tokenFor(sub: string, role: string): string {
    return jwtService.sign({ sub, role });
  }

  async function grant(
    roleCode: RoleCode,
    action: ActionType,
    resource = 'config',
  ): Promise<void> {
    const role = await getOrCreateRole(prisma, roleCode);
    await prisma.rolePermission.create({
      data: { roleId: role.id, resource, action },
    });
  }

  it('POST /config ไม่ส่ง Authorization header -> 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/config')
      .send({ deviceModel: 'GT06N', protocol: 'TCP', fields: {} })
      .expect(401);
  });

  it('POST /config role ไม่มีสิทธิ์ config.Create -> 403', async () => {
    const opUser = await makeUser(prisma, { role: 'Operation' });
    const token = tokenFor(opUser.id, 'Operation');

    await request(app.getHttpServer())
      .post('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceModel: 'GT06N', protocol: 'TCP', fields: {} })
      .expect(403);
  });

  it('POST /config role SW มีสิทธิ์ config.Create -> 201 พร้อม createdBy จาก JWT', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Create);
    const token = tokenFor(swUser.id, 'SW');

    const res = await request(app.getHttpServer())
      .post('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: { APN1: 'internet' },
      })
      .expect(201);

    const body = res.body as { createdBy: string; status: string };
    expect(body.createdBy).toBe(swUser.id);
    expect(body.status).toBe('draft');
  });

  it('POST /config/import role ไม่มีสิทธิ์ config.Create -> 403', async () => {
    const opUser = await makeUser(prisma, { role: 'Operation' });
    const token = tokenFor(opUser.id, 'Operation');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach(
        'file',
        Buffer.from(
          JSON.stringify({ deviceModel: 'GT06N', protocol: 'TCP', fields: {} }),
        ),
        'config.json',
      )
      .expect(403);
  });

  it('POST /config/import ไฟล์ JSON ถูกต้อง -> 201 พร้อม createdBy จาก JWT (flow เดียวกับฟอร์ม)', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Create);
    const token = tokenFor(swUser.id, 'SW');

    const res = await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach(
        'file',
        Buffer.from(
          JSON.stringify({
            deviceModel: 'GT06N',
            protocol: 'TCP',
            fields: { APN1: 'internet' },
          }),
        ),
        'config.json',
      )
      .expect(201);

    const body = res.body as {
      createdBy: string;
      status: string;
      deviceModel: string;
    };
    expect(body.createdBy).toBe(swUser.id);
    expect(body.status).toBe('draft');
    expect(body.deviceModel).toBe('GT06N');
  });

  it('POST /config/import เนื้อไฟล์เป็น JSON null -> 400 ไม่ใช่ 500', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Create);
    const token = tokenFor(swUser.id, 'SW');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach('file', Buffer.from('null'), 'config.json')
      .expect(400);
  });

  it('POST /config/import เนื้อไฟล์เป็น JSON array -> 400', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Create);
    const token = tokenFor(swUser.id, 'SW');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach(
        'file',
        Buffer.from(JSON.stringify([{ deviceModel: 'GT06N' }])),
        'config.json',
      )
      .expect(400);
  });

  it('POST /config/import format ไม่ใช่ json -> 400', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Create);
    const token = tokenFor(swUser.id, 'SW');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'csv')
      .attach(
        'file',
        Buffer.from('deviceModel,protocol\nGT06N,TCP'),
        'config.csv',
      )
      .expect(400);
  });

  it('POST /config/import ไฟล์ไม่ใช่ JSON ที่ถูกต้อง (parse ไม่ผ่าน) -> 400', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Create);
    const token = tokenFor(swUser.id, 'SW');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach('file', Buffer.from('{ not valid json'), 'config.json')
      .expect(400);
  });

  it('POST /config/import ไม่แนบไฟล์มา -> 400', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Create);
    const token = tokenFor(swUser.id, 'SW');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .expect(400);
  });

  it('POST /config/import ไฟล์เกินขนาด limit (1MB) -> 413 ไม่ใช่ 500 (Nest แปลง MulterError ให้เองอัตโนมัติ)', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Create);
    const token = tokenFor(swUser.id, 'SW');

    // เกิน 1MB นิดหน่อยพอ ไม่ต้องสร้างไฟล์ใหญ่มาก
    const oversized = Buffer.alloc(1 * 1024 * 1024 + 1, 'a');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach('file', oversized, 'config.json')
      .expect(413);
  });

  it('GET /config role มีสิทธิ์ config.Read -> 200 เห็นรายการทั้งหมด ไม่ scope ตาม creator', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    const auditorUser = await makeUser(prisma, { role: 'Auditor' });
    await grant('Auditor', ActionType.Read);
    await prisma.config.create({
      data: {
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: {},
        createdBy: swUser.id,
      },
    });
    const token = tokenFor(auditorUser.id, 'Auditor');

    const res = await request(app.getHttpServer())
      .get('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((res.body as unknown[]).length).toBe(1);
  });

  it('GET /config/:id role ไม่มีสิทธิ์ config.Read -> 403', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    const configRow = await prisma.config.create({
      data: {
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: {},
        createdBy: swUser.id,
      },
    });
    const token = tokenFor(swUser.id, 'SW'); // ไม่ grant Read ให้ SW ในเทสนี้

    await request(app.getHttpServer())
      .get(`/api/v1/config/${configRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('GET /config/:id ไม่เจอ id -> 404', async () => {
    const auditorUser = await makeUser(prisma, { role: 'Auditor' });
    await grant('Auditor', ActionType.Read);
    const token = tokenFor(auditorUser.id, 'Auditor');

    await request(app.getHttpServer())
      .get('/api/v1/config/22222222-2222-2222-2222-222222222222')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('PUT /config/:id สถานะยังเป็น draft -> 200 แก้ไขสำเร็จ', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Update);
    const configRow = await prisma.config.create({
      data: {
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: {},
        createdBy: swUser.id,
      },
    });
    const token = tokenFor(swUser.id, 'SW');

    const res = await request(app.getHttpServer())
      .put(`/api/v1/config/${configRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceModel: 'GT06L' })
      .expect(200);

    expect((res.body as { deviceModel: string }).deviceModel).toBe('GT06L');
  });

  it('PUT /config/:id สถานะไม่ใช่ draft แล้ว -> 409', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Update);
    const configRow = await prisma.config.create({
      data: {
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: {},
        createdBy: swUser.id,
        status: 'testing',
      },
    });
    const token = tokenFor(swUser.id, 'SW');

    await request(app.getHttpServer())
      .put(`/api/v1/config/${configRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceModel: 'GT06L' })
      .expect(409);
  });

  it('DELETE /config/:id สถานะยังเป็น draft -> 204 และลบจริงจาก DB', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    // DELETE reuse action Update (ไม่มี ActionType.Delete แยก — ดู
    // schema follow-up PR ก่อน #26)
    await grant('SW', ActionType.Update);
    const configRow = await prisma.config.create({
      data: {
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: {},
        createdBy: swUser.id,
      },
    });
    const token = tokenFor(swUser.id, 'SW');

    await request(app.getHttpServer())
      .delete(`/api/v1/config/${configRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(
      await prisma.config.findUnique({ where: { id: configRow.id } }),
    ).toBeNull();
  });

  it('DELETE /config/:id สถานะไม่ใช่ draft -> 409 และไม่ถูกลบ', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Update);
    const configRow = await prisma.config.create({
      data: {
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: {},
        createdBy: swUser.id,
        status: 'approved',
      },
    });
    const token = tokenFor(swUser.id, 'SW');

    await request(app.getHttpServer())
      .delete(`/api/v1/config/${configRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    expect(
      await prisma.config.findUnique({ where: { id: configRow.id } }),
    ).not.toBeNull();
  });

  describe('POST /config/:id/simulate (Stage 3)', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          createdBy: swUser.id,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/simulate`)
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ config-simulation.Read (เช่น Auditor) -> 403', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const auditorUser = await makeUser(prisma, { role: 'Auditor' });
      // Auditor มี config.Read ปกติ (ดู view รายการ) แต่ไม่ควรเรียก simulate ได้
      await grant('Auditor', ActionType.Read, 'config');
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          createdBy: swUser.id,
        },
      });
      const token = tokenFor(auditorUser.id, 'Auditor');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/simulate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('SW มีสิทธิ์ config-simulation.Read, Config มี field ครบ -> 200 passed: true', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Read, 'config-simulation');
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: { APN1: 'internet', CONN_TIMEOUT: 30 },
          createdBy: swUser.id,
        },
      });
      const token = tokenFor(swUser.id, 'SW');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/simulate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { passed: boolean; details: string[] };
      expect(body.passed).toBe(true);
    });

    it('Operation มีสิทธิ์ config-simulation.Read, fields ว่างเปล่า -> 200 passed: false', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Read, 'config-simulation');
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/simulate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { passed: boolean; details: string[] };
      expect(body.passed).toBe(false);
      expect(body.details.length).toBeGreaterThan(0);
    });

    it('สถานะ Config เป็น approved แล้ว -> 409', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Read, 'config-simulation');
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          createdBy: swUser.id,
          status: 'approved',
        },
      });
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/simulate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('ไม่เจอ id -> 404', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Read, 'config-simulation');
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .post('/api/v1/config/22222222-2222-2222-2222-222222222222/simulate')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('POST /config/:id/decide (Stage 4)', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .send({ passed: true })
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ config-decision.Approve (เช่น Operation) -> 403', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set('Authorization', `Bearer ${token}`)
        .send({ passed: true })
        .expect(403);
    });

    it('SW มีสิทธิ์, ไม่ส่ง passed มา -> 400', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Approve, 'config-decision');
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
        },
      });
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('SW มีสิทธิ์, status draft, passed:true -> 200 สถานะเปลี่ยนเป็น testing', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Approve, 'config-decision');
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
        },
      });
      const token = tokenFor(swUser.id, 'SW');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set('Authorization', `Bearer ${token}`)
        .send({ passed: true })
        .expect(200);

      expect((res.body as { status: string }).status).toBe('testing');
    });

    it('SW มีสิทธิ์, status draft, passed:false -> 200 สถานะยังเป็น draft', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Approve, 'config-decision');
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
        },
      });
      const token = tokenFor(swUser.id, 'SW');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set('Authorization', `Bearer ${token}`)
        .send({ passed: false })
        .expect(200);

      expect((res.body as { status: string }).status).toBe('draft');
    });

    it('status ไม่ใช่ draft แล้ว (เช่น testing) -> 409', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Approve, 'config-decision');
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set('Authorization', `Bearer ${token}`)
        .send({ passed: true })
        .expect(409);
    });

    it('ไม่เจอ id -> 404', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Approve, 'config-decision');
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .post('/api/v1/config/22222222-2222-2222-2222-222222222222/decide')
        .set('Authorization', `Bearer ${token}`)
        .send({ passed: true })
        .expect(404);
    });
  });

  describe('POST /config/:id/approve (Stage 4)', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
          status: 'testing',
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/approve`)
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ config.Approve (เช่น SW) -> 403', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('Operation มีสิทธิ์, status testing -> 200 สถานะเปลี่ยนเป็น approved', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((res.body as { status: string }).status).toBe('approved');
      // approvedBy ต้องถูกบันทึกเป็น user id ของ Operation ที่กดอนุมัติ (ไม่ใช่ null)
      expect((res.body as { approvedBy: string }).approvedBy).toBe(opUser.id);
      const persisted = await prisma.config.findUnique({
        where: { id: configRow.id },
      });
      expect(persisted?.approvedBy).toBe(opUser.id);
    });

    it('status ยังเป็น draft (ยังไม่ผ่าน decide) -> 409', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('ไม่เจอ id -> 404', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/config/22222222-2222-2222-2222-222222222222/approve')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('POST /config/:id/reject (Stage 4)', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
          status: 'testing',
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/reject`)
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ config.Approve (เช่น SW) -> 403', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('Operation มีสิทธิ์, status testing -> 200 สถานะย้อนกลับเป็น draft', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((res.body as { status: string }).status).toBe('draft');
    });

    it('status ยังเป็น draft (ยังไม่เคยส่งต่อ Operation) -> 409', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const configRow = await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: swUser.id,
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('ไม่เจอ id -> 404', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/config/22222222-2222-2222-2222-222222222222/reject')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
