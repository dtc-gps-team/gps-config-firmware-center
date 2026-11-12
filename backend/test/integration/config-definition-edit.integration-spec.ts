import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigDefinitionModule } from '../../src/config-definition/config-definition.module';
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

process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * Parameter Library แก้/ลบ (PATCH/DELETE /config-definitions/{id}) ผ่าน HTTP จริง + Postgres จริง
 * รวม SQL ที่หา Config ที่ใช้ field (jsonb_exists) และ race ลบ field vs สร้าง Config
 * (ถือล็อกค้างเองเพื่อบังคับจังหวะ - ชนซ้ำด้วย Promise.all ไม่ได้เสมอ)
 */
describe('ConfigDefinition แก้ไข/ลบ (integration — real postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        ConfigDefinitionModule,
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
    await prisma.rolePermission.deleteMany();
    await prisma.configFieldDefinition.deleteMany();
    await getOrCreateDeviceModel(prisma, 'GT06N');
  });

  function tokenFor(sub: string, role: string): string {
    return jwtService.sign({ sub, role });
  }

  async function grant(
    roleCode: RoleCode,
    resource: string,
    action: ActionType,
  ): Promise<void> {
    const role = await getOrCreateRole(prisma, roleCode);
    await prisma.rolePermission.create({
      data: { roleId: role.id, resource, action },
    });
  }

  async function setup() {
    const ce = await makeUser(prisma, { role: 'ConfigEngineer' });
    await grant('ConfigEngineer', 'config-definition', ActionType.Read);
    await grant('ConfigEngineer', 'config-definition', ActionType.Update);
    await grant('ConfigEngineer', 'config', ActionType.Create);
    return { ce, token: tokenFor(ce.id, 'ConfigEngineer') };
  }

  async function seedDef(fieldName: string) {
    return prisma.configFieldDefinition.create({
      data: {
        fieldName,
        dataType: 'string',
        required: false,
        supportedModels: {
          create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
        },
      },
    });
  }

  it('PATCH แก้ metadata ได้ (200) แต่ส่ง fieldName มา -> 400 (ห้ามเปลี่ยนชื่อ)', async () => {
    const { token } = await setup();
    const def = await seedDef(`F_${randomUUID().slice(0, 6)}`);

    const ok = await request(app.getHttpServer())
      .patch(`/api/v1/config-definitions/${def.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ unit: 'วินาที', category: 'Network' })
      .expect(200);
    expect((ok.body as { unit: string }).unit).toBe('วินาที');

    await request(app.getHttpServer())
      .patch(`/api/v1/config-definitions/${def.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fieldName: 'NEW_NAME' })
      .expect(400);
  });

  it('ไม่มีสิทธิ์ Update (Operation) -> 403', async () => {
    const op = await makeUser(prisma, { role: 'Operation' });
    const def = await seedDef(`F_${randomUUID().slice(0, 6)}`);

    await request(app.getHttpServer())
      .delete(`/api/v1/config-definitions/${def.id}`)
      .set('Authorization', `Bearer ${tokenFor(op.id, 'Operation')}`)
      .expect(403);
  });

  it('DELETE field ที่ไม่มี Config ใช้ -> 204 และหายจากคลัง', async () => {
    const { token } = await setup();
    const def = await seedDef(`F_${randomUUID().slice(0, 6)}`);

    await request(app.getHttpServer())
      .delete(`/api/v1/config-definitions/${def.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(
      await prisma.configFieldDefinition.findUnique({ where: { id: def.id } }),
    ).toBeNull();
  });

  it('DELETE field ที่มี Config ใช้อยู่ -> 409 บอกชื่อ Config (SQL jsonb จริง) · Config ที่ถูกลบแล้วไม่นับ · usage คืนจำนวนตรง', async () => {
    const { ce, token } = await setup();
    const fieldName = `F_${randomUUID().slice(0, 6)}`;
    const def = await seedDef(fieldName);
    const used = await prisma.config.create({
      data: {
        name: `ใช้ field ${fieldName}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: { [fieldName]: 'x' },
        createdBy: ce.id,
      },
    });
    await prisma.config.create({
      data: {
        name: `ลบแล้ว ${fieldName}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: { [fieldName]: 'y' },
        createdBy: ce.id,
        deletedAt: new Date(),
      },
    });

    const usage = await request(app.getHttpServer())
      .get(`/api/v1/config-definitions/${def.id}/usage`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(usage.body).toEqual({
      count: 1,
      configs: [{ id: used.id, name: used.name }],
    });

    const res = await request(app.getHttpServer())
      .delete(`/api/v1/config-definitions/${def.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect((res.body as { message: string }).message).toContain(used.name);
    expect(
      await prisma.configFieldDefinition.findUnique({ where: { id: def.id } }),
    ).not.toBeNull();
  });

  it('race: Config กำลังถูกสร้างด้วย field นี้ (ถือล็อก FOR SHARE ค้าง) -> DELETE ต้องรอ แล้วเห็น Config ที่ commit และปฏิเสธ 409', async () => {
    const { ce, token } = await setup();
    const fieldName = `F_${randomUUID().slice(0, 6)}`;
    const def = await seedDef(fieldName);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const creator = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "fieldName" FROM "ConfigFieldDefinition" WHERE "fieldName" = ANY(${[fieldName]}::text[]) FOR SHARE`;
        await tx.config.create({
          data: {
            name: `race-${randomUUID()}`,
            modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
            protocol: 'TCP',
            fields: { [fieldName]: 'x' },
            createdBy: ce.id,
          },
        });
        await gate;
      },
      { timeout: 20000 },
    );
    await sleep(300);

    let settled = false;
    const deleting = request(app.getHttpServer())
      .delete(`/api/v1/config-definitions/${def.id}`)
      .set('Authorization', `Bearer ${token}`)
      .then((res) => {
        settled = true;
        return res;
      });
    await sleep(500);
    expect(settled).toBe(false);

    release();
    await creator;
    const res = await deleting;
    expect(res.status).toBe(409);
    expect(
      await prisma.configFieldDefinition.findUnique({ where: { id: def.id } }),
    ).not.toBeNull();
  });

  it('race: DELETE กำลังลบ field (ถือล็อก FOR UPDATE ค้าง) -> POST /config ที่ใช้ field นั้นต้องรอ แล้วปฏิเสธ 409 ไม่สร้าง Config ที่อ้าง field ที่หายไป', async () => {
    const { token } = await setup();
    const fieldName = `F_${randomUUID().slice(0, 6)}`;
    const def = await seedDef(fieldName);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deleter = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ConfigFieldDefinition" WHERE id = ${def.id} FOR UPDATE`;
        await tx.configFieldDefinition.delete({ where: { id: def.id } });
        await gate;
      },
      { timeout: 20000 },
    );
    await sleep(300);

    let settled = false;
    const creating = request(app.getHttpServer())
      .post('/api/v1/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `race-${randomUUID()}`,
        modelId: (await getOrCreateDeviceModel(prisma, 'GT06N')).id,
        protocol: 'TCP',
        fields: { [fieldName]: 'x' },
      })
      .then((res) => {
        settled = true;
        return res;
      });
    await sleep(500);
    expect(settled).toBe(false);

    release();
    await deleter;
    const res = await creating;
    expect(res.status).toBe(409);
    // ไม่มี Config ใหม่ถูกสร้าง (ชื่อขึ้นต้น race- เฉพาะของเทสนี้)
    expect(
      await prisma.config.count({ where: { name: { startsWith: 'race-' } } }),
    ).toBe(0);
  });
});
