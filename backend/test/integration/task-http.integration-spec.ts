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

  it('GET /tasks/:id role ConfigEngineer (ไม่อยู่ใน UNSCOPED_TASK_ROLES/SELF_SCOPED_ROLES เลย) -> 404 แม้ไม่มี PermissionGuard คุม endpoint นี้ (issue #73 ข้อ 3)', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    const otherUser = await makeUser(prisma, { role: 'OT' });
    const task = await prisma.task.create({
      data: { title: 'other', assignedTo: otherUser.id },
    });
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .get(`/api/v1/tasks/${task.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('GET /tasks/:id role Admin -> 200 เห็นงานของคนอื่นได้ (UNSCOPED_TASK_ROLES)', async () => {
    const adminUser = await makeUser(prisma, { role: 'Admin' });
    const otherUser = await makeUser(prisma, {
      role: 'OT',
      fullName: 'ช่างสมศรี',
    });
    const task = await prisma.task.create({
      data: { title: 'other', assignedTo: otherUser.id },
    });
    const token = tokenFor(adminUser.id, 'Admin');

    const res = await request(app.getHttpServer())
      .get(`/api/v1/tasks/${task.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // ชื่อผู้รับผิดชอบมากับงาน (Mobile แสดงแทน user id ดิบ) — เฉพาะ 2 field นี้
    expect((res.body as { assignee: unknown }).assignee).toEqual({
      username: otherUser.username,
      fullName: 'ช่างสมศรี',
    });
  });

  it('PATCH /tasks/:id role ST ตั้งสถานะเป็น cancelled (งานตัวเอง) -> 403 (issue #73 ข้อ 2 — ยกเลิกงานเป็นสิทธิ์ Operation)', async () => {
    const stUser = await makeUser(prisma, { role: 'ST' });
    const task = await prisma.task.create({
      data: { title: 'mine', assignedTo: stUser.id },
    });
    const token = tokenFor(stUser.id, 'ST');

    await request(app.getHttpServer())
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'cancelled' })
      .expect(403);
  });

  it('PATCH /tasks/:id role ST ตั้งสถานะเป็น pending (งานตัวเอง) -> 403 (issue #73 ข้อ 2)', async () => {
    const stUser = await makeUser(prisma, { role: 'ST' });
    const task = await prisma.task.create({
      data: { title: 'mine', assignedTo: stUser.id, status: 'in_progress' },
    });
    const token = tokenFor(stUser.id, 'ST');

    await request(app.getHttpServer())
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'pending' })
      .expect(403);
  });

  // คำตอบ A ใน #303 ข้อ 1 — งาน completed ห้ามย้อนสถานะ (เดิมกันแค่ cancelled)
  it.each(['in_progress', 'completed'] as const)(
    'PATCH /tasks/:id role ST ตั้ง "%s" ทับงานตัวเองที่ completed แล้ว -> 409 สถานะไม่เปลี่ยน',
    async (status) => {
      const stUser = await makeUser(prisma, { role: 'ST' });
      const task = await prisma.task.create({
        data: { title: 'done', assignedTo: stUser.id, status: 'completed' },
      });
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status })
        .expect(409);

      const after = await prisma.task.findUniqueOrThrow({
        where: { id: task.id },
      });
      expect(after.status).toBe('completed');
    },
  );

  it('PATCH /tasks/:id role OT งานตัวเองที่ in_progress -> completed ยังได้ 200 ตามเดิม', async () => {
    const otUser = await makeUser(prisma, { role: 'OT' });
    const task = await prisma.task.create({
      data: { title: 'doing', assignedTo: otUser.id, status: 'in_progress' },
    });
    const token = tokenFor(otUser.id, 'OT');

    await request(app.getHttpServer())
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'completed' })
      .expect(200);
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

  describe('Task Event History (issue #296 — timeline + note)', () => {
    type EventBody = {
      fromStatus: string | null;
      toStatus: string | null;
      changedBy: string | null;
      changedByName: string | null;
      changedAt: string;
      note: string | null;
    };

    function getEvents(taskId: string, userId: string, role: string) {
      return request(app.getHttpServer())
        .get(`/api/v1/tasks/${taskId}/events`)
        .set('Authorization', `Bearer ${tokenFor(userId, role)}`);
    }

    async function seedOwnTask() {
      const stUser = await makeUser(prisma, {
        role: 'ST',
        fullName: 'ช่างสมชาย',
      });
      // สร้างย้อนหลัง 1 วัน — changedAt ที่ก่อน Task.createdAt ถูกปัดขึ้น
      // (resolveChangedAt) เทสเวลาย้อนหลังต้องมีงานที่เก่ากว่านั้น
      const task = await prisma.task.create({
        data: {
          title: 'mine',
          assignedTo: stUser.id,
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      });
      return { stUser, task };
    }

    it('POST /tasks -> timeline เริ่มด้วย event "สร้างงาน" (null -> pending) ของผู้สร้าง', async () => {
      const opUser = await makeUser(prisma, {
        role: 'Operation',
        fullName: 'คุณสั่งงาน',
      });
      const otUser = await makeUser(prisma, { role: 'OT' });

      const created = await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${tokenFor(opUser.id, 'Operation')}`)
        .send({ title: 'x', assignedTo: otUser.id })
        .expect(201);
      const task = created.body as { id: string; createdAt: string };

      const res = await getEvents(task.id, otUser.id, 'OT').expect(200);
      const events = res.body as EventBody[];
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        fromStatus: null,
        toStatus: 'pending',
        changedBy: opUser.id,
        changedByName: 'คุณสั่งงาน',
        changedAt: task.createdAt,
        note: null,
      });
    });

    it('PATCH status ด้วย changedAt (คิว offline) -> event ใช้เวลาที่กดจริง ไม่ใช่เวลา sync', async () => {
      const { stUser, task } = await seedOwnTask();
      const tappedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${tokenFor(stUser.id, 'ST')}`)
        .send({ status: 'in_progress', changedAt: tappedAt })
        .expect(200);

      const events = (await getEvents(task.id, stUser.id, 'ST').expect(200))
        .body as EventBody[];
      expect(events).toEqual([
        expect.objectContaining({
          fromStatus: 'pending',
          toStatus: 'in_progress',
          changedBy: stUser.id,
          changedByName: 'ช่างสมชาย',
          changedAt: tappedAt,
        }),
      ]);
    });

    it('PATCH status ด้วย changedAt ในอนาคต -> ปัดลงเป็นเวลา server (ไม่ 400 — คิว offline ไม่ค้าง)', async () => {
      const { stUser, task } = await seedOwnTask();
      const before = Date.now();

      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${tokenFor(stUser.id, 'ST')}`)
        .send({ status: 'in_progress', changedAt: '2099-01-01T00:00:00.000Z' })
        .expect(200);

      const [event] = (await getEvents(task.id, stUser.id, 'ST').expect(200))
        .body as EventBody[];
      const at = new Date(event.changedAt).getTime();
      expect(at).toBeGreaterThanOrEqual(before - 1000);
      expect(at).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('PATCH changedAt ที่ไม่ใช่ ISO 8601 -> 400', async () => {
      const { stUser, task } = await seedOwnTask();

      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${tokenFor(stUser.id, 'ST')}`)
        .send({ status: 'in_progress', changedAt: 'yesterday' })
        .expect(400);
    });

    it('PATCH changedAt โดยไม่ส่ง status -> 400 ไม่เกิด event', async () => {
      const { stUser, task } = await seedOwnTask();

      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${tokenFor(stUser.id, 'ST')}`)
        .send({ changedAt: new Date().toISOString() })
        .expect(400);
      expect(await prisma.taskEvent.count()).toBe(0);
    });

    it('PATCH ที่ถูกปฏิเสธ (งาน cancelled -> 409) ไม่ทิ้ง event ไว้ (rollback ทั้งทรานแซกชัน)', async () => {
      const { stUser, task } = await seedOwnTask();
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'cancelled' },
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${tokenFor(stUser.id, 'ST')}`)
        .send({ status: 'completed' })
        .expect(409);
      expect(await prisma.taskEvent.count()).toBe(0);
    });

    it('timeline เรียงตาม changedAt จริง ไม่ใช่ลำดับที่ส่งเข้ามา (คิว offline ส่งช้ากว่าบันทึกที่เพิ่มทีหลัง)', async () => {
      const { stUser, task } = await seedOwnTask();
      const token = `Bearer ${tokenFor(stUser.id, 'ST')}`;
      // เริ่มงานตอน offline (เวลาเก่ากว่า) แต่ sync ขึ้นหลังบันทึก
      await request(app.getHttpServer())
        .post(`/api/v1/tasks/${task.id}/notes`)
        .set('Authorization', token)
        .send({ note: 'ถึงหน้างานแล้ว' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', token)
        .send({
          status: 'in_progress',
          changedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        })
        .expect(200);

      const events = (await getEvents(task.id, stUser.id, 'ST').expect(200))
        .body as EventBody[];
      expect(events.map((e) => e.toStatus ?? e.note)).toEqual([
        'in_progress',
        'ถึงหน้างานแล้ว',
      ]);
    });

    // รีวิว A บน #302 (thread task.service.ts:137) — เคสที่ยกมาเป๊ะๆ: ช่าง
    // กด in_progress แล้ว completed ตอนออฟไลน์ ระหว่างนั้น Operation เปลี่ยน
    // pending -> in_progress บน Web แล้วคิวของช่างค่อย sync ทีหลัง
    it('ช่างออฟไลน์ + Operation เปลี่ยนสถานะคั่นกลาง -> event ของช่างที่ sync ทีหลังไม่ย้อนไปอยู่ก่อน event ของ Operation (from→to ต่อกันเสมอ)', async () => {
      const { stUser, task } = await seedOwnTask();
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const hour = 60 * 60 * 1000;
      const tappedInProgress = new Date(Date.now() - 2 * hour).toISOString();
      const tappedCompleted = new Date(Date.now() - 1.5 * hour).toISOString();

      // 11:00 — Operation เปลี่ยน pending -> in_progress บน Web
      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${tokenFor(opUser.id, 'Operation')}`)
        .send({ status: 'in_progress' })
        .expect(200);
      // 12:00 — คิวของช่าง sync: action แรกสถานะเท่าเดิม (ไม่เกิด event)
      // action ที่สองเกิด event in_progress -> completed เวลาที่กดจริงเก่ากว่า
      const stToken = `Bearer ${tokenFor(stUser.id, 'ST')}`;
      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', stToken)
        .send({ status: 'in_progress', changedAt: tappedInProgress })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', stToken)
        .send({ status: 'completed', changedAt: tappedCompleted })
        .expect(200);

      const events = (await getEvents(task.id, stUser.id, 'ST').expect(200))
        .body as EventBody[];
      expect(events.map((e) => [e.fromStatus, e.toStatus])).toEqual([
        ['pending', 'in_progress'],
        ['in_progress', 'completed'],
      ]);
      expect(events[0].changedBy).toBe(opUser.id);
      expect(events[1].changedBy).toBe(stUser.id);
      // ปัดขึ้นเป็นเวลาของ event Operation — ไม่ใช่เวลาที่ช่างกด (1.5 ชม.ก่อน)
      expect(events[1].changedAt).toBe(events[0].changedAt);
      expect(new Date(events[1].changedAt).getTime()).toBeGreaterThan(
        new Date(tappedCompleted).getTime(),
      );
    });

    // รีวิว A บน #302 (thread task.service.ts:429)
    it('Operation ส่ง changedAt ย้อนหลังมา -> ไม่ใช้ event ได้เวลา server เสมอ', async () => {
      const { stUser, task } = await seedOwnTask();
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const before = Date.now();

      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${tokenFor(opUser.id, 'Operation')}`)
        .send({
          status: 'cancelled',
          changedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
        })
        .expect(200);

      const [event] = (await getEvents(task.id, stUser.id, 'ST').expect(200))
        .body as EventBody[];
      expect(event.toStatus).toBe('cancelled');
      expect(new Date(event.changedAt).getTime()).toBeGreaterThanOrEqual(
        before - 1000,
      );
    });

    describe('GET /tasks/:id/events สิทธิ์ (กฎเดียวกับ GET /tasks/:id)', () => {
      it('ไม่ส่ง token -> 401', async () => {
        const { task } = await seedOwnTask();
        await request(app.getHttpServer())
          .get(`/api/v1/tasks/${task.id}/events`)
          .expect(401);
      });

      it('taskId ไม่ใช่ uuid -> 400', async () => {
        const { stUser } = await seedOwnTask();
        await getEvents('not-a-uuid', stUser.id, 'ST').expect(400);
      });

      it.each(['Operation', 'Auditor', 'Admin', 'SuperAdmin'])(
        '%s เห็น timeline ของงานคนอื่น -> 200',
        async (role) => {
          const { task } = await seedOwnTask();
          const viewer = await makeUser(prisma, {
            role: role as 'Operation',
          });
          await getEvents(task.id, viewer.id, role).expect(200);
        },
      );

      it.each([
        ['OT ที่ไม่ใช่เจ้าของงาน', 'OT'],
        ['ConfigEngineer (นอก allowlist)', 'ConfigEngineer'],
      ])('%s -> 404', async (_label, role) => {
        const { task } = await seedOwnTask();
        const viewer = await makeUser(prisma, { role: role as 'OT' });
        await getEvents(task.id, viewer.id, role).expect(404);
      });
    });

    describe('POST /tasks/:id/notes', () => {
      function postNote(
        taskId: string,
        userId: string,
        role: string,
        body: object,
      ) {
        return request(app.getHttpServer())
          .post(`/api/v1/tasks/${taskId}/notes`)
          .set('Authorization', `Bearer ${tokenFor(userId, role)}`)
          .send(body);
      }

      it('เจ้าของงาน (ST) -> 201 ได้ event ที่เป็นบันทึก (ไม่มี from/toStatus) + AuditLog add_note', async () => {
        const { stUser, task } = await seedOwnTask();

        const res = await postNote(task.id, stUser.id, 'ST', {
          note: 'ลูกค้าไม่อยู่ นัดใหม่พรุ่งนี้',
        }).expect(201);

        expect(res.body).toMatchObject({
          taskId: task.id,
          fromStatus: null,
          toStatus: null,
          changedBy: stUser.id,
          changedByName: 'ช่างสมชาย',
          note: 'ลูกค้าไม่อยู่ นัดใหม่พรุ่งนี้',
        });
        const audit = await prisma.auditLog.findMany({
          where: { userId: stUser.id, auditModule: 'task' },
        });
        expect(audit.map((a) => a.action)).toEqual(['add_note']);
      });

      it('Operation เพิ่มในงานของคนอื่น -> 201', async () => {
        const { task } = await seedOwnTask();
        const opUser = await makeUser(prisma, { role: 'Operation' });

        await postNote(task.id, opUser.id, 'Operation', {
          note: 'ตรวจแล้ว',
        }).expect(201);
      });

      it('OT ที่ไม่ใช่เจ้าของงาน -> 404', async () => {
        const { task } = await seedOwnTask();
        const otUser = await makeUser(prisma, { role: 'OT' });

        await postNote(task.id, otUser.id, 'OT', { note: 'x' }).expect(404);
        expect(await prisma.taskEvent.count()).toBe(0);
      });

      it('Auditor (อ่านได้แต่เพิ่มไม่ได้) -> 403', async () => {
        const { task } = await seedOwnTask();
        const auditorUser = await makeUser(prisma, { role: 'Auditor' });

        await postNote(task.id, auditorUser.id, 'Auditor', {
          note: 'x',
        }).expect(403);
      });

      it('งาน cancelled -> 409', async () => {
        const { stUser, task } = await seedOwnTask();
        await prisma.task.update({
          where: { id: task.id },
          data: { status: 'cancelled' },
        });

        await postNote(task.id, stUser.id, 'ST', { note: 'x' }).expect(409);
      });

      it.each([
        ['ไม่ส่ง note', {}],
        ['note ว่าง', { note: '' }],
        ['note ช่องว่างล้วน', { note: '   ' }],
        ['note ยาวเกิน 2000', { note: 'ก'.repeat(2001) }],
        [
          'ส่ง field อื่นปน (photoUrl — ตัดออกจากสโคป)',
          { note: 'x', photoUrl: 'a' },
        ],
      ])('%s -> 400', async (_label, body) => {
        const { stUser, task } = await seedOwnTask();
        await postNote(task.id, stUser.id, 'ST', body).expect(400);
      });
    });
  });
});
