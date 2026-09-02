import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { ConfigDefinitionModule } from '../../src/config-definition/config-definition.module';
import { PrismaModule } from '../../src/prisma/prisma.module';
import {
  createTestPrisma,
  getOrCreateRole,
  makeUser,
  resetDb,
  RoleCode,
  TEST_DATABASE_URL,
} from './setup';

// PrismaService (ผ่าน PrismaModule) อ่าน DATABASE_URL จาก env ตรงๆ — override ให้ชี้
// ไปที่ DB _test เดียวกับ integration test อื่น (เหมือน config-http.integration-spec.ts)
process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * Config Definition Lookup (task #12) — `GET /config-definitions` ผ่าน HTTP จริง
 * (JwtAuthGuard -> PermissionGuard เต็มเส้นทาง) endpoint อ่านอย่างเดียว
 */
describe('ConfigDefinitionController (integration — real postgres + guard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // NestConfigModule.forRoot ไม่จำเป็นสำหรับ module นี้ (ไม่มี provider ที่ inject
      // @nestjs/config) แต่ใส่ไว้ให้เหมือน config-http.integration-spec.ts กัน
      // regression ถ้าอนาคตเพิ่ม provider ที่พึ่ง env
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        ConfigDefinitionModule,
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
    // `resetDb` ไม่ได้แตะ 2 ตารางนี้ (ดู comment ใน setup.ts) เทสนี้เขียนทั้งคู่
    await prisma.rolePermission.deleteMany();
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

  async function seedApn(): Promise<void> {
    await prisma.configFieldDefinition.create({
      data: {
        fieldName: 'APN',
        dataType: 'string',
        allowedValues: [],
        required: true,
        unknownSpec: false,
        description: 'Access Point Name สำหรับเชื่อมต่อ GPRS/4G ของอุปกรณ์',
      },
    });
  }

  it('ไม่ส่ง Authorization header -> 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/config-definitions')
      .expect(401);
  });

  it('role ไม่มีสิทธิ์ config-definition.Read (เช่น Auditor ที่มีแค่ config.Read) -> 403', async () => {
    const auditorUser = await makeUser(prisma, { role: 'Auditor' });
    await grant('Auditor', ActionType.Read, 'config');
    const token = tokenFor(auditorUser.id, 'Auditor');

    await request(app.getHttpServer())
      .get('/api/v1/config-definitions')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('SW มีสิทธิ์ config-definition.Read -> 200 คืนรายการที่ seed ไว้ (APN)', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Read, 'config-definition');
    await seedApn();
    const token = tokenFor(swUser.id, 'SW');

    const res = await request(app.getHttpServer())
      .get('/api/v1/config-definitions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      fieldName: string;
      dataType: string;
      required: boolean;
    }[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].fieldName).toBe('APN');
    expect(body[0].dataType).toBe('string');
    expect(body[0].required).toBe(true);
  });

  it('SW มีสิทธิ์ แต่ยังไม่มีข้อมูลในตาราง -> 200 คืน []', async () => {
    const swUser = await makeUser(prisma, { role: 'SW' });
    await grant('SW', ActionType.Read, 'config-definition');
    const token = tokenFor(swUser.id, 'SW');

    const res = await request(app.getHttpServer())
      .get('/api/v1/config-definitions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });
});
