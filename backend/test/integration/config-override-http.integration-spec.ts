import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, Config, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigOverrideModule } from '../../src/config-override/config-override.module';
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
 * Per-Field Config Override ACL (issue #185) — ทดสอบ `POST /config/{id}/override`
 * ผ่าน HTTP จริง (JwtAuthGuard -> PermissionGuard -> validateOverridableFields
 * -> transaction เต็มเส้นทาง)
 */
describe('Config Override endpoint (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        ConfigOverrideModule,
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
    // resetDb() ไม่ล้าง ConfigFieldDefinition (ไม่ใช่ทุกไฟล์ integration ใช้
    // ตารางนี้) — ล้างเองที่นี่ mirror `config-definition-http.integration-spec.ts`
    // เพราะ fieldName unique ทั้งระบบ ต้องไม่ให้ test ก่อนหน้าเหลือ 'APN1'/'MTYP'
    // ค้างไว้ชนกับ test ถัดไป (ModelSupport cascade ลบตามเองอยู่แล้ว)
    await prisma.configFieldDefinition.deleteMany();
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

  async function makeOverridableField(
    fieldName: string,
    overridable: boolean,
  ): Promise<void> {
    await prisma.configFieldDefinition.create({
      data: {
        fieldName,
        dataType: 'string',
        allowedValues: [],
        required: false,
        stOverridable: overridable,
        supportedModels: {
          create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
        },
      },
    });
  }

  async function makeApprovedConfig(createdBy: string): Promise<Config> {
    return prisma.config.create({
      data: {
        name: `ambulance-standard-${Date.now()}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: { APN1: 'internet', MTYP: 'auto' },
        status: 'approved',
        createdBy,
      },
    });
  }

  it('ไม่มี token -> 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/config/00000000-0000-0000-0000-000000000000/override')
      .send({ fields: {}, reason: 'x' })
      .expect(401);
  });

  it('role OT (ไม่มี grant config-override เลย) -> 403', async () => {
    const ot = await makeUser(prisma, { role: 'OT' });
    const cfg = await makeApprovedConfig(ot.id);
    await makeOverridableField('APN1', true);

    await request(app.getHttpServer())
      .post(`/api/v1/config/${cfg.id}/override`)
      .set('Authorization', `Bearer ${tokenFor(ot.id, 'OT')}`)
      .send({ fields: { APN1: 'internet-new' }, reason: 'ทดสอบ' })
      .expect(403);
  });

  it('ST + field stOverridable:true -> 200 · merge fields, สร้าง ConfigVersion, เขียน AuditLog', async () => {
    await grant('ST', ActionType.Override, 'config-override');
    const st = await makeUser(prisma, { role: 'ST' });
    const cfg = await makeApprovedConfig(st.id);
    await makeOverridableField('APN1', true);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/config/${cfg.id}/override`)
      .set('Authorization', `Bearer ${tokenFor(st.id, 'ST')}`)
      .send({
        fields: { APN1: 'internet-new' },
        reason: 'ลูกค้าขอเปลี่ยน APN หน้างาน',
      })
      .expect(200);

    const body = res.body as { fields: Record<string, unknown> };
    expect(body.fields).toEqual({ APN1: 'internet-new', MTYP: 'auto' });

    const versions = await prisma.configVersion.findMany({
      where: { configId: cfg.id },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      versionNumber: 1,
      approvedBy: st.id,
      reason: 'ลูกค้าขอเปลี่ยน APN หน้างาน',
    });

    const audit = await prisma.auditLog.findMany({
      where: { auditModule: 'config', action: 'override' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].userId).toBe(st.id);
  });

  it('ST + field stOverridable:false -> 400 ไม่แตะ DB', async () => {
    await grant('ST', ActionType.Override, 'config-override');
    const st = await makeUser(prisma, { role: 'ST' });
    const cfg = await makeApprovedConfig(st.id);
    await makeOverridableField('MTYP', false);

    await request(app.getHttpServer())
      .post(`/api/v1/config/${cfg.id}/override`)
      .set('Authorization', `Bearer ${tokenFor(st.id, 'ST')}`)
      .send({ fields: { MTYP: 'manual' }, reason: 'ทดสอบ' })
      .expect(400);

    const versions = await prisma.configVersion.findMany({
      where: { configId: cfg.id },
    });
    expect(versions).toHaveLength(0);
  });

  it('ไม่ส่ง reason -> 400', async () => {
    await grant('ST', ActionType.Override, 'config-override');
    const st = await makeUser(prisma, { role: 'ST' });
    const cfg = await makeApprovedConfig(st.id);
    await makeOverridableField('APN1', true);

    await request(app.getHttpServer())
      .post(`/api/v1/config/${cfg.id}/override`)
      .set('Authorization', `Bearer ${tokenFor(st.id, 'ST')}`)
      .send({ fields: { APN1: 'internet-new' } })
      .expect(400);
  });

  it('Config สถานะ draft (ยังไม่อนุมัติ) -> 409', async () => {
    await grant('ST', ActionType.Override, 'config-override');
    const st = await makeUser(prisma, { role: 'ST' });
    const cfg = await prisma.config.create({
      data: {
        name: `draft-${Date.now()}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: { APN1: 'internet' },
        status: 'draft',
        createdBy: st.id,
      },
    });
    await makeOverridableField('APN1', true);

    await request(app.getHttpServer())
      .post(`/api/v1/config/${cfg.id}/override`)
      .set('Authorization', `Bearer ${tokenFor(st.id, 'ST')}`)
      .send({ fields: { APN1: 'internet-new' }, reason: 'ทดสอบ' })
      .expect(409);
  });

  it('ไม่พบ Config -> 404', async () => {
    await grant('ST', ActionType.Override, 'config-override');
    const st = await makeUser(prisma, { role: 'ST' });

    await request(app.getHttpServer())
      .post('/api/v1/config/00000000-0000-0000-0000-000000000000/override')
      .set('Authorization', `Bearer ${tokenFor(st.id, 'ST')}`)
      .send({ fields: {}, reason: 'ทดสอบ' })
      .expect(404);
  });
});
