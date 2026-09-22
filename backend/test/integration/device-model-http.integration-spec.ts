import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { DeviceModelModule } from '../../src/device-model/device-model.module';
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
 * DeviceModel registry (issue #209, docs/15) — `GET` เปิดกว้างทุก role
 * (ไม่มี PermissionGuard), `POST`/`PATCH` เฉพาะ Admin/SuperAdmin ผ่าน HTTP
 * จริง (JwtAuthGuard -> PermissionGuard เต็มเส้นทาง)
 */
describe('DeviceModelController (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        DeviceModelModule,
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
    resource: string,
  ): Promise<void> {
    const role = await getOrCreateRole(prisma, roleCode);
    await prisma.rolePermission.create({
      data: { roleId: role.id, resource, action },
    });
  }

  describe('GET /device-models', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/device-models')
        .expect(401);
    });

    it('ทุก role ที่ login แล้วอ่านได้ (ไม่มี PermissionGuard) -> 200 (issue #209)', async () => {
      await getOrCreateDeviceModel(prisma, 'GT06N');
      const stUser = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(stUser.id, 'ST');

      const res = await request(app.getHttpServer())
        .get('/api/v1/device-models')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { name: string }[];
      expect(body.map((m) => m.name)).toEqual(['GT06N']);
    });
  });

  describe('POST /device-models', () => {
    it('ไม่มีสิทธิ์ device-model.Create (เช่น ConfigEngineer) -> 403', async () => {
      const user = await makeUser(prisma, { role: 'ConfigEngineer' });
      const token = tokenFor(user.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .post('/api/v1/device-models')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'GT06X', supportedProtocols: ['TCP'] })
        .expect(403);
    });

    it('Admin มีสิทธิ์ -> 201 สร้างสำเร็จ (issue #209)', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Create, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      const res = await request(app.getHttpServer())
        .post('/api/v1/device-models')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'GT06X', supportedProtocols: ['TCP', 'UDP'] })
        .expect(201);

      const body = res.body as { name: string; supportedProtocols: string[] };
      expect(body.name).toBe('GT06X');
      expect(body.supportedProtocols).toEqual(['TCP', 'UDP']);
    });

    it('ไม่ส่ง supportedProtocols มาเลย -> 400 (บังคับอย่างน้อย 1 ค่า, issue #209 ข้อ 4)', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Create, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      await request(app.getHttpServer())
        .post('/api/v1/device-models')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'GT06X', supportedProtocols: [] })
        .expect(400);
    });

    it('ชื่อรุ่นซ้ำ -> 409', async () => {
      await getOrCreateDeviceModel(prisma, 'GT06N');
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Create, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      await request(app.getHttpServer())
        .post('/api/v1/device-models')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'GT06N', supportedProtocols: ['TCP'] })
        .expect(409);
    });
  });

  describe('PATCH /device-models/{id}', () => {
    it('ไม่มีสิทธิ์ device-model.Update -> 403', async () => {
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');
      const user = await makeUser(prisma, { role: 'ConfigEngineer' });
      const token = tokenFor(user.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .patch(`/api/v1/device-models/${model.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'discontinued' })
        .expect(403);
    });

    it('Admin มีสิทธิ์ -> 200 แก้สำเร็จ (issue #209)', async () => {
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Update, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/device-models/${model.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'discontinued' })
        .expect(200);

      expect((res.body as { status: string }).status).toBe('discontinued');
    });

    it('id ไม่มีอยู่จริง -> 404', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Update, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      await request(app.getHttpServer())
        .patch('/api/v1/device-models/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'discontinued' })
        .expect(404);
    });
  });
});
