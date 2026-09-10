import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { ActionType, IncidentStatus, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { IncidentModule } from '../../src/incident/incident.module';
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
 * Incident read-only endpoints — `GET /incidents` + `GET /incidents/:id`
 * ผ่าน HTTP จริง (JwtAuthGuard -> PermissionGuard เต็มเส้นทาง)
 */
describe('IncidentController (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // IncidentModule -> ConfigSyncWriterModule มี provider ที่ inject
      // @nestjs/config (CONFIG_SYNC_WRITER useFactory) — ต้อง forRoot เอง
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        IncidentModule,
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

  /** ทุก Role มี `incidents` Read — ใช้ Auditor เป็นตัวแทน (role ที่ไม่มีสิทธิ์
   * อื่นในโมดูล incident เลย) เพื่อยืนยันว่า grant `incidents` อย่างเดียวพอ */
  async function auditorToken(): Promise<string> {
    const user = await makeUser(prisma, { role: 'Auditor' });
    await grant('Auditor', ActionType.Read, 'incidents');
    return tokenFor(user.id, 'Auditor');
  }

  async function makeConfig(): Promise<string> {
    const user = await makeUser(prisma, { role: 'SW' });
    const config = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'approved',
        fields: { APN: 'internet' },
        createdBy: user.id,
      },
    });
    return config.id;
  }

  async function makeIncident(over: {
    title: string;
    status?: IncidentStatus;
    relatedConfigId?: string;
    createdAt?: Date;
  }): Promise<string> {
    const incident = await prisma.incident.create({
      data: {
        title: over.title,
        severity: 'high',
        status: over.status ?? 'open',
        relatedConfigId: over.relatedConfigId ?? null,
        source: 'config-sync-writer',
        ...(over.createdAt ? { createdAt: over.createdAt } : {}),
      },
    });
    return incident.id;
  }

  describe('GET /incidents', () => {
    it('ไม่ส่ง Authorization -> 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/incidents').expect(401);
    });

    it('role ไม่มี incidents.Read -> 403', async () => {
      const user = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Read, 'config');
      const token = tokenFor(user.id, 'SW');

      await request(app.getHttpServer())
        .get('/api/v1/incidents')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('list ทั้งหมด เรียงตาม createdAt desc (ใหม่สุดก่อน)', async () => {
      await makeIncident({
        title: 'เก่า',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      await makeIncident({
        title: 'ใหม่',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      });
      const token = await auditorToken();

      const res = await request(app.getHttpServer())
        .get('/api/v1/incidents')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { title: string }[];
      expect(body.map((i) => i.title)).toEqual(['ใหม่', 'เก่า']);
    });

    it('filter status', async () => {
      await makeIncident({ title: 'A', status: 'open' });
      await makeIncident({ title: 'B', status: 'resolved' });
      const token = await auditorToken();

      const res = await request(app.getHttpServer())
        .get('/api/v1/incidents?status=resolved')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { title: string }[];
      expect(body.map((i) => i.title)).toEqual(['B']);
    });

    it('filter relatedConfigId', async () => {
      const configId = await makeConfig();
      await makeIncident({ title: 'ผูก config', relatedConfigId: configId });
      await makeIncident({ title: 'ไม่ผูก' });
      const token = await auditorToken();

      const res = await request(app.getHttpServer())
        .get(`/api/v1/incidents?relatedConfigId=${configId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { title: string }[];
      expect(body.map((i) => i.title)).toEqual(['ผูก config']);
    });

    it('status ไม่อยู่ใน enum -> 400', async () => {
      const token = await auditorToken();

      await request(app.getHttpServer())
        .get('/api/v1/incidents?status=broken')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('GET /incidents/:id', () => {
    it('เจอ -> 200 record เดียว', async () => {
      const id = await makeIncident({ title: 'รายละเอียด' });
      const token = await auditorToken();

      const res = await request(app.getHttpServer())
        .get(`/api/v1/incidents/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as {
        id: string;
        title: string;
        severity: string;
        status: string;
        source: string;
      };
      expect(body.id).toBe(id);
      expect(body.title).toBe('รายละเอียด');
      expect(body.severity).toBe('high');
      expect(body.status).toBe('open');
      expect(body.source).toBe('config-sync-writer');
    });

    it('ไม่พบ -> 404', async () => {
      const token = await auditorToken();

      await request(app.getHttpServer())
        .get(`/api/v1/incidents/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
