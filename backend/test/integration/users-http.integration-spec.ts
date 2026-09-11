import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { UserModule } from '../../src/user/user.module';
import {
  createTestPrisma,
  makeUser,
  resetDb,
  TEST_DATABASE_URL,
} from './setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * `GET /users` — list ย่อสำหรับ dropdown "เจาะจงผู้อนุมัติ" (Approval Center #19)
 * ผ่าน HTTP จริง · JwtAuthGuard อย่างเดียว (ไม่มี PermissionGuard)
 */
describe('UserController (integration — real postgres + JwtAuthGuard)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        UserModule,
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

  it('ไม่ส่ง Authorization -> 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
  });

  it('filter role=Operation -> เฉพาะ Operation ที่ active เรียงตามชื่อ', async () => {
    await makeUser(prisma, {
      role: 'Operation',
      fullName: 'สมหญิง วงศ์ก',
    });
    await makeUser(prisma, {
      role: 'Operation',
      fullName: 'ปฏิภาณ ศรีสุข',
    });
    await makeUser(prisma, {
      role: 'Operation',
      fullName: 'ปิดใช้งาน',
      isActive: false,
    });
    await makeUser(prisma, { role: 'SW', fullName: 'SW คนหนึ่ง' });
    const caller = await makeUser(prisma, { role: 'Auditor' });

    const res = await request(app.getHttpServer())
      .get('/api/v1/users?role=Operation')
      .set('Authorization', `Bearer ${tokenFor(caller.id, 'Auditor')}`)
      .expect(200);

    const body = res.body as { fullName: string; role: string }[];
    expect(body.map((u) => u.fullName)).toEqual([
      'ปฏิภาณ ศรีสุข',
      'สมหญิง วงศ์ก',
    ]);
    expect(body.every((u) => u.role === 'Operation')).toBe(true);
  });

  it('คืนแค่ id/fullName/role — ไม่มี username/passwordHash', async () => {
    const op = await makeUser(prisma, {
      role: 'Operation',
      fullName: 'ทดสอบ',
    });
    const caller = await makeUser(prisma, { role: 'SW' });

    const res = await request(app.getHttpServer())
      .get('/api/v1/users?role=Operation')
      .set('Authorization', `Bearer ${tokenFor(caller.id, 'SW')}`)
      .expect(200);

    expect(res.body).toEqual([
      { id: op.id, fullName: 'ทดสอบ', role: 'Operation' },
    ]);
  });

  it('role ที่ไม่มีจริง -> list ว่าง (ไม่ error)', async () => {
    const caller = await makeUser(prisma, { role: 'SW' });
    const res = await request(app.getHttpServer())
      .get('/api/v1/users?role=NopeRole')
      .set('Authorization', `Bearer ${tokenFor(caller.id, 'SW')}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });
});
