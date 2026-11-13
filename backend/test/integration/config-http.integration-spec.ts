import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigModule } from '../../src/config/config.module';
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

// PrismaService (ผ่าน PrismaModule) อ่าน DATABASE_URL จาก env ตรงๆ — override ให้ชี้
// ไปที่ DB _test เดียวกับที่ integration test อื่นใช้ (เหมือน task-http.integration-spec.ts)
process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * Stage 1-4 (issue #26) — CRUD พื้นฐาน + Import JSON + Simulate +
 * decide/approve/reject ของ ConfigController ผ่าน HTTP จริง (JwtAuthGuard ->
 * PermissionGuard เต็มเส้นทาง)
 */
describe('ConfigController Stage 1-4 CRUD + Import + Simulate + Decide/Approve/Reject (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let gt06nId: string;
  let gt06lId: string;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // ConfigModule (business) ต้องมี NestConfigModule ในกราฟด้วย — ปกติได้
      // มาฟรีตอนรันแอปจริงผ่าน AppModule (ที่เรียก
      // NestConfigModule.forRoot({ isGlobal: true }) ไว้แล้ว) แต่เทสนี้ import
      // แค่ ConfigModule เดี่ยวๆ ไม่ผ่าน AppModule เลย เลยต้อง forRoot() เองที่นี่
      // ไม่งั้น DEVICE_SIMULATOR provider (useFactory ที่ inject
      // @nestjs/config ConfigService) จะ resolve dependency ไม่ได้ — ไม่ต้องตั้ง
      // envFilePath เพราะเทสนี้ไม่ได้พึ่งค่าจริงจาก .env (DEVICE_SIMULATOR_MODE
      // ใช้ default 'mock' อยู่แล้ว)
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        ConfigModule,
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
    // RolePermission + ConfigFieldDefinition ต้อง clean เองทุกเทส —
    // `resetDb` ไม่ได้แตะ 2 ตารางนี้ (ดู comment ใน setup.ts, pattern
    // เดียวกับ config-definition-http.integration-spec.ts)
    await prisma.rolePermission.deleteMany();
    await prisma.configFieldDefinition.deleteMany();
    // DeviceModel (issue #209 ข้อ 4) — ConfigService.create()/update() หารุ่นจาก
    // modelId แล้ว validate protocol จริงผ่าน HTTP นี้ (ไม่ใช่ mock เหมือน
    // config.service.spec.ts) ต้อง seed ให้ทุกเทสในไฟล์นี้ใช้ได้ (เทสส่วนใหญ่ใช้
    // GT06N/TCP, บางเทสเปลี่ยนเป็น GT06L ตอน PUT)
    gt06nId = (await getOrCreateDeviceModel(prisma, 'GT06N')).id;
    gt06lId = (await getOrCreateDeviceModel(prisma, 'GT06L')).id;
  });

  // Semantic Validation (#26): createConfig/updateConfig เรียก
  // ConfigDefinitionService.validateFields() ก่อนเขียนลง DB เสมอ — field ที่
  // ไม่มีนิยามในคลังเลยจะโดน block (400) เทสที่ส่ง fields: { APN1: ... } ผ่าน
  // HTTP จริง (ต่างจาก config ที่สร้างตรงๆ ผ่าน prisma.config.create ซึ่งไม่
  // ผ่าน validateFields เลย) ต้อง seed นิยามนี้ไว้ก่อนเสมอ
  async function seedApn1(): Promise<void> {
    await prisma.configFieldDefinition.create({
      data: {
        fieldName: 'APN1',
        dataType: 'string',
        allowedValues: [],
        required: false,
        supportedModels: {
          create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
        },
      },
    });
  }

  function tokenFor(sub: string, role: string): string {
    return jwtService.sign({ sub, role });
  }

  async function grant(
    roleCode: RoleCode,
    action: ActionType,
    resource = 'config',
  ): Promise<void> {
    const role = await getOrCreateRole(prisma, roleCode);
    await prisma.rolePermission.create({
      data: { roleId: role.id, resource, action },
    });
  }

  it('POST /config ไม่ส่ง Authorization header -> 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/config')
      .send({ modelId: gt06nId, protocol: 'TCP', fields: {} })
      .expect(401);
  });

  it('POST /config role ไม่มีสิทธิ์ config.Create -> 403', async () => {
    const opUser = await makeUser(prisma, { role: 'Operation' });
    const token = tokenFor(opUser.id, 'Operation');

    await request(app.getHttpServer())
      .post('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ modelId: gt06nId, protocol: 'TCP', fields: {} })
      .expect(403);
  });

  it('POST /config role ConfigEngineer มีสิทธิ์ config.Create -> 201 พร้อม createdBy จาก JWT', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    await seedApn1();
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    const res = await request(app.getHttpServer())
      .post('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `cfg-${randomUUID()}`,
        modelId: gt06nId,
        protocol: 'TCP',
        fields: { APN1: 'internet' },
      })
      .expect(201);

    const body = res.body as { createdBy: string; status: string };
    expect(body.createdBy).toBe(configEngineerUser.id);
    expect(body.status).toBe('draft');
  });

  // Config ผูกรุ่นด้วย id + รหัสกลาง idMaster (12 พ.ย. 2569)
  describe('modelId (FK ไป DeviceModel) และ idMaster', () => {
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    type Body = {
      id: string;
      idMaster: string;
      modelId: string;
      deviceModel: string;
      model?: unknown;
    };

    function createAs(token: string, name: string) {
      return request(app.getHttpServer())
        .post('/api/v1/config')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name,
          modelId: gt06nId,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
        });
    }

    async function engineerToken(): Promise<string> {
      const user = await makeUser(prisma, { role: 'ConfigEngineer' });
      await grant('ConfigEngineer', ActionType.Create);
      await grant('ConfigEngineer', ActionType.Read);
      await grant('ConfigEngineer', ActionType.Update);
      await seedApn1();
      return tokenFor(user.id, 'ConfigEngineer');
    }

    it('สร้าง -> บันทึก modelId จริงใน DB · ตอบชื่อรุ่น deviceModel + idMaster (UUID ที่ DB สร้าง) ไม่ส่ง object model', async () => {
      const token = await engineerToken();

      const res = await createAs(token, `cfg-${randomUUID()}`).expect(201);
      const body = res.body as Body;

      expect(body.modelId).toBe(gt06nId);
      expect(body.deviceModel).toBe('GT06N');
      expect(body.idMaster).toMatch(UUID_RE);
      expect(body.idMaster).not.toBe(body.id);
      expect(body).not.toHaveProperty('model');
      const row = await prisma.config.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(row.modelId).toBe(gt06nId);
      expect(row.idMaster).toBe(body.idMaster);

      // GET ตอบรูปเดียวกัน
      const got = await request(app.getHttpServer())
        .get(`/api/v1/config/${body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((got.body as Body).deviceModel).toBe('GT06N');
      expect((got.body as Body).idMaster).toBe(body.idMaster);
    });

    it('Config แต่ละตัวได้ idMaster ไม่ซ้ำกัน', async () => {
      const token = await engineerToken();

      const a = (await createAs(token, `a-${randomUUID()}`).expect(201))
        .body as Body;
      const b = (await createAs(token, `b-${randomUUID()}`).expect(201))
        .body as Body;

      expect(a.idMaster).not.toBe(b.idMaster);
    });

    it('ส่ง deviceModel (ชื่อรุ่นแบบเดิม) แทน modelId -> 400 ไม่สร้าง Config', async () => {
      const token = await engineerToken();

      await request(app.getHttpServer())
        .post('/api/v1/config')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `cfg-${randomUUID()}`,
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: { APN1: 'internet' },
        })
        .expect(400);
      expect(await prisma.config.count()).toBe(0);
    });

    it('PUT ส่ง idMaster มาแก้ -> 400 ค่าเดิมไม่เปลี่ยน', async () => {
      const token = await engineerToken();
      const created = (await createAs(token, `cfg-${randomUUID()}`).expect(201))
        .body as Body;

      await request(app.getHttpServer())
        .put(`/api/v1/config/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ idMaster: randomUUID() })
        .expect(400);

      const row = await prisma.config.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.idMaster).toBe(created.idMaster);
    });

    it('PUT เปลี่ยนรุ่นด้วย modelId -> ตอบชื่อรุ่นใหม่', async () => {
      const token = await engineerToken();
      const created = (await createAs(token, `cfg-${randomUUID()}`).expect(201))
        .body as Body;

      const res = await request(app.getHttpServer())
        .put(`/api/v1/config/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ modelId: gt06lId })
        .expect(200);

      expect((res.body as Body).modelId).toBe(gt06lId);
      expect((res.body as Body).deviceModel).toBe('GT06L');
    });

    it('ฐานข้อมูลไม่ยอมให้ลบรุ่นที่มี Config ใช้อยู่ (FK Restrict)', async () => {
      const token = await engineerToken();
      await createAs(token, `cfg-${randomUUID()}`).expect(201);

      await expect(
        prisma.deviceModel.delete({ where: { id: gt06nId } }),
      ).rejects.toThrow();
    });
  });

  // รีวิวพี่เลี้ยง 12 ต.ค. 2569: ผู้สร้าง template เพิ่มพารามิเตอร์นอกชุดของ
  // รุ่นได้ (APN1 ผูกไว้กับ GT06N/TCP เท่านั้น แต่ใส่ใน Config ของ GT06L ได้)
  it('POST /config มี field ที่ไม่ได้ผูกกับรุ่นนี้ -> 201 บันทึกได้', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    await seedApn1();
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    const res = await request(app.getHttpServer())
      .post('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `cfg-${randomUUID()}`,
        modelId: gt06lId,
        protocol: 'TCP',
        fields: { APN1: 'internet' },
      })
      .expect(201);

    expect((res.body as { fields: unknown }).fields).toEqual({
      APN1: 'internet',
    });
  });

  it('POST /config มี field ที่ไม่มีนิยามในคลังเลย -> 400 (ยัง block เหมือนเดิม)', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .post('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `cfg-${randomUUID()}`,
        modelId: gt06nId,
        protocol: 'TCP',
        fields: { NOT_IN_LIBRARY: 'x' },
      })
      .expect(400);
  });

  describe('clonedFromId (ต้นทางของการโคลน)', () => {
    async function setup() {
      const ce = await makeUser(prisma, { role: 'ConfigEngineer' });
      await grant('ConfigEngineer', ActionType.Create);
      await grant('ConfigEngineer', ActionType.Update);
      await seedApn1();
      const source = await prisma.config.create({
        data: {
          name: `src-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          status: 'approved',
          createdBy: ce.id,
        },
      });
      return { ce, token: tokenFor(ce.id, 'ConfigEngineer'), source };
    }

    function cloneBody(clonedFromId: string | undefined) {
      return {
        name: `clone-${randomUUID()}`,
        modelId: gt06nId,
        protocol: 'TCP',
        fields: { APN1: 'internet.new' },
        ...(clonedFromId ? { clonedFromId } : {}),
      };
    }

    it('POST /config ส่ง clonedFromId ของ Config ที่มีอยู่ -> 201 และบันทึกต้นทางไว้ทั้งใน response และ DB', async () => {
      const { token, source } = await setup();

      const res = await request(app.getHttpServer())
        .post('/api/v1/config')
        .set('Authorization', `Bearer ${token}`)
        .send(cloneBody(source.id))
        .expect(201);

      const body = res.body as { id: string; clonedFromId: string | null };
      expect(body.clonedFromId).toBe(source.id);
      const row = await prisma.config.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(row.clonedFromId).toBe(source.id);
    });

    it('POST /config ไม่ส่ง clonedFromId -> 201 และเป็น null', async () => {
      const { token } = await setup();

      const res = await request(app.getHttpServer())
        .post('/api/v1/config')
        .set('Authorization', `Bearer ${token}`)
        .send(cloneBody(undefined))
        .expect(201);

      expect(
        (res.body as { clonedFromId: string | null }).clonedFromId,
      ).toBeNull();
    });

    it('POST /config clonedFromId ไม่ใช่ UUID -> 400', async () => {
      const { token } = await setup();

      await request(app.getHttpServer())
        .post('/api/v1/config')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...cloneBody(undefined), clonedFromId: 'not-a-uuid' })
        .expect(400);
    });

    it('POST /config clonedFromId เป็น UUID ที่ไม่มีอยู่จริง -> 404 และไม่สร้าง Config', async () => {
      const { token } = await setup();
      const before = await prisma.config.count();

      await request(app.getHttpServer())
        .post('/api/v1/config')
        .set('Authorization', `Bearer ${token}`)
        .send(cloneBody(randomUUID()))
        .expect(404);

      expect(await prisma.config.count()).toBe(before);
    });

    it('POST /config ต้นทางถูก soft-delete แล้ว -> 404', async () => {
      const { token, source } = await setup();
      await prisma.config.update({
        where: { id: source.id },
        data: { deletedAt: new Date() },
      });

      await request(app.getHttpServer())
        .post('/api/v1/config')
        .set('Authorization', `Bearer ${token}`)
        .send(cloneBody(source.id))
        .expect(404);
    });

    it('PUT /config/:id ส่ง clonedFromId มาแก้ภายหลัง -> 400 (ตั้งได้ครั้งเดียวตอนสร้าง)', async () => {
      const { ce, token, source } = await setup();
      const draft = await prisma.config.create({
        data: {
          name: `draft-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          createdBy: ce.id,
        },
      });

      await request(app.getHttpServer())
        .put(`/api/v1/config/${draft.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ clonedFromId: source.id })
        .expect(400);

      const row = await prisma.config.findUniqueOrThrow({
        where: { id: draft.id },
      });
      expect(row.clonedFromId).toBeNull();
    });

    it('POST /config/import ไฟล์ที่มี clonedFromId -> 400 ไม่รับต้นทางผ่าน import', async () => {
      const { token, source } = await setup();

      await request(app.getHttpServer())
        .post('/api/v1/config/import')
        .set('Authorization', `Bearer ${token}`)
        .field('format', 'json')
        .attach(
          'file',
          Buffer.from(JSON.stringify(cloneBody(source.id))),
          'config.json',
        )
        .expect(400);
    });

    it('DELETE /config/:id ลบ draft ต้นทางที่มีตัวโคลนอยู่ได้ (204) และตัวโคลนกลายเป็น null ไม่ถูกลบตาม', async () => {
      const { ce, token } = await setup();
      const draftSource = await prisma.config.create({
        data: {
          name: `draft-src-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          createdBy: ce.id,
        },
      });
      const clone = await prisma.config.create({
        data: {
          name: `clone-of-draft-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          createdBy: ce.id,
          clonedFromId: draftSource.id,
        },
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/config/${draftSource.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const after = await prisma.config.findUniqueOrThrow({
        where: { id: clone.id },
      });
      expect(after.clonedFromId).toBeNull();
    });
  });

  it('POST /config modelId ไม่มีในทะเบียน DeviceModel -> 404', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    await seedApn1();
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .post('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `cfg-${randomUUID()}`,
        modelId: randomUUID(),
        protocol: 'TCP',
        fields: {},
      })
      .expect(404);
  });

  it('POST /config protocol ไม่อยู่ใน supportedProtocols ของรุ่นนั้น -> 400 (issue #209)', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    await seedApn1();
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .post('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `cfg-${randomUUID()}`,
        modelId: gt06nId,
        protocol: 'SMS',
        fields: {},
      })
      .expect(400);
  });

  it('POST /config สำเร็จ -> เขียน AuditLog action create (#27)', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    await seedApn1();
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .post('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `cfg-${randomUUID()}`,
        modelId: gt06nId,
        protocol: 'TCP',
        fields: { APN1: 'internet' },
      })
      .expect(201);

    const logs = await prisma.auditLog.findMany({
      where: {
        userId: configEngineerUser.id,
        auditModule: 'config',
        action: 'create',
      },
    });
    expect(logs).toHaveLength(1);
  });

  it('POST /config ชื่อ Config ซ้ำกับที่มีอยู่ -> 409 (unique ทั้งระบบ — มติ Sprint 1 review ข้อ 4)', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    await seedApn1();
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');
    const dupName = `cfg-${randomUUID()}`;

    await request(app.getHttpServer())
      .post('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: dupName,
        modelId: gt06nId,
        protocol: 'TCP',
        fields: { APN1: 'internet' },
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: dupName,
        modelId: gt06nId,
        protocol: 'TCP',
        fields: { APN1: 'internet' },
      })
      .expect(409);
  });

  it('PUT /config/:id เปลี่ยนชื่อไปชนกับ Config อื่น -> 409', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Update);
    const taken = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: {},
        createdBy: configEngineerUser.id,
      },
    });
    const target = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: {},
        createdBy: configEngineerUser.id,
      },
    });
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .put(`/api/v1/config/${target.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: taken.name })
      .expect(409);
  });

  it('POST /config/import role ไม่มีสิทธิ์ config.Create -> 403', async () => {
    const opUser = await makeUser(prisma, { role: 'Operation' });
    const token = tokenFor(opUser.id, 'Operation');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach(
        'file',
        Buffer.from(
          JSON.stringify({ modelId: gt06nId, protocol: 'TCP', fields: {} }),
        ),
        'config.json',
      )
      .expect(403);
  });

  it('POST /config/import ไฟล์ JSON ถูกต้อง -> 201 พร้อม createdBy จาก JWT (flow เดียวกับฟอร์ม)', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    await seedApn1();
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    const res = await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach(
        'file',
        Buffer.from(
          JSON.stringify({
            name: `cfg-${randomUUID()}`,
            modelId: gt06nId,
            protocol: 'TCP',
            fields: { APN1: 'internet' },
          }),
        ),
        'config.json',
      )
      .expect(201);

    const body = res.body as {
      createdBy: string;
      status: string;
      deviceModel: string;
    };
    expect(body.createdBy).toBe(configEngineerUser.id);
    expect(body.status).toBe('draft');
    expect(body.deviceModel).toBe('GT06N');
  });

  // ไฟล์ระบุรุ่นด้วยชื่อ ใช้ข้ามฐานได้ (id ของรุ่นสุ่มต่างกันในแต่ละฐาน — ข้อสังเกต A ข้อ 1 บน #481)
  describe('POST /config/import ระบุรุ่นด้วยชื่อ (deviceModel)', () => {
    async function engineerToken(): Promise<string> {
      const ce = await makeUser(prisma, { role: 'ConfigEngineer' });
      await grant('ConfigEngineer', ActionType.Create);
      await seedApn1();
      return tokenFor(ce.id, 'ConfigEngineer');
    }

    function importAs(token: string, model: Record<string, unknown>) {
      return request(app.getHttpServer())
        .post('/api/v1/config/import')
        .set('Authorization', `Bearer ${token}`)
        .field('format', 'json')
        .attach(
          'file',
          Buffer.from(
            JSON.stringify({
              name: `cfg-${randomUUID()}`,
              ...model,
              protocol: 'TCP',
              fields: { APN1: 'internet' },
            }),
          ),
          'config.json',
        );
    }

    it('ชื่อรุ่นที่มีในทะเบียน -> 201 ผูกกับ id ของรุ่นนั้นในฐานนี้', async () => {
      const res = await importAs(await engineerToken(), {
        deviceModel: 'GT06N',
      }).expect(201);

      const body = res.body as { modelId: string; deviceModel: string };
      expect(body.modelId).toBe(gt06nId);
      expect(body.deviceModel).toBe('GT06N');
    });

    it('ไม่พบรุ่นชื่อนี้ -> 404 ไม่สร้าง Config', async () => {
      await importAs(await engineerToken(), {
        deviceModel: 'NO-SUCH-MODEL',
      }).expect(404);
      expect(await prisma.config.count()).toBe(0);
    });

    it('ระบุทั้ง modelId และ deviceModel -> 400 ไม่สร้าง Config', async () => {
      await importAs(await engineerToken(), {
        deviceModel: 'GT06N',
        modelId: gt06nId,
      }).expect(400);
      expect(await prisma.config.count()).toBe(0);
    });
  });

  it('POST /config/import ไฟล์ format ใหม่ "settings" ซ้อนชั้น -> 201 (v3.67, รีวิวพี่เลี้ยง 27 ต.ค. — JSON export ต้องตรงกับที่ Server กลางรับจริง)', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    await seedApn1();
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    const res = await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach(
        'file',
        Buffer.from(
          JSON.stringify({
            name: `cfg-${randomUUID()}`,
            modelId: gt06nId,
            protocol: 'TCP',
            settings: { APN1: 'internet' },
          }),
        ),
        'config.json',
      )
      .expect(201);

    const body = res.body as { fields: Record<string, unknown> };
    expect(body.fields).toEqual({ APN1: 'internet' });
  });

  it('POST /config/import มีทั้ง "fields" และ "settings" พร้อมกัน -> 400 (กำกวม ไม่เดาให้)', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach(
        'file',
        Buffer.from(
          JSON.stringify({
            name: `cfg-${randomUUID()}`,
            modelId: gt06nId,
            protocol: 'TCP',
            fields: { APN1: 'internet' },
            settings: { APN1: 'internet' },
          }),
        ),
        'config.json',
      )
      .expect(400);
  });

  it('POST /config/import เนื้อไฟล์เป็น JSON null -> 400 ไม่ใช่ 500', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach('file', Buffer.from('null'), 'config.json')
      .expect(400);
  });

  it('POST /config/import เนื้อไฟล์เป็น JSON array -> 400', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach(
        'file',
        Buffer.from(JSON.stringify([{ modelId: gt06nId }])),
        'config.json',
      )
      .expect(400);
  });

  it('POST /config/import format ไม่ใช่ json -> 400', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'csv')
      .attach(
        'file',
        Buffer.from('deviceModel,protocol\nGT06N,TCP'),
        'config.csv',
      )
      .expect(400);
  });

  it('POST /config/import ไฟล์ไม่ใช่ JSON ที่ถูกต้อง (parse ไม่ผ่าน) -> 400', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach('file', Buffer.from('{ not valid json'), 'config.json')
      .expect(400);
  });

  it('POST /config/import ไม่แนบไฟล์มา -> 400', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .expect(400);
  });

  it('POST /config/import ไฟล์เกินขนาด limit (1MB) -> 413 ไม่ใช่ 500 (Nest แปลง MulterError ให้เองอัตโนมัติ)', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Create);
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    // เกิน 1MB นิดหน่อยพอ ไม่ต้องสร้างไฟล์ใหญ่มาก
    const oversized = Buffer.alloc(1 * 1024 * 1024 + 1, 'a');

    await request(app.getHttpServer())
      .post('/api/v1/config/import')
      .set('Authorization', `Bearer ${token}`)
      .field('format', 'json')
      .attach('file', oversized, 'config.json')
      .expect(413);
  });

  it('GET /config role มีสิทธิ์ config.Read -> 200 เห็นรายการทั้งหมด ไม่ scope ตาม creator', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    const auditorUser = await makeUser(prisma, { role: 'Auditor' });
    await grant('Auditor', ActionType.Read);
    await prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: {},
        createdBy: configEngineerUser.id,
      },
    });
    const token = tokenFor(auditorUser.id, 'Auditor');

    const res = await request(app.getHttpServer())
      .get('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((res.body as unknown[]).length).toBe(1);
  });

  it('GET /config/:id role ไม่มีสิทธิ์ config.Read -> 403', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    const configRow = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: {},
        createdBy: configEngineerUser.id,
      },
    });
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer'); // ไม่ grant Read ให้ ConfigEngineer ในเทสนี้

    await request(app.getHttpServer())
      .get(`/api/v1/config/${configRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('GET /config/:id ไม่เจอ id -> 404', async () => {
    const auditorUser = await makeUser(prisma, { role: 'Auditor' });
    await grant('Auditor', ActionType.Read);
    const token = tokenFor(auditorUser.id, 'Auditor');

    await request(app.getHttpServer())
      .get('/api/v1/config/22222222-2222-2222-2222-222222222222')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('PUT /config/:id สถานะยังเป็น draft -> 200 แก้ไขสำเร็จ', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Update);
    const configRow = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: {},
        createdBy: configEngineerUser.id,
      },
    });
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    const res = await request(app.getHttpServer())
      .put(`/api/v1/config/${configRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ modelId: gt06lId })
      .expect(200);

    expect((res.body as { deviceModel: string }).deviceModel).toBe('GT06L');
  });

  it('PUT /config/:id สถานะไม่ใช่ draft แล้ว -> 409', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Update);
    const configRow = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: {},
        createdBy: configEngineerUser.id,
        status: 'testing',
      },
    });
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .put(`/api/v1/config/${configRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ modelId: gt06lId })
      .expect(409);
  });

  it('DELETE /config/:id สถานะยังเป็น draft -> 204 และลบจริงจาก DB', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    // DELETE reuse action Update (ไม่มี ActionType.Delete แยก — ดู
    // schema follow-up PR ก่อน #26)
    await grant('ConfigEngineer', ActionType.Update);
    const configRow = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: {},
        createdBy: configEngineerUser.id,
      },
    });
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .delete(`/api/v1/config/${configRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(
      await prisma.config.findUnique({ where: { id: configRow.id } }),
    ).toBeNull();
  });

  it('DELETE /config/:id สถานะไม่ใช่ draft (approved) -> 204 soft delete: คงแถวไว้ ตั้ง deletedAt และปล่อยชื่อเดิม', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Update);
    await grant('ConfigEngineer', ActionType.Read);
    const originalName = `cfg-${randomUUID()}`;
    const configRow = await prisma.config.create({
      data: {
        name: originalName,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: {},
        createdBy: configEngineerUser.id,
        status: 'approved',
      },
    });
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .delete(`/api/v1/config/${configRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const after = await prisma.config.findUniqueOrThrow({
      where: { id: configRow.id },
    });
    expect(after.deletedAt).not.toBeNull();
    expect(after.name).toBe(
      `${originalName} [ลบแล้ว ${configRow.id.slice(0, 8)}]`,
    );

    // ชื่อเดิมต้องว่าง สร้างเทมเพลตชื่อเดิมใหม่ได้ และตัวที่ลบแล้วหายจาก GET
    await prisma.config.create({
      data: {
        name: originalName,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: {},
        createdBy: configEngineerUser.id,
      },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/config/${configRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('DELETE /config/:id ยังมี Task ที่เปิดอยู่ใช้ Config นี้ -> 409 และไม่ถูกลบ', async () => {
    const configEngineerUser = await makeUser(prisma, {
      role: 'ConfigEngineer',
    });
    await grant('ConfigEngineer', ActionType.Update);
    const configRow = await prisma.config.create({
      data: {
        name: `cfg-${randomUUID()}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: {},
        createdBy: configEngineerUser.id,
        status: 'approved',
      },
    });
    await prisma.task.create({
      data: {
        title: 'ติดตั้ง Config ยังไม่เสร็จ',
        assignedTo: configEngineerUser.id,
        deviceId: `DEV-${randomUUID().slice(0, 8)}`,
        configId: configRow.id,
        status: 'in_progress',
      },
    });
    const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

    await request(app.getHttpServer())
      .delete(`/api/v1/config/${configRow.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    const after = await prisma.config.findUniqueOrThrow({
      where: { id: configRow.id },
    });
    expect(after.deletedAt).toBeNull();
  });

  describe('POST /config/:id/simulate (Stage 3)', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          createdBy: configEngineerUser.id,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/simulate`)
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ config-simulation.Read (เช่น Auditor) -> 403', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const auditorUser = await makeUser(prisma, { role: 'Auditor' });
      // Auditor มี config.Read ปกติ (ดู view รายการ) แต่ไม่ควรเรียก simulate ได้
      await grant('Auditor', ActionType.Read, 'config');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          createdBy: configEngineerUser.id,
        },
      });
      const token = tokenFor(auditorUser.id, 'Auditor');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/simulate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('ConfigEngineer มีสิทธิ์ config-simulation.Read, Config มี field ครบ -> 200 passed: true', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Read, 'config-simulation');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: { APN1: 'internet', CONN_TIMEOUT: 30 },
          createdBy: configEngineerUser.id,
        },
      });
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/simulate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { passed: boolean; details: string[] };
      expect(body.passed).toBe(true);
    });

    it('Operation มีสิทธิ์ config-simulation.Read, fields ว่างเปล่า -> 200 passed: false', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Read, 'config-simulation');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/simulate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = res.body as { passed: boolean; details: string[] };
      expect(body.passed).toBe(false);
      expect(body.details.length).toBeGreaterThan(0);
    });

    it('สถานะ Config เป็น approved แล้ว -> 409', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Read, 'config-simulation');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          createdBy: configEngineerUser.id,
          status: 'approved',
        },
      });
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/simulate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('ไม่เจอ id -> 404', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Read, 'config-simulation');
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .post('/api/v1/config/22222222-2222-2222-2222-222222222222/simulate')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('POST /config/:id/decide (Stage 4)', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .send({ passed: true })
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ config-decision.Approve (เช่น Operation) -> 403', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set('Authorization', `Bearer ${token}`)
        .send({ passed: true })
        .expect(403);
    });

    it('ConfigEngineer มีสิทธิ์, ไม่ส่ง passed มา -> 400', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Approve, 'config-decision');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
        },
      });
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('ConfigEngineer มีสิทธิ์, status draft, passed:true -> 200 สถานะเปลี่ยนเป็น testing', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Approve, 'config-decision');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
        },
      });
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set('Authorization', `Bearer ${token}`)
        .send({ passed: true })
        .expect(200);

      expect((res.body as { status: string }).status).toBe('testing');
    });

    it('ConfigEngineer มีสิทธิ์, status draft, passed:false -> 200 สถานะยังเป็น draft', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Approve, 'config-decision');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
        },
      });
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set('Authorization', `Bearer ${token}`)
        .send({ passed: false })
        .expect(200);

      expect((res.body as { status: string }).status).toBe('draft');
    });

    it('status ไม่ใช่ draft แล้ว (เช่น testing) -> 409', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Approve, 'config-decision');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set('Authorization', `Bearer ${token}`)
        .send({ passed: true })
        .expect(409);
    });

    it('ไม่เจอ id -> 404', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Approve, 'config-decision');
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .post('/api/v1/config/22222222-2222-2222-2222-222222222222/decide')
        .set('Authorization', `Bearer ${token}`)
        .send({ passed: true })
        .expect(404);
    });

    it('passed:true + suggestedApproverId เป็น Operation ที่ active -> 200 + เซ็ตค่า', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('ConfigEngineer', ActionType.Approve, 'config-decision');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set(
          'Authorization',
          `Bearer ${tokenFor(configEngineerUser.id, 'ConfigEngineer')}`,
        )
        .send({ passed: true, suggestedApproverId: opUser.id })
        .expect(200);

      const body = res.body as { status: string; suggestedApproverId: string };
      expect(body.status).toBe('testing');
      expect(body.suggestedApproverId).toBe(opUser.id);
    });

    it('suggestedApproverId เป็น role อื่น (ไม่ใช่ Operation) -> 400, ไม่เปลี่ยนสถานะ', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const other = await makeUser(prisma, { role: 'ST' });
      await grant('ConfigEngineer', ActionType.Approve, 'config-decision');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set(
          'Authorization',
          `Bearer ${tokenFor(configEngineerUser.id, 'ConfigEngineer')}`,
        )
        .send({ passed: true, suggestedApproverId: other.id })
        .expect(400);

      const after = await prisma.config.findUnique({
        where: { id: configRow.id },
      });
      expect(after?.status).toBe('draft');
    });

    it('suggestedApproverId ไม่ใช่ uuid -> 400 (DTO validation)', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      await grant('ConfigEngineer', ActionType.Approve, 'config-decision');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/decide`)
        .set(
          'Authorization',
          `Bearer ${tokenFor(configEngineerUser.id, 'ConfigEngineer')}`,
        )
        .send({ passed: true, suggestedApproverId: 'not-a-uuid' })
        .expect(400);
    });
  });

  describe('POST /config/:id/approve (Stage 4)', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
          status: 'testing',
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/approve`)
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ config.Approve (เช่น ConfigEngineer) -> 403', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('Operation มีสิทธิ์, status testing -> 200 สถานะเปลี่ยนเป็น approved', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((res.body as { status: string }).status).toBe('approved');
      // approvedBy ต้องถูกบันทึกเป็น user id ของ Operation ที่กดอนุมัติ (ไม่ใช่ null)
      expect((res.body as { approvedBy: string }).approvedBy).toBe(opUser.id);
      const persisted = await prisma.config.findUnique({
        where: { id: configRow.id },
      });
      expect(persisted?.approvedBy).toBe(opUser.id);
    });

    it('approve สำเร็จ -> เขียน AuditLog action approve (#27)', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const logs = await prisma.auditLog.findMany({
        where: {
          userId: opUser.id,
          auditModule: 'config',
          action: 'approve',
        },
      });
      expect(logs).toHaveLength(1);
    });

    it('status ยังเป็น draft (ยังไม่ผ่าน decide) -> 409', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('ไม่เจอ id -> 404', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/config/22222222-2222-2222-2222-222222222222/approve')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('POST /config/:id/reject (Stage 4)', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
          status: 'testing',
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/reject`)
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ config.Approve (เช่น ConfigEngineer) -> 403', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(configEngineerUser.id, 'ConfigEngineer');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('Operation มีสิทธิ์, status testing -> 200 สถานะย้อนกลับเป็น draft', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
          status: 'testing',
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((res.body as { status: string }).status).toBe('draft');
    });

    it('status ยังเป็น draft (ยังไม่เคยส่งต่อ Operation) -> 409', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
        },
      });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('ไม่เจอ id -> 404', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/config/22222222-2222-2222-2222-222222222222/reject')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('GET /config/:id/versions + /versions/:n (Stage 5, #26 ข้อ 9)', () => {
    /** สร้าง config สถานะ testing แล้วให้ Operation กด approve จริงผ่าน HTTP
     * (เพื่อให้ ConfigVersion ถูกเขียนโดย service ไม่ใช่ fixture) คืน configId */
    async function createApprovedConfig(): Promise<string> {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const opUser = await makeUser(prisma, { role: 'Operation' });
      await grant('Operation', ActionType.Approve, 'config');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          createdBy: configEngineerUser.id,
          status: 'testing',
        },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/config/${configRow.id}/approve`)
        .set('Authorization', `Bearer ${tokenFor(opUser.id, 'Operation')}`)
        .expect(200);
      return configRow.id;
    }

    it('ไม่ส่ง Authorization header -> 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/config/22222222-2222-2222-2222-222222222222/versions')
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ config.Read -> 403', async () => {
      const auditor = await makeUser(prisma, { role: 'Auditor' });
      const configId = await createApprovedConfig();

      await request(app.getHttpServer())
        .get(`/api/v1/config/${configId}/versions`)
        .set('Authorization', `Bearer ${tokenFor(auditor.id, 'Auditor')}`)
        .expect(403);
    });

    it('approve แล้ว -> GET /versions คืน 1 แถว (versionNumber 1) + GET /versions/1 คืน fields snapshot', async () => {
      const configId = await createApprovedConfig();
      const auditor = await makeUser(prisma, { role: 'Auditor' });
      await grant('Auditor', ActionType.Read, 'config');
      const token = tokenFor(auditor.id, 'Auditor');

      const list = await request(app.getHttpServer())
        .get(`/api/v1/config/${configId}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const versions = list.body as Array<Record<string, unknown>>;
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        configId,
        versionNumber: 1,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: { APN1: 'internet' },
      });

      const one = await request(app.getHttpServer())
        .get(`/api/v1/config/${configId}/versions/1`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(one.body as Record<string, unknown>).toMatchObject({
        versionNumber: 1,
        fields: { APN1: 'internet' },
      });
    });

    it('config มีจริงแต่ยังไม่เคย approve -> GET /versions คืน [] (200)', async () => {
      const configEngineerUser = await makeUser(prisma, {
        role: 'ConfigEngineer',
      });
      const reader = await makeUser(prisma, { role: 'ConfigEngineer' });
      await grant('ConfigEngineer', ActionType.Read, 'config');
      const configRow = await prisma.config.create({
        data: {
          name: `cfg-${randomUUID()}`,
          modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
          protocol: 'TCP',
          fields: {},
          createdBy: configEngineerUser.id,
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/config/${configRow.id}/versions`)
        .set('Authorization', `Bearer ${tokenFor(reader.id, 'ConfigEngineer')}`)
        .expect(200);

      expect(res.body as unknown[]).toEqual([]);
    });

    it('ไม่เจอ configId -> 404', async () => {
      const reader = await makeUser(prisma, { role: 'ConfigEngineer' });
      await grant('ConfigEngineer', ActionType.Read, 'config');

      await request(app.getHttpServer())
        .get('/api/v1/config/22222222-2222-2222-2222-222222222222/versions')
        .set('Authorization', `Bearer ${tokenFor(reader.id, 'ConfigEngineer')}`)
        .expect(404);
    });

    it('versionNumber ไม่ใช่จำนวนเต็ม -> 400', async () => {
      const configId = await createApprovedConfig();
      const reader = await makeUser(prisma, { role: 'ConfigEngineer' });
      await grant('ConfigEngineer', ActionType.Read, 'config');

      await request(app.getHttpServer())
        .get(`/api/v1/config/${configId}/versions/abc`)
        .set('Authorization', `Bearer ${tokenFor(reader.id, 'ConfigEngineer')}`)
        .expect(400);
    });

    it('versionNumber ที่ไม่มี -> 404', async () => {
      const configId = await createApprovedConfig();
      const reader = await makeUser(prisma, { role: 'ConfigEngineer' });
      await grant('ConfigEngineer', ActionType.Read, 'config');

      await request(app.getHttpServer())
        .get(`/api/v1/config/${configId}/versions/99`)
        .set('Authorization', `Bearer ${tokenFor(reader.id, 'ConfigEngineer')}`)
        .expect(404);
    });
  });
});
