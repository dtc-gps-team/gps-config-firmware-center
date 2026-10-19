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
        .send({ name: 'GT06X', supportedProtocols: ['TCP'] })
        .expect(201);

      const body = res.body as { name: string; supportedProtocols: string[] };
      expect(body.name).toBe('GT06X');
      expect(body.supportedProtocols).toEqual(['TCP']);
    });

    it('supportedProtocols มากกว่า 1 ค่า -> 400 (1 โมเดลมีได้โปรโตคอลเดียว)', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Create, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      const res = await request(app.getHttpServer())
        .post('/api/v1/device-models')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'GT06X', supportedProtocols: ['TCP', 'UDP'] })
        .expect(400);

      expect(JSON.stringify(res.body)).toContain('1 โมเดลมีได้โปรโตคอลเดียว');
      expect(
        await prisma.deviceModel.findUnique({ where: { name: 'GT06X' } }),
      ).toBeNull();
    });

    it('สร้างสำเร็จ -> มีแถว AuditLog 1 แถว พร้อม IP และชื่อรุ่น', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Create, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      const res = await request(app.getHttpServer())
        .post('/api/v1/device-models')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'GT06A', supportedProtocols: ['TCP'] })
        .expect(201);

      const created = res.body as { id: string };
      const logs = await prisma.auditLog.findMany({
        where: { auditModule: 'device-model' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].userId).toBe(admin.id);
      expect(logs[0].action).toBe('create');
      expect(logs[0].ipAddress).toBeTruthy();
      expect(logs[0].metadata).toEqual({
        deviceModelId: created.id,
        modelName: 'GT06A',
      });
    });

    it('ชื่อรุ่นซ้ำ -> 409 และไม่มีแถว AuditLog เพิ่ม', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Create, 'device-model');
      const token = tokenFor(admin.id, 'Admin');
      const body = { name: 'GT06D', supportedProtocols: ['TCP'] };

      await request(app.getHttpServer())
        .post('/api/v1/device-models')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/device-models')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(409);

      expect(
        await prisma.auditLog.count({ where: { auditModule: 'device-model' } }),
      ).toBe(1);
    });

    it('บันทึก AuditLog ไม่ได้ (ผู้ทำรายการไม่มีในระบบ) -> 500 และรุ่นที่เพิ่งสร้างถูกย้อนกลับ ไม่ค้างในทะเบียน', async () => {
      await grant('Admin', ActionType.Create, 'device-model');
      // token ที่ผ่าน guard ได้ (role มีสิทธิ์) แต่ userId ไม่มีในตาราง User
      // -> FK ของ AuditLog.userId ล้ม ต้องทำให้การสร้างล้มตามด้วย (atomic)
      const token = tokenFor('00000000-0000-4000-8000-000000000099', 'Admin');

      await request(app.getHttpServer())
        .post('/api/v1/device-models')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'GT06G', supportedProtocols: ['TCP'] })
        .expect(500);

      expect(await prisma.deviceModel.count({ where: { name: 'GT06G' } })).toBe(
        0,
      );
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('endOfSupportDate แบบวันที่อย่างเดียว (จากช่องเลือกวันที่บนเว็บ) -> 201 ไม่ใช่ 500', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Create, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      const res = await request(app.getHttpServer())
        .post('/api/v1/device-models')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'GT06Y',
          supportedProtocols: ['TCP'],
          endOfSupportDate: '2027-10-12',
        })
        .expect(201);

      expect((res.body as { endOfSupportDate: string }).endOfSupportDate).toBe(
        '2027-10-12T00:00:00.000Z',
      );
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

    it('แก้ endOfSupportDate แบบวันที่อย่างเดียว -> 200 ไม่ใช่ 500', async () => {
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Update, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/device-models/${model.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ endOfSupportDate: '2028-01-31' })
        .expect(200);

      expect((res.body as { endOfSupportDate: string }).endOfSupportDate).toBe(
        '2028-01-31T00:00:00.000Z',
      );
    });

    it('แก้ supportedProtocols เป็นมากกว่า 1 ค่า -> 400 (1 โมเดลมีได้โปรโตคอลเดียว)', async () => {
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Update, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      await request(app.getHttpServer())
        .patch(`/api/v1/device-models/${model.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ supportedProtocols: ['TCP', 'UDP'] })
        .expect(400);
    });

    it('รุ่นเก่าที่มีหลายโปรโตคอลอยู่แล้ว แก้ให้เหลือ 1 ค่า -> 200', async () => {
      // getOrCreateDeviceModel สร้างผ่าน prisma ตรงๆ (TCP + UDP) จำลองแถวเก่า
      // ที่เกิดก่อนมีกฎ 1 โมเดล 1 โปรโตคอล
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Update, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/device-models/${model.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ supportedProtocols: ['TCP'] })
        .expect(200);

      expect(
        (res.body as { supportedProtocols: string[] }).supportedProtocols,
      ).toEqual(['TCP']);
    });

    it('แก้สำเร็จ -> มีแถว AuditLog พร้อมชื่อ field ที่แก้ (ไม่เก็บค่า)', async () => {
      const model = await getOrCreateDeviceModel(prisma, 'GT06N');
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Update, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      await request(app.getHttpServer())
        .patch(`/api/v1/device-models/${model.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'discontinued', notes: 'เลิกผลิต' })
        .expect(200);

      const logs = await prisma.auditLog.findMany({
        where: { auditModule: 'device-model', action: 'update' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].userId).toBe(admin.id);
      expect(logs[0].ipAddress).toBeTruthy();
      const meta = logs[0].metadata as {
        deviceModelId: string;
        modelName: string;
        fieldNames: string[];
      };
      expect(meta.deviceModelId).toBe(model.id);
      expect(meta.modelName).toBe('GT06N');
      expect([...meta.fieldNames].sort()).toEqual(['notes', 'status']);
    });

    it('id ไม่มีอยู่จริง -> 404 และไม่มีแถว AuditLog', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Update, 'device-model');
      const token = tokenFor(admin.id, 'Admin');

      await request(app.getHttpServer())
        .patch('/api/v1/device-models/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'discontinued' })
        .expect(404);

      expect(await prisma.auditLog.count()).toBe(0);
    });
  });
});
