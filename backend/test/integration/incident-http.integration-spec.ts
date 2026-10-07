import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import {
  ActionType,
  DeviceLifecycleStatus,
  IncidentStatus,
  PrismaClient,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { IncidentModule } from '../../src/incident/incident.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  createTestPrisma,
  getOrCreateDeviceModel,
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

  async function makeDevice(
    deviceId: string,
    status: DeviceLifecycleStatus = 'installed',
    deviceModel = 'GT06N',
  ): Promise<void> {
    const model = await getOrCreateDeviceModel(prisma, deviceModel);
    await prisma.device.create({
      data: {
        deviceId,
        simNumber: `sim-${deviceId}`,
        deviceModel,
        protocol: 'TCP',
        status,
        modelId: model.id,
      },
    });
  }

  async function makeConfig(): Promise<string> {
    const user = await makeUser(prisma, { role: 'ConfigEngineer' });
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
      const user = await makeUser(prisma, { role: 'ConfigEngineer' });
      await grant('ConfigEngineer', ActionType.Read, 'config');
      const token = tokenFor(user.id, 'ConfigEngineer');

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

  /** Field Incident Report (issue #236) — ST/OT แจ้งปัญหา + Operation ตัดสินใจ */
  describe('Field Incident Report (issue #236)', () => {
    let stGranted = false;
    let otGranted = false;
    let opGranted = false;
    beforeEach(() => {
      stGranted = false;
      otGranted = false;
      opGranted = false;
    });

    async function stToken(): Promise<string> {
      if (!stGranted) {
        await grant('ST', ActionType.Create, 'incidents');
        await grant('ST', ActionType.Read, 'incidents');
        stGranted = true;
      }
      const stUser = await makeUser(prisma, { role: 'ST' });
      return tokenFor(stUser.id, 'ST');
    }

    async function otToken(): Promise<{ id: string; token: string }> {
      if (!otGranted) {
        await grant('OT', ActionType.Create, 'incidents');
        await grant('OT', ActionType.Read, 'incidents');
        otGranted = true;
      }
      const otUser = await makeUser(prisma, { role: 'OT' });
      return { id: otUser.id, token: tokenFor(otUser.id, 'OT') };
    }

    async function opToken(): Promise<string> {
      if (!opGranted) {
        await grant('Operation', ActionType.Approve, 'incidents');
        await grant('Operation', ActionType.Read, 'incidents');
        opGranted = true;
      }
      const opUser = await makeUser(prisma, { role: 'Operation' });
      return tokenFor(opUser.id, 'Operation');
    }

    describe('POST /incidents', () => {
      it('ไม่ส่ง Authorization -> 401', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/incidents')
          .send({ title: 'สายชาร์จหลุด', severity: 'low' })
          .expect(401);
      });

      it('role ไม่มี incidents.Create (Auditor มีแค่ Read) -> 403', async () => {
        const token = await auditorToken();
        await request(app.getHttpServer())
          .post('/api/v1/incidents')
          .set('Authorization', `Bearer ${token}`)
          .send({ title: 'สายชาร์จหลุด', severity: 'low' })
          .expect(403);
      });

      it('ไม่ส่ง title -> 400', async () => {
        const token = await stToken();
        await request(app.getHttpServer())
          .post('/api/v1/incidents')
          .set('Authorization', `Bearer ${token}`)
          .send({ severity: 'low' })
          .expect(400);
      });

      it('ไม่ส่ง description -> 400', async () => {
        const token = await stToken();
        await request(app.getHttpServer())
          .post('/api/v1/incidents')
          .set('Authorization', `Bearer ${token}`)
          .send({ title: 'สายชาร์จหลุด', severity: 'low' })
          .expect(400);
      });

      it('severity ไม่อยู่ใน enum -> 400', async () => {
        const token = await stToken();
        await request(app.getHttpServer())
          .post('/api/v1/incidents')
          .set('Authorization', `Bearer ${token}`)
          .send({ title: 'สายชาร์จหลุด', severity: 'urgent' })
          .expect(400);
      });

      it('ส่ง reportedBy/status/source เองมาด้วย -> ถูก whitelist ตัดทิ้ง ไม่กระทบค่าจริง (400 เพราะ forbidNonWhitelisted)', async () => {
        const token = await stToken();
        await request(app.getHttpServer())
          .post('/api/v1/incidents')
          .set('Authorization', `Bearer ${token}`)
          .send({
            title: 'สายชาร์จหลุด',
            severity: 'low',
            reportedBy: 'someone-else',
            status: 'resolved',
          })
          .expect(400);
      });

      it('ST แจ้งสำเร็จ -> 201 source field-report + reportedBy ตัวเอง + AuditLog report', async () => {
        await makeDevice('INC-DEV-1');
        const stUser = await makeUser(prisma, { role: 'ST' });
        await grant('ST', ActionType.Create, 'incidents');
        const token = tokenFor(stUser.id, 'ST');

        const res = await request(app.getHttpServer())
          .post('/api/v1/incidents')
          .set('Authorization', `Bearer ${token}`)
          .send({
            title: 'สายชาร์จหลุด',
            description: 'พบตอนตรวจเวร',
            severity: 'medium',
            deviceId: 'INC-DEV-1',
          })
          .expect(201);

        const body = res.body as {
          id: string;
          status: string;
          source: string;
          reportedBy: string;
          deviceId: string;
        };
        expect(body.status).toBe('open');
        expect(body.source).toBe('field-report');
        expect(body.reportedBy).toBe(stUser.id);
        expect(body.deviceId).toBe('INC-DEV-1');

        const audit = await prisma.auditLog.findFirst({
          where: { auditModule: 'incident', action: 'report' },
        });
        expect(audit).not.toBeNull();
      });

      it('แจ้งเตือน Operation ทุกคนที่ active (incident_report_pending)', async () => {
        const op1 = await makeUser(prisma, { role: 'Operation' });
        const op2 = await makeUser(prisma, { role: 'Operation' });
        const token = await stToken();

        await request(app.getHttpServer())
          .post('/api/v1/incidents')
          .set('Authorization', `Bearer ${token}`)
          .send({
            title: 'GPS ไม่ส่งสัญญาณ',
            description: 'ตรวจสอบแล้วไม่มีสัญญาณมา 2 วัน',
            severity: 'high',
          })
          .expect(201);

        const notifications = await prisma.notification.findMany({
          where: { type: 'incident_report_pending' },
        });
        const notifiedUserIds = notifications.map((n) => n.userId);
        expect(notifiedUserIds).toEqual(
          expect.arrayContaining([op1.id, op2.id]),
        );
      });
    });

    describe('POST /incidents/:id/decide', () => {
      async function makeFieldReport(
        reporterId: string,
        deviceId?: string,
      ): Promise<string> {
        const incident = await prisma.incident.create({
          data: {
            title: 'รายงานจากภาคสนาม',
            severity: 'high',
            status: 'open',
            source: 'field-report',
            reportedBy: reporterId,
            deviceId,
          },
        });
        return incident.id;
      }

      it('ไม่ส่ง Authorization -> 401', async () => {
        const { id: reporterId } = await otToken();
        const incidentId = await makeFieldReport(reporterId);
        await request(app.getHttpServer())
          .post(`/api/v1/incidents/${incidentId}/decide`)
          .send({ outcome: 'resolve', note: 'แก้แล้ว' })
          .expect(401);
      });

      it('role ST (ไม่มีสิทธิ์ Approve) -> 403', async () => {
        const token = await stToken();
        const stUser = await makeUser(prisma, { role: 'ST' });
        const incidentId = await makeFieldReport(stUser.id);
        await request(app.getHttpServer())
          .post(`/api/v1/incidents/${incidentId}/decide`)
          .set('Authorization', `Bearer ${token}`)
          .send({ outcome: 'resolve', note: 'แก้แล้ว' })
          .expect(403);
      });

      it('ไม่พบ incident -> 404', async () => {
        const token = await opToken();
        await request(app.getHttpServer())
          .post(`/api/v1/incidents/${randomUUID()}/decide`)
          .set('Authorization', `Bearer ${token}`)
          .send({ outcome: 'resolve', note: 'แก้แล้ว' })
          .expect(404);
      });

      it('incident ที่ไม่ใช่ field report (auto-detect เดิม) -> 404', async () => {
        const token = await opToken();
        const incidentId = await makeIncident({ title: 'auto-detect' });
        await request(app.getHttpServer())
          .post(`/api/v1/incidents/${incidentId}/decide`)
          .set('Authorization', `Bearer ${token}`)
          .send({ outcome: 'resolve', note: 'แก้แล้ว' })
          .expect(404);
      });

      it('outcome ไม่อยู่ใน enum -> 400', async () => {
        const token = await opToken();
        const { id: reporterId } = await otToken();
        const incidentId = await makeFieldReport(reporterId);
        await request(app.getHttpServer())
          .post(`/api/v1/incidents/${incidentId}/decide`)
          .set('Authorization', `Bearer ${token}`)
          .send({ outcome: 'approve', note: 'x' })
          .expect(400);
      });

      it('ไม่ส่ง note -> 400', async () => {
        const token = await opToken();
        const { id: reporterId } = await otToken();
        const incidentId = await makeFieldReport(reporterId);
        await request(app.getHttpServer())
          .post(`/api/v1/incidents/${incidentId}/decide`)
          .set('Authorization', `Bearer ${token}`)
          .send({ outcome: 'resolve' })
          .expect(400);
      });

      it('outcome resolve -> 200 สถานะ resolved + device:null + AuditLog decide + แจ้งเตือนผู้รายงาน', async () => {
        const token = await opToken();
        const { id: reporterId } = await otToken();
        const incidentId = await makeFieldReport(reporterId, 'INC-DEV-2');

        const res = await request(app.getHttpServer())
          .post(`/api/v1/incidents/${incidentId}/decide`)
          .set('Authorization', `Bearer ${token}`)
          .send({ outcome: 'resolve', note: 'เปลี่ยนสายชาร์จให้แล้ว' })
          .expect(200);

        const body = res.body as {
          status: string;
          reviewNote: string;
          device: unknown;
        };
        expect(body.status).toBe('resolved');
        expect(body.reviewNote).toBe('เปลี่ยนสายชาร์จให้แล้ว');
        expect(body.device).toBeNull();

        const audit = await prisma.auditLog.findFirst({
          where: { auditModule: 'incident', action: 'decide' },
        });
        expect(audit).not.toBeNull();

        const notification = await prisma.notification.findFirst({
          where: { userId: reporterId, type: 'incident_report_resolved' },
        });
        expect(notification).not.toBeNull();
      });

      it('outcome dismiss -> 200 สถานะ dismissed + แจ้งเตือน incident_report_dismissed', async () => {
        const token = await opToken();
        const { id: reporterId } = await otToken();
        const incidentId = await makeFieldReport(reporterId);

        const res = await request(app.getHttpServer())
          .post(`/api/v1/incidents/${incidentId}/decide`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            outcome: 'dismiss',
            note: 'ไม่ใช่ปัญหาจริง ซ้ำกับที่แจ้งไปแล้ว',
          })
          .expect(200);

        expect((res.body as { status: string }).status).toBe('dismissed');

        const notification = await prisma.notification.findFirst({
          where: { userId: reporterId, type: 'incident_report_dismissed' },
        });
        expect(notification).not.toBeNull();
      });

      it('outcome promote + มี deviceId ที่มีอุปกรณ์จริง -> 200 สถานะ investigating + device ระบุ deviceModel/protocol', async () => {
        await makeDevice('INC-DEV-3', 'installed', 'GT06N');
        const token = await opToken();
        const { id: reporterId } = await otToken();
        const incidentId = await makeFieldReport(reporterId, 'INC-DEV-3');

        const res = await request(app.getHttpServer())
          .post(`/api/v1/incidents/${incidentId}/decide`)
          .set('Authorization', `Bearer ${token}`)
          .send({ outcome: 'promote', note: 'ต้องแก้ด้วย Campaign' })
          .expect(200);

        const body = res.body as {
          status: string;
          device: { deviceId: string; deviceModel: string; protocol: string };
        };
        expect(body.status).toBe('investigating');
        expect(body.device).toEqual({
          deviceId: 'INC-DEV-3',
          deviceModel: 'GT06N',
          protocol: 'TCP',
        });

        const notification = await prisma.notification.findFirst({
          where: { userId: reporterId, type: 'incident_report_promoted' },
        });
        expect(notification).not.toBeNull();
      });

      it('outcome promote แต่ไม่มี deviceId ผูกไว้ -> 200 device:null', async () => {
        const token = await opToken();
        const { id: reporterId } = await otToken();
        const incidentId = await makeFieldReport(reporterId);

        const res = await request(app.getHttpServer())
          .post(`/api/v1/incidents/${incidentId}/decide`)
          .set('Authorization', `Bearer ${token}`)
          .send({ outcome: 'promote', note: 'ต้องแก้ด้วย Campaign' })
          .expect(200);

        expect((res.body as { device: unknown }).device).toBeNull();
      });

      it('ตัดสินใจซ้ำ incident ที่ตัดสินใจไปแล้ว -> 409', async () => {
        const token = await opToken();
        const { id: reporterId } = await otToken();
        const incidentId = await makeFieldReport(reporterId);

        await request(app.getHttpServer())
          .post(`/api/v1/incidents/${incidentId}/decide`)
          .set('Authorization', `Bearer ${token}`)
          .send({ outcome: 'resolve', note: 'แก้แล้ว' })
          .expect(200);

        await request(app.getHttpServer())
          .post(`/api/v1/incidents/${incidentId}/decide`)
          .set('Authorization', `Bearer ${token}`)
          .send({ outcome: 'dismiss', note: 'ลองซ้ำ' })
          .expect(409);
      });
    });

    describe('self-scoping สำหรับ field report (GET /incidents, GET /incidents/:id)', () => {
      it('ST เห็นเฉพาะ field report ของตัวเอง + เห็น incident auto-detect ของทุกคน', async () => {
        const { id: ownerId, token } = await otToken();
        const ownReportId = await makeFieldReport(ownerId);

        const { id: otherOtId } = await otToken();
        const otherReportId = await makeFieldReport(otherOtId);

        const autoDetectId = await makeIncident({ title: 'auto-detect' });

        const res = await request(app.getHttpServer())
          .get('/api/v1/incidents')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        const ids = (res.body as { id: string }[]).map((i) => i.id);
        expect(ids).toContain(ownReportId);
        expect(ids).toContain(autoDetectId);
        expect(ids).not.toContain(otherReportId);
      });

      it('OT เปิดดู field report ของคนอื่นตรงๆ -> 404 (ไม่ใช่ 403 — กัน IDOR เปิดเผยว่ามี record)', async () => {
        const { id: otherOtId } = await otToken();
        const otherReportId = await makeFieldReport(otherOtId);

        const { token } = await otToken();
        await request(app.getHttpServer())
          .get(`/api/v1/incidents/${otherReportId}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(404);
      });

      it('Operation (unscoped role) เห็น field report ของทุกคน', async () => {
        const { id: otId } = await otToken();
        const reportId = await makeFieldReport(otId);
        const opTok = await opToken();

        await request(app.getHttpServer())
          .get(`/api/v1/incidents/${reportId}`)
          .set('Authorization', `Bearer ${opTok}`)
          .expect(200);
      });

      async function makeFieldReport(reporterId: string): Promise<string> {
        const incident = await prisma.incident.create({
          data: {
            title: 'รายงานจากภาคสนาม',
            severity: 'low',
            status: 'open',
            source: 'field-report',
            reportedBy: reporterId,
          },
        });
        return incident.id;
      }
    });
  });
});
