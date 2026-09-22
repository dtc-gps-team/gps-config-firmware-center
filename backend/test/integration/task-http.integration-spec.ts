import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { NotificationService } from '../../src/notification/notification.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { TaskModule } from '../../src/task/task.module';
import {
  createTestPrisma,
  getOrCreateDeviceModel,
  makeUser,
  resetDb,
  TEST_DATABASE_URL,
} from './setup';

// PrismaService (ผ่าน PrismaModule) อ่าน DATABASE_URL จาก env ตรงๆ — override ให้ชี้
// ไปที่ DB _test เดียวกับที่ integration test อื่นใช้ (TEST_DATABASE_URL ผ่าน
// assertTestDatabase() แล้วว่าลงท้าย _test เสมอ) กันไม่ให้แอปจริงต่อ dev DB โดยไม่ตั้งใจ
process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * ทดสอบผ่าน HTTP จริง (supertest) แทนการเรียก controller/service ตรงๆ เพราะ
 * JwtAuthGuard เป็น decorator (@UseGuards) ที่ unit test ข้ามไปเลยถ้าเรียก method
 * ตรง — ต้องมี request ผ่าน Nest application จริงถึงจะพิสูจน์ได้ว่า guard บล็อก
 * request ที่ไม่มี token จริง (401)
 */
describe('TaskController RBAC (integration — real postgres + JwtAuthGuard)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // TaskModule -> NotificationModule -> NotificationService inject
      // @nestjs/config — forRoot เองเหมือน notification-http spec
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        TaskModule,
      ],
    })
      // เทสนี้เช็ค RBAC + JwtAuthGuard ล้วน — ไม่ให้ notification (task_assigned
      // ตอน create) แตะ DB จริงหรือ FCM
      .overrideProvider(NotificationService)
      .useValue({ send: jest.fn().mockResolvedValue(undefined) })
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
  });

  function tokenFor(sub: string, role: string): string {
    return jwtService.sign({ sub, role });
  }

  it('GET /tasks ไม่ส่ง Authorization header -> 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/tasks').expect(401);
  });

  it('POST /tasks ไม่ส่ง Authorization header -> 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .send({ title: 'x', assignedTo: 'someone' })
      .expect(401);
  });

  it('Authorization header เป็น token ปลอม -> 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/tasks')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('POST /tasks role ConfigEngineer (ไม่ใช่ Operation) -> 403', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x', assignedTo: configEngineerUser.id })
      .expect(403);
  });

  it('POST /tasks role Operation -> 201', async () => {
    const opUser = await makeUser(prisma, { role: 'Operation' });
    const otUser = await makeUser(prisma, { role: 'OT' });
    const token = tokenFor(opUser.id, 'Operation');

    await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x', assignedTo: otUser.id })
      .expect(201);
  });

  it('PATCH /tasks/:id role ST แก้ field อื่นนอกจาก status ของงานตัวเอง -> 403', async () => {
    const stUser = await makeUser(prisma, { role: 'ST' });
    const task = await prisma.task.create({
      data: { title: 'mine', assignedTo: stUser.id },
    });
    const token = tokenFor(stUser.id, 'ST');

    await request(app.getHttpServer())
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'hacked' })
      .expect(403);
  });

  it('PATCH /tasks/:id role ST แก้ status งานตัวเอง -> 200', async () => {
    const stUser = await makeUser(prisma, { role: 'ST' });
    const task = await prisma.task.create({
      data: { title: 'mine', assignedTo: stUser.id },
    });
    const token = tokenFor(stUser.id, 'ST');

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' })
      .expect(200);

    const body = res.body as { status: string };
    expect(body.status).toBe('in_progress');
  });

  it('GET /tasks/:id role ST ดูงานคนอื่น -> 404 (ไม่เปิดเผยว่ามี record)', async () => {
    const stUser = await makeUser(prisma, { role: 'ST' });
    const otherUser = await makeUser(prisma, { role: 'OT' });
    const task = await prisma.task.create({
      data: { title: 'other', assignedTo: otherUser.id },
    });
    const token = tokenFor(stUser.id, 'ST');

    await request(app.getHttpServer())
      .get(`/api/v1/tasks/${task.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('PATCH /tasks/:id role Auditor (ไม่มีสิทธิ์แก้เลย) -> 403', async () => {
    const auditorUser = await makeUser(prisma, { role: 'Auditor' });
    const otUser = await makeUser(prisma, { role: 'OT' });
    const task = await prisma.task.create({
      data: { title: 'x', assignedTo: otUser.id },
    });
    const token = tokenFor(auditorUser.id, 'Auditor');

    await request(app.getHttpServer())
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'completed' })
      .expect(403);
  });

  describe('AuditLog (Sprint 3 #27 follow-up — PR #145 เปิด audit module แล้ว)', () => {
    it('POST /tasks สำเร็จ -> เขียน AuditLog action create', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const otUser = await makeUser(prisma, { role: 'OT' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'x', assignedTo: otUser.id })
        .expect(201);

      const logs = await prisma.auditLog.findMany({
        where: { userId: opUser.id, auditModule: 'task', action: 'create' },
      });
      expect(logs).toHaveLength(1);
    });

    it('PATCH /tasks/:id โดย Operation สำเร็จ -> เขียน AuditLog action update', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const otUser = await makeUser(prisma, { role: 'OT' });
      const task = await prisma.task.create({
        data: { title: 'x', assignedTo: otUser.id },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'แก้ไขแล้ว' })
        .expect(200);

      const logs = await prisma.auditLog.findMany({
        where: { userId: opUser.id, auditModule: 'task', action: 'update' },
      });
      expect(logs).toHaveLength(1);
    });

    it('PATCH /tasks/:id โดย ST แก้ status งานตัวเองสำเร็จ -> เขียน AuditLog ด้วย userId ของ ST เอง', async () => {
      const stUser = await makeUser(prisma, { role: 'ST' });
      const task = await prisma.task.create({
        data: { title: 'mine', assignedTo: stUser.id },
      });
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'in_progress' })
        .expect(200);

      const logs = await prisma.auditLog.findMany({
        where: { userId: stUser.id, auditModule: 'task', action: 'update' },
      });
      expect(logs).toHaveLength(1);
    });

    it('PATCH /tasks/:id ที่โดน 403 (ST แก้ field อื่นนอกจาก status) -> ไม่เขียน AuditLog', async () => {
      const stUser = await makeUser(prisma, { role: 'ST' });
      const task = await prisma.task.create({
        data: { title: 'mine', assignedTo: stUser.id },
      });
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'hacked' })
        .expect(403);

      const logs = await prisma.auditLog.findMany({
        where: { userId: stUser.id },
      });
      expect(logs).toHaveLength(0);
    });
  });

  describe('Task.configId (งานติดตั้ง — ผูก Config ที่ Mobile จะ apply)', () => {
    async function makeConfig(
      status: 'draft' | 'approved',
      opts: { deviceModel?: string; protocol?: string } = {},
    ): Promise<string> {
      const creator = await makeUser(prisma, { role: 'ConfigEngineer' });
      const config = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          deviceModel: opts.deviceModel ?? 'GT06N',
          protocol: opts.protocol ?? 'TCP',
          status,
          fields: { APN: 'internet' },
          createdBy: creator.id,
        },
      });
      return config.id;
    }

    it('Operation สร้างงานพร้อม configId ที่ approved -> 201 + task.configId', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const otUser = await makeUser(prisma, { role: 'OT' });
      const configId = await makeConfig('approved');
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'ติดตั้ง', assignedTo: otUser.id, configId })
        .expect(201);

      expect((res.body as { configId: string }).configId).toBe(configId);
    });

    it('configId ที่ไม่พบ Config -> 404', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const otUser = await makeUser(prisma, { role: 'OT' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'x',
          assignedTo: otUser.id,
          configId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(404);
    });

    it('configId เป็น Config สถานะ draft -> 409', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const otUser = await makeUser(prisma, { role: 'OT' });
      const configId = await makeConfig('draft');
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'x', assignedTo: otUser.id, configId })
        .expect(409);
    });

    it('configId ไม่ใช่ uuid -> 400', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const otUser = await makeUser(prisma, { role: 'OT' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'x', assignedTo: otUser.id, configId: 'not-a-uuid' })
        .expect(400);
    });

    it('deviceId มี Device record จริงแต่คนละรุ่นกับ Config -> 409', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const otUser = await makeUser(prisma, { role: 'OT' });
      const configId = await makeConfig('approved', { deviceModel: 'GT06N' });
      const otherModel = await getOrCreateDeviceModel(prisma, 'GT06L');
      await prisma.device.create({
        data: {
          deviceId: 'DEV-CFG-409',
          simNumber: 'sim-DEV-CFG-409',
          deviceModel: 'GT06L',
          protocol: 'TCP',
          status: 'installed',
          modelId: otherModel.id,
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'x',
          assignedTo: otUser.id,
          deviceId: 'DEV-CFG-409',
          configId,
        })
        .expect(409);
    });

    it('PATCH role ST ส่ง configId มาด้วย -> 403 (สิทธิ์ Operation เท่านั้น)', async () => {
      const stUser = await makeUser(prisma, { role: 'ST' });
      const configId = await makeConfig('approved');
      const task = await prisma.task.create({
        data: { title: 'mine', assignedTo: stUser.id },
      });
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(403);
    });

    it('PATCH Operation เปลี่ยน configId เป็น Config approved -> 200', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const otUser = await makeUser(prisma, { role: 'OT' });
      const configId = await makeConfig('approved');
      const task = await prisma.task.create({
        data: { title: 'x', assignedTo: otUser.id },
      });
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ configId })
        .expect(200);

      expect((res.body as { configId: string }).configId).toBe(configId);
    });
  });

  describe('GET /tasks scope (issue #73 — default-deny ผ่าน guard chain จริง)', () => {
    /** `TaskController` ใช้แค่ `JwtAuthGuard` ไม่มี `PermissionGuard` — ทุก role
     * ที่ login ได้ยิง `GET /tasks` ผ่านได้เสมอ ตัว scope จริงมาจาก
     * `TaskService.findAll()` ล้วนๆ (`UNSCOPED_TASK_ROLES`) — เทสชุดนี้พิสูจน์
     * ว่า scope ทำงานถูกต้องตลอด guard chain จริง ไม่ใช่แค่ mock Prisma ใน
     * unit test (`task.service.spec.ts`) */
    async function seedTwoTasks() {
      const stUser = await makeUser(prisma, { role: 'ST' });
      const otUser = await makeUser(prisma, { role: 'OT' });
      await prisma.task.create({
        data: { title: 'task-a', assignedTo: stUser.id },
      });
      await prisma.task.create({
        data: { title: 'task-b', assignedTo: otUser.id },
      });
      return { stUser, otUser };
    }

    it('ST เห็นแค่งานตัวเอง แม้มีงานของคนอื่นในระบบ', async () => {
      const { stUser } = await seedTwoTasks();

      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokenFor(stUser.id, 'ST')}`)
        .expect(200);

      const body = res.body as { assignedTo: string }[];
      expect(body).toHaveLength(1);
      expect(body[0].assignedTo).toBe(stUser.id);
    });

    it('OT เห็นแค่งานตัวเอง แม้มีงานของคนอื่นในระบบ', async () => {
      const { otUser } = await seedTwoTasks();

      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokenFor(otUser.id, 'OT')}`)
        .expect(200);

      const body = res.body as { assignedTo: string }[];
      expect(body).toHaveLength(1);
      expect(body[0].assignedTo).toBe(otUser.id);
    });

    it.each(['Operation', 'Auditor', 'Admin'] as const)(
      'role %s (อยู่ใน UNSCOPED_TASK_ROLES) เห็นงานของทุกคน',
      async (roleCode) => {
        await seedTwoTasks();
        const actor = await makeUser(prisma, { role: roleCode });

        const res = await request(app.getHttpServer())
          .get('/api/v1/tasks')
          .set('Authorization', `Bearer ${tokenFor(actor.id, roleCode)}`)
          .expect(200);

        expect(res.body).toHaveLength(2);
      },
    );

    it('issue #73 — role ที่ไม่อยู่ใน UNSCOPED_TASK_ROLES ถูก self-scope เป็น default (เช่น ConfigEngineer ที่ไม่เคยมีงานเลย ต้องได้ [] ไม่ใช่งานของ ST/OT)', async () => {
      await seedTwoTasks();
      const ceUser = await makeUser(prisma, { role: 'ConfigEngineer' });

      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokenFor(ceUser.id, 'ConfigEngineer')}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('ST ส่ง ?assignedTo=<คนอื่น> มาทาง query -> backend เพิกเฉย ยังบังคับเป็นของตัวเองเสมอ', async () => {
      const { stUser, otUser } = await seedTwoTasks();

      const res = await request(app.getHttpServer())
        .get(`/api/v1/tasks?assignedTo=${otUser.id}`)
        .set('Authorization', `Bearer ${tokenFor(stUser.id, 'ST')}`)
        .expect(200);

      const body = res.body as { assignedTo: string }[];
      expect(body).toHaveLength(1);
      expect(body[0].assignedTo).toBe(stUser.id);
    });

    it('Operation ส่ง ?assignedTo=<คนใดคนหนึ่ง> มาทาง query -> ใช้ค่านั้นกรองได้จริง (UNSCOPED role เลือก assignedTo เองได้)', async () => {
      const { stUser } = await seedTwoTasks();
      const opUser = await makeUser(prisma, { role: 'Operation' });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/tasks?assignedTo=${stUser.id}`)
        .set('Authorization', `Bearer ${tokenFor(opUser.id, 'Operation')}`)
        .expect(200);

      const body = res.body as { assignedTo: string }[];
      expect(body).toHaveLength(1);
      expect(body[0].assignedTo).toBe(stUser.id);
    });
  });
});
