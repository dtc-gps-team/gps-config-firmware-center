import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuditModule } from '../../src/audit/audit.module';
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
 * `GET /audit-logs` (Sprint 3 #27) ผ่าน HTTP จริง (JwtAuthGuard ->
 * PermissionGuard เต็มเส้นทาง) — resource `audit-logs` action `Read`
 */
describe('AuditController (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
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

  it('ไม่ส่ง Authorization -> 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/audit-logs').expect(401);
  });

  it('role ไม่มี audit-logs.Read (เช่น SW) -> 403', async () => {
    const user = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Read, 'config');
    const token = tokenFor(user.id, 'SW');

    await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('Auditor (ได้ audit-logs.Read) -> list ทั้งหมด เรียง createdAt desc', async () => {
    const actor = await makeUser(prisma, { role: 'SW' });
    await prisma.auditLog.create({
      data: {
        userId: actor.id,
        auditModule: 'config',
        action: 'create',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: actor.id,
        auditModule: 'config',
        action: 'approve',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
    const caller = await makeUser(prisma, { role: 'Auditor' });
    await grant('Auditor', ActionType.Read, 'audit-logs');

    const res = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${tokenFor(caller.id, 'Auditor')}`)
      .expect(200);

    const body = res.body as { action: string }[];
    expect(body.map((r) => r.action)).toEqual(['approve', 'create']);
  });

  it('filter auditModule + action', async () => {
    const actor = await makeUser(prisma, { role: 'SW' });
    await prisma.auditLog.create({
      data: { userId: actor.id, auditModule: 'config', action: 'create' },
    });
    await prisma.auditLog.create({
      data: {
        userId: actor.id,
        auditModule: 'config-deletion',
        action: 'approve',
      },
    });
    const caller = await makeUser(prisma, { role: 'Admin' });
    await grant('Admin', ActionType.Read, 'audit-logs');

    const res = await request(app.getHttpServer())
      .get('/api/v1/audit-logs?auditModule=config-deletion&action=approve')
      .set('Authorization', `Bearer ${tokenFor(caller.id, 'Admin')}`)
      .expect(200);

    const body = res.body as { auditModule: string; action: string }[];
    expect(body).toHaveLength(1);
    expect(body[0].auditModule).toBe('config-deletion');
    expect(body[0].action).toBe('approve');
  });

  it('filter userId', async () => {
    const actorA = await makeUser(prisma, { role: 'SW' });
    const actorB = await makeUser(prisma, { role: 'SW' });
    await prisma.auditLog.create({
      data: { userId: actorA.id, auditModule: 'config', action: 'create' },
    });
    await prisma.auditLog.create({
      data: { userId: actorB.id, auditModule: 'config', action: 'create' },
    });
    const caller = await makeUser(prisma, { role: 'Operation' });
    await grant('Operation', ActionType.Read, 'audit-logs');

    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit-logs?userId=${actorA.id}`)
      .set('Authorization', `Bearer ${tokenFor(caller.id, 'Operation')}`)
      .expect(200);

    const body = res.body as { userId: string }[];
    expect(body).toHaveLength(1);
    expect(body[0].userId).toBe(actorA.id);
  });
});
