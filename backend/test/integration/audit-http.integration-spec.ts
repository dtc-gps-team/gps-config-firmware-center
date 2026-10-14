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

  it('role ไม่มี audit-logs.Read (เช่น ConfigEngineer) -> 403', async () => {
    const user = await makeUser(prisma, { role: 'ConfigEngineer' });
    await grant('ConfigEngineer', ActionType.Read, 'config');
    const token = tokenFor(user.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('Auditor (ได้ audit-logs.Read) -> list ทั้งหมด เรียง createdAt desc', async () => {
    const actor = await makeUser(prisma, { role: 'ConfigEngineer' });
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

    const body = res.body as {
      items: { action: string }[];
      total: number;
      page: number;
      pageSize: number;
    };
    expect(body.items.map((r) => r.action)).toEqual(['approve', 'create']);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
  });

  it('filter auditModule + action', async () => {
    const actor = await makeUser(prisma, { role: 'ConfigEngineer' });
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

    const body = (
      res.body as {
        items: { auditModule: string; action: string }[];
      }
    ).items;
    expect(body).toHaveLength(1);
    expect(body[0].auditModule).toBe('config-deletion');
    expect(body[0].action).toBe('approve');
  });

  it('filter userId', async () => {
    const actorA = await makeUser(prisma, { role: 'ConfigEngineer' });
    const actorB = await makeUser(prisma, { role: 'ConfigEngineer' });
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

    const body = (res.body as { items: { userId: string }[] }).items;
    expect(body).toHaveLength(1);
    expect(body[0].userId).toBe(actorA.id);
  });

  it('page/pageSize -> ได้เฉพาะหน้าที่ขอ + total ยังนับทุกแถวที่ตรง filter', async () => {
    const actor = await makeUser(prisma, { role: 'ConfigEngineer' });
    for (let i = 1; i <= 5; i++) {
      await prisma.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: 'config',
          action: `action-${i}`,
          createdAt: new Date(`2026-01-0${i}T00:00:00.000Z`),
        },
      });
    }
    const caller = await makeUser(prisma, { role: 'Auditor' });
    await grant('Auditor', ActionType.Read, 'audit-logs');

    const res = await request(app.getHttpServer())
      .get('/api/v1/audit-logs?page=2&pageSize=2')
      .set('Authorization', `Bearer ${tokenFor(caller.id, 'Auditor')}`)
      .expect(200);

    const body = res.body as {
      items: { action: string }[];
      total: number;
      page: number;
      pageSize: number;
    };
    expect(body.items.map((r) => r.action)).toEqual(['action-3', 'action-2']);
    expect(body.total).toBe(5);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(2);
  });

  it('pageSize เกิน 100 หรือ page < 1 -> 400', async () => {
    const caller = await makeUser(prisma, { role: 'Auditor' });
    await grant('Auditor', ActionType.Read, 'audit-logs');
    const token = tokenFor(caller.id, 'Auditor');

    await request(app.getHttpServer())
      .get('/api/v1/audit-logs?pageSize=101')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/audit-logs?page=0')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  describe('filter วันที่ (from/to) และชื่อผู้ทำรายการ (actorName)', () => {
    async function seed() {
      const actor = await makeUser(prisma, { role: 'ConfigEngineer' });
      const times = [
        // ขอบเขตวันที่ 14 ต.ค. เวลาไทย = 13 ต.ค. 17:00Z ถึง 14 ต.ค. 16:59:59.999Z
        ['before', '2026-10-13T16:59:59.999Z'],
        ['start', '2026-10-13T17:00:00.000Z'],
        ['end', '2026-10-14T16:59:59.999Z'],
        ['after', '2026-10-14T17:00:00.000Z'],
      ] as const;
      for (const [action, at] of times) {
        await prisma.auditLog.create({
          data: {
            userId: actor.id,
            auditModule: 'config',
            action,
            createdAt: new Date(at),
          },
        });
      }
      const caller = await makeUser(prisma, { role: 'Auditor' });
      await grant('Auditor', ActionType.Read, 'audit-logs');
      return { token: tokenFor(caller.id, 'Auditor') };
    }

    async function actions(token: string, qs: string): Promise<string[]> {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/audit-logs?${qs}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return (res.body as { items: { action: string }[] }).items
        .map((r) => r.action)
        .sort();
    }

    it('from + to รวมแถวที่เวลาตรงขอบทั้งสองด้าน ไม่รวมนอกช่วง', async () => {
      const { token } = await seed();

      const got = await actions(
        token,
        'from=2026-10-13T17:00:00.000Z&to=2026-10-14T16:59:59.999Z',
      );

      expect(got).toEqual(['end', 'start']);
    });

    it('ส่งแค่ from -> ตั้งแต่เวลานั้นเป็นต้นไป', async () => {
      const { token } = await seed();

      expect(await actions(token, 'from=2026-10-14T16:59:59.999Z')).toEqual([
        'after',
        'end',
      ]);
    });

    it('from มากกว่า to -> 400', async () => {
      const { token } = await seed();

      await request(app.getHttpServer())
        .get(
          '/api/v1/audit-logs?from=2026-10-14T00:00:00.000Z&to=2026-10-13T00:00:00.000Z',
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('from ไม่ใช่วันที่ -> 400', async () => {
      const { token } = await seed();

      await request(app.getHttpServer())
        .get('/api/v1/audit-logs?from=not-a-date')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('actorName ค้นบางส่วนไม่สนตัวพิมพ์ และเจอบัญชีที่ปิดใช้งานแล้ว', async () => {
      const active = await makeUser(prisma, {
        role: 'ConfigEngineer',
        fullName: 'Somchai Active',
      });
      const inactive = await makeUser(prisma, {
        role: 'ConfigEngineer',
        fullName: 'Somsri Resigned',
        isActive: false,
      });
      const other = await makeUser(prisma, {
        role: 'ConfigEngineer',
        fullName: 'Wichai Other',
      });
      for (const [u, action] of [
        [active, 'by-active'],
        [inactive, 'by-inactive'],
        [other, 'by-other'],
      ] as const) {
        await prisma.auditLog.create({
          data: { userId: u.id, auditModule: 'config', action },
        });
      }
      const caller = await makeUser(prisma, { role: 'Auditor' });
      await grant('Auditor', ActionType.Read, 'audit-logs');
      const token = tokenFor(caller.id, 'Auditor');

      expect(await actions(token, 'actorName=SOM')).toEqual([
        'by-active',
        'by-inactive',
      ]);
      expect(await actions(token, 'actorName=resigned')).toEqual([
        'by-inactive',
      ]);
    });

    it('actorName ใช้ร่วมกับช่วงวันที่ (AND)', async () => {
      const { token } = await seed();

      expect(
        await actions(
          token,
          'actorName=Integration&from=2026-10-13T17:00:00.000Z&to=2026-10-13T17:00:00.000Z',
        ),
      ).toEqual(['start']);
      expect(await actions(token, 'actorName=NoSuchPerson')).toEqual([]);
    });
  });
});
