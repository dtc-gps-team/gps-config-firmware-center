import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, Config, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigDeletionModule } from '../../src/config-deletion/config-deletion.module';
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

/**
 * docs/11 Part A — คำขอลบ Config อัตโนมัติ · ทดสอบ endpoint ทั้ง 4 ผ่าน HTTP
 * จริง (JwtAuthGuard -> PermissionGuard เต็มเส้นทาง) + ผลข้างเคียง (soft delete,
 * AuditLog, reset นาฬิกา)
 *
 * scheduled job (`sweep()`) ทดสอบใน unit spec (`config-deletion.service.spec.ts`)
 */
describe('ConfigDeletion Part A endpoints (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        ConfigDeletionModule,
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

  let configSeq = 0;
  async function makeStaleConfig(createdBy: string): Promise<Config> {
    configSeq += 1;
    return prisma.config.create({
      data: {
        name: `stale-${Date.now()}-${configSeq}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: {},
        status: 'draft',
        createdBy,
      },
    });
  }

  async function makePendingRequest(configId: string): Promise<string> {
    const req = await prisma.configDeletionRequest.create({
      data: { configId, reason: 'เข้าเกณฑ์ (test)' },
    });
    return req.id;
  }

  it('GET /config-deletion-requests ไม่มี token -> 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/config-deletion-requests')
      .expect(401);
  });

  it('GET /config-deletion-requests role ไม่มี config-deletion.Read (Admin) -> 403', async () => {
    const admin = await makeUser(prisma, { role: 'Admin' });
    await request(app.getHttpServer())
      .get('/api/v1/config-deletion-requests')
      .set('Authorization', `Bearer ${tokenFor(admin.id, 'Admin')}`)
      .expect(403);
  });

  it('GET /config-deletion-requests เป็น SuperAdmin -> 200 คืนคิว pending', async () => {
    await grant('SuperAdmin', ActionType.Read, 'config-deletion');
    const sa = await makeUser(prisma, { role: 'SuperAdmin' });
    const cfg = await makeStaleConfig(sa.id);
    await makePendingRequest(cfg.id);

    const res = await request(app.getHttpServer())
      .get('/api/v1/config-deletion-requests')
      .set('Authorization', `Bearer ${tokenFor(sa.id, 'SuperAdmin')}`)
      .expect(200);

    const body = res.body as { configId: string; status: string }[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ configId: cfg.id, status: 'pending' });
  });

  it('POST .../{id}/approve -> 200 · Config ถูก soft-delete + AuditLog', async () => {
    await grant('SuperAdmin', ActionType.Approve, 'config-deletion');
    const sa = await makeUser(prisma, { role: 'SuperAdmin' });
    const cfg = await makeStaleConfig(sa.id);
    const reqId = await makePendingRequest(cfg.id);

    await request(app.getHttpServer())
      .post(`/api/v1/config-deletion-requests/${reqId}/approve`)
      .set('Authorization', `Bearer ${tokenFor(sa.id, 'SuperAdmin')}`)
      .expect(200);

    const after = await prisma.config.findUnique({ where: { id: cfg.id } });
    expect(after?.deletedAt).not.toBeNull();
    const dr = await prisma.configDeletionRequest.findUnique({
      where: { id: reqId },
    });
    expect(dr?.status).toBe('approved');
    expect(dr?.reviewedBy).toBe(sa.id);
    const audit = await prisma.auditLog.findMany({
      where: { auditModule: 'config-deletion', action: 'approve' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].userId).toBe(sa.id);
  });

  it('POST .../{id}/approve ซ้ำบนคำขอที่ตัดสินแล้ว -> 409', async () => {
    await grant('SuperAdmin', ActionType.Approve, 'config-deletion');
    const sa = await makeUser(prisma, { role: 'SuperAdmin' });
    const cfg = await makeStaleConfig(sa.id);
    const reqId = await makePendingRequest(cfg.id);
    await prisma.configDeletionRequest.update({
      where: { id: reqId },
      data: { status: 'approved' },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/config-deletion-requests/${reqId}/approve`)
      .set('Authorization', `Bearer ${tokenFor(sa.id, 'SuperAdmin')}`)
      .expect(409);
  });

  it('POST .../{id}/reject มี note -> 200 · decisionNote ถูกเก็บ · Config ไม่ถูกลบ', async () => {
    await grant('SuperAdmin', ActionType.Approve, 'config-deletion');
    const sa = await makeUser(prisma, { role: 'SuperAdmin' });
    const cfg = await makeStaleConfig(sa.id);
    const reqId = await makePendingRequest(cfg.id);

    await request(app.getHttpServer())
      .post(`/api/v1/config-deletion-requests/${reqId}/reject`)
      .set('Authorization', `Bearer ${tokenFor(sa.id, 'SuperAdmin')}`)
      .send({ note: 'ยังต้องใช้ชุดนี้' })
      .expect(200);

    const dr = await prisma.configDeletionRequest.findUnique({
      where: { id: reqId },
    });
    expect(dr?.status).toBe('rejected');
    expect(dr?.decisionNote).toBe('ยังต้องใช้ชุดนี้');
    const cfgAfter = await prisma.config.findUnique({ where: { id: cfg.id } });
    expect(cfgAfter?.deletedAt).toBeNull();
  });

  it('POST .../{id}/reject ไม่ส่ง note -> 400', async () => {
    await grant('SuperAdmin', ActionType.Approve, 'config-deletion');
    const sa = await makeUser(prisma, { role: 'SuperAdmin' });
    const cfg = await makeStaleConfig(sa.id);
    const reqId = await makePendingRequest(cfg.id);

    await request(app.getHttpServer())
      .post(`/api/v1/config-deletion-requests/${reqId}/reject`)
      .set('Authorization', `Bearer ${tokenFor(sa.id, 'SuperAdmin')}`)
      .send({})
      .expect(400);
  });

  it('POST /config/{configId}/deletion-requests/keep เป็น SW -> 200 · cancelled + reset นาฬิกา', async () => {
    await grant('SW', ActionType.Update, 'config');
    const sw = await makeUser(prisma, { role: 'SW' });
    const cfg = await makeStaleConfig(sw.id);
    const reqId = await makePendingRequest(cfg.id);
    const before = (
      await prisma.config.findUniqueOrThrow({ where: { id: cfg.id } })
    ).updatedAt;

    await new Promise((r) => setTimeout(r, 5));
    await request(app.getHttpServer())
      .post(`/api/v1/config/${cfg.id}/deletion-requests/keep`)
      .set('Authorization', `Bearer ${tokenFor(sw.id, 'SW')}`)
      .expect(200);

    const dr = await prisma.configDeletionRequest.findUnique({
      where: { id: reqId },
    });
    expect(dr?.status).toBe('cancelled');
    const cfgAfter = await prisma.config.findUniqueOrThrow({
      where: { id: cfg.id },
    });
    expect(cfgAfter.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it('POST .../keep เมื่อไม่มีคำขอ pending -> 404', async () => {
    await grant('SW', ActionType.Update, 'config');
    const sw = await makeUser(prisma, { role: 'SW' });
    const cfg = await makeStaleConfig(sw.id);

    await request(app.getHttpServer())
      .post(`/api/v1/config/${cfg.id}/deletion-requests/keep`)
      .set('Authorization', `Bearer ${tokenFor(sw.id, 'SW')}`)
      .expect(404);
  });
});
