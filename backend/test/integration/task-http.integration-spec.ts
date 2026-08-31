import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { TaskModule } from '../../src/task/task.module';
import {
  createTestPrisma,
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
      imports: [PrismaModule, TaskModule],
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

  it('POST /tasks role SW (ไม่ใช่ Operation) -> 403', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    const token = tokenFor(swUser.id, 'SW');

    await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x', assignedTo: swUser.id })
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
});
