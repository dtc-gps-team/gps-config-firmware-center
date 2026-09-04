import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { NotificationModule } from '../../src/notification/notification.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  createTestPrisma,
  makeUser,
  resetDb,
  TEST_DATABASE_URL,
} from './setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * ทดสอบ device-token endpoints ผ่าน HTTP จริง (supertest) — พิสูจน์ว่า
 * JwtAuthGuard บล็อก request ไม่มี token (401) และ IDOR guard ทำงานจริง
 * (ลบ token ของคนอื่น -> 404)
 */
describe('NotificationController device-tokens (integration — real postgres + JwtAuthGuard)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // NotificationService inject @nestjs/config — forRoot เองเหมือน device-http spec
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        NotificationModule,
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
  });

  function tokenFor(sub: string, role: string): string {
    return jwtService.sign({ sub, role });
  }

  const path = '/api/v1/notifications/device-tokens';

  it('POST ไม่ส่ง Authorization header -> 401', async () => {
    await request(app.getHttpServer())
      .post(path)
      .send({ token: 'fcm-1', platform: 'android' })
      .expect(401);
  });

  it('POST platform ไม่ถูกต้อง -> 400', async () => {
    const user = await makeUser(prisma, { role: 'ST' });
    const jwt = tokenFor(user.id, 'ST');

    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ token: 'fcm-1', platform: 'windows-phone' })
      .expect(400);
  });

  it('POST token ว่าง -> 400', async () => {
    const user = await makeUser(prisma, { role: 'OT' });
    const jwt = tokenFor(user.id, 'OT');

    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ token: '', platform: 'ios' })
      .expect(400);
  });

  it('POST happy path -> 200 + row ผูกกับ user จาก JWT', async () => {
    const user = await makeUser(prisma, { role: 'ST' });
    const jwt = tokenFor(user.id, 'ST');

    const res = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${jwt}`)
      .send({ token: 'fcm-happy', platform: 'android' })
      .expect(200);

    const body = res.body as {
      userId: string;
      token: string;
      platform: string;
    };
    expect(body.userId).toBe(user.id);
    expect(body.token).toBe('fcm-happy');

    const row = await prisma.deviceToken.findUnique({
      where: { token: 'fcm-happy' },
    });
    expect(row?.userId).toBe(user.id);
  });

  it('POST token เดิมซ้ำ (คนละ user) -> upsert ทับ userId ไม่สร้างแถวใหม่', async () => {
    const first = await makeUser(prisma, { role: 'ST' });
    const second = await makeUser(prisma, { role: 'OT' });

    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${tokenFor(first.id, 'ST')}`)
      .send({ token: 'shared-device', platform: 'android' })
      .expect(200);

    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${tokenFor(second.id, 'OT')}`)
      .send({ token: 'shared-device', platform: 'android' })
      .expect(200);

    const rows = await prisma.deviceToken.findMany({
      where: { token: 'shared-device' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(second.id);
  });

  it('DELETE ต้องมี query param token -> 400 ถ้าไม่ส่ง', async () => {
    const user = await makeUser(prisma, { role: 'ST' });
    const jwt = tokenFor(user.id, 'ST');

    await request(app.getHttpServer())
      .delete(path)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(400);
  });

  it('DELETE token ของตัวเอง -> 204 + แถวหาย', async () => {
    const user = await makeUser(prisma, { role: 'ST' });
    await prisma.deviceToken.create({
      data: { userId: user.id, token: 'mine', platform: 'android' },
    });
    const jwt = tokenFor(user.id, 'ST');

    await request(app.getHttpServer())
      .delete(`${path}?token=mine`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(204);

    const row = await prisma.deviceToken.findUnique({
      where: { token: 'mine' },
    });
    expect(row).toBeNull();
  });

  it('DELETE token ของ user อื่น -> 404 (IDOR) + แถวยังอยู่', async () => {
    const owner = await makeUser(prisma, { role: 'ST' });
    const attacker = await makeUser(prisma, { role: 'OT' });
    await prisma.deviceToken.create({
      data: { userId: owner.id, token: 'not-yours', platform: 'android' },
    });
    const jwt = tokenFor(attacker.id, 'OT');

    await request(app.getHttpServer())
      .delete(`${path}?token=not-yours`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(404);

    const row = await prisma.deviceToken.findUnique({
      where: { token: 'not-yours' },
    });
    expect(row?.userId).toBe(owner.id);
  });
});
