import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { CustomerModule } from '../../src/customer/customer.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  createTestPrisma,
  makeUser,
  resetDb,
  TEST_DATABASE_URL,
} from './setup';

process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * `GET /customers` — list ย่อ (id + companyName) สำหรับ dropdown filter บนหน้า
 * Device Search (docs/12_CustomerScope_Proposal.md เฟส B, PR #127) ผ่าน HTTP
 * จริง · JwtAuthGuard อย่างเดียว (ไม่มี PermissionGuard) — mirror
 * users-http.integration-spec.ts
 */
describe('CustomerController (integration — real postgres + JwtAuthGuard)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        CustomerModule,
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
    await request(app.getHttpServer()).get('/api/v1/customers').expect(401);
  });

  it('เรียงตามชื่อบริษัท คืนแค่ id/companyName — ทุก role ที่ login เรียกได้', async () => {
    const northern = await prisma.customer.create({
      data: { companyName: 'Northern Fleet' },
    });
    const abc = await prisma.customer.create({
      data: { companyName: 'ABC Logistics' },
    });
    // field อื่นมีค่าด้วย แต่ endpoint นี้ต้องไม่คืนออกมา
    const metro = await prisma.customer.create({
      data: {
        companyName: 'Metro Transit',
        contactName: 'คุณสมชาย',
        email: 'test@example.com',
        phone: '0800000000',
      },
    });
    // ST เป็น role ที่ไม่มีสิทธิ์อื่นในระบบเลยนอกจากงานของตัวเอง — ยืนยันว่า
    // ไม่ต้องมี permission พิเศษก็เรียก /customers ได้
    const caller = await makeUser(prisma, { role: 'ST' });

    const res = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${tokenFor(caller.id, 'ST')}`)
      .expect(200);

    expect(res.body).toEqual([
      { id: abc.id, companyName: 'ABC Logistics' },
      { id: metro.id, companyName: 'Metro Transit' },
      { id: northern.id, companyName: 'Northern Fleet' },
    ]);
  });

  it('ไม่มีลูกค้าในระบบ -> คืน array ว่าง', async () => {
    const caller = await makeUser(prisma, { role: 'ConfigEngineer' });

    const res = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${tokenFor(caller.id, 'ConfigEngineer')}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });
});
