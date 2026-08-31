import {
  Controller,
  Get,
  INestApplication,
  Module,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthModule } from '../../src/auth/auth.module';
import { RequirePermission } from '../../src/common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../src/common/guards/permission.guard';
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
// ไปที่ DB _test เดียวกับที่ integration test อื่นใช้ (เหมือน task-http.integration-spec.ts)
process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * Controller/Module สำหรับเทสนี้โดยเฉพาะ ไม่ใช่โค้ด production — ยังไม่มี business
 * module จริงที่ผูก @RequirePermission ไว้ (Config module คือ #26 ยังไม่ได้ทำ)
 * จำลอง endpoint ขึ้นมาเพื่อพิสูจน์ guard chain จริงผ่าน HTTP ทั้งเส้น
 * (JwtAuthGuard -> PermissionGuard) เหมือนแนวทางที่ task-http.integration-spec.ts
 * ใช้พิสูจน์ JwtAuthGuard ของ #23
 */
@Controller('test-permission')
class TestPermissionController {
  @Get('config-update')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('config', ActionType.Update)
  configUpdate() {
    return { ok: true };
  }

  @Get('public')
  @UseGuards(JwtAuthGuard)
  publicRoute() {
    return { ok: true };
  }
}

@Module({
  // AuthModule มี JwtModule + JwtAuthGuard export ไว้แล้ว (ดู auth.module.ts)
  imports: [AuthModule],
  controllers: [TestPermissionController],
  providers: [PermissionGuard],
})
class TestPermissionModule {}

describe('PermissionGuard (integration — real postgres + JwtAuthGuard chain)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule, TestPermissionModule],
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
    // Role เป็น reference data ที่ resetDb() ตั้งใจไม่ลบ (ดู setup.ts) แต่
    // RolePermission ต้อง clean ทุกเทส กันสิทธิ์จากเทสก่อนหน้ารั่วมาปนกัน
    await prisma.rolePermission.deleteMany();
  });

  function tokenFor(sub: string, role: string): string {
    return jwtService.sign({ sub, role });
  }

  async function grantPermission(
    roleCode: RoleCode,
    resource: string,
    action: ActionType,
  ): Promise<void> {
    const role = await getOrCreateRole(prisma, roleCode);
    await prisma.rolePermission.create({
      data: { roleId: role.id, resource, action },
    });
  }

  it('ไม่ส่ง Authorization header -> 401 (JwtAuthGuard บล็อกก่อนถึง PermissionGuard เลย)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/test-permission/config-update')
      .expect(401);
  });

  it('login แล้ว role ยังไม่มีสิทธิ์ config.Update เลย -> 403', async () => {
    const user = await makeUser(prisma, { role: 'ST' });
    const token = tokenFor(user.id, 'ST');

    await request(app.getHttpServer())
      .get('/api/v1/test-permission/config-update')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('login แล้ว role มีสิทธิ์ config.Update ตรงตาม RolePermission -> 200', async () => {
    const user = await makeUser(prisma, { role: 'SW' });
    await grantPermission('SW', 'config', ActionType.Update);
    const token = tokenFor(user.id, 'SW');

    await request(app.getHttpServer())
      .get('/api/v1/test-permission/config-update')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('role มีสิทธิ์ resource เดียวกันแต่คนละ action (Read ไม่ใช่ Update) -> ยังคง 403', async () => {
    const user = await makeUser(prisma, { role: 'Auditor' });
    await grantPermission('Auditor', 'config', ActionType.Read);
    const token = tokenFor(user.id, 'Auditor');

    await request(app.getHttpServer())
      .get('/api/v1/test-permission/config-update')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('endpoint ที่ไม่มี @RequirePermission ติดไว้เลย -> แค่ login ก็ผ่าน ไม่ต้องมี RolePermission เลย', async () => {
    const user = await makeUser(prisma, { role: 'Auditor' });
    const token = tokenFor(user.id, 'Auditor');

    await request(app.getHttpServer())
      .get('/api/v1/test-permission/public')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('Admin grant สิทธิ์ให้ role หลังจาก user login ไปแล้ว (ใช้ token เดิม ไม่ re-login) -> มีผลทันทีในคำขอถัดไป', async () => {
    const user = await makeUser(prisma, { role: 'OT' });
    const token = tokenFor(user.id, 'OT'); // sign ตอนที่ role ยังไม่มีสิทธิ์นี้เลย

    await request(app.getHttpServer())
      .get('/api/v1/test-permission/config-update')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    // จำลอง Admin กด grant สิทธิ์ให้ role นี้ผ่านหน้า User/Role Management —
    // insert RolePermission ตรงๆ โดย user ไม่ต้อง logout/login ใหม่เลย นี่คือ
    // เหตุผลหลักที่เลือก query DB ทุก request แทนการ embed สิทธิ์ลง JWT ตอน sign
    await grantPermission('OT', 'config', ActionType.Update);

    await request(app.getHttpServer())
      .get('/api/v1/test-permission/config-update')
      .set('Authorization', `Bearer ${token}`) // token ตัวเดิมเป๊ะ ไม่ได้ sign ใหม่
      .expect(200);
  });
});
