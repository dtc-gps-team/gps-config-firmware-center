import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { UserModule } from '../../src/user/user.module';
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
 * `GET /users` — list ย่อสำหรับ dropdown "เจาะจงผู้อนุมัติ" (Approval Center #19)
 * ผ่าน HTTP จริง · JwtAuthGuard อย่างเดียว (ไม่มี PermissionGuard)
 */
describe('UserController (integration — real postgres + JwtAuthGuard)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        NestConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        UserModule,
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
    // ลบ RolePermission ด้วย — เทสของ /users/managed, POST/PATCH /users
    // เรียก grant() ซ้ำ (role Admin) ข้าม it() หลายตัว ต่างจากเทส GET /users
    // เดิมที่ไม่เคยต้อง grant อะไรเลย (mirror pattern ของ firmware-http spec)
    await prisma.rolePermission.deleteMany();
  });

  function tokenFor(sub: string, role: string): string {
    return jwtService.sign({ sub, role });
  }

  async function grant(
    roleCode: RoleCode,
    action: ActionType,
    resource = 'user-management',
  ): Promise<void> {
    const role = await getOrCreateRole(prisma, roleCode);
    await prisma.rolePermission.create({
      data: { roleId: role.id, resource, action },
    });
  }

  it('ไม่ส่ง Authorization -> 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
  });

  it('filter role=Operation -> เฉพาะ Operation ที่ active เรียงตามชื่อ', async () => {
    await makeUser(prisma, {
      role: 'Operation',
      fullName: 'สมหญิง วงศ์ก',
    });
    await makeUser(prisma, {
      role: 'Operation',
      fullName: 'ปฏิภาณ ศรีสุข',
    });
    await makeUser(prisma, {
      role: 'Operation',
      fullName: 'ปิดใช้งาน',
      isActive: false,
    });
    await makeUser(prisma, {
      role: 'ConfigEngineer',
      fullName: 'ConfigEngineer คนหนึ่ง',
    });
    const caller = await makeUser(prisma, { role: 'Auditor' });

    const res = await request(app.getHttpServer())
      .get('/api/v1/users?role=Operation')
      .set('Authorization', `Bearer ${tokenFor(caller.id, 'Auditor')}`)
      .expect(200);

    const body = res.body as { fullName: string; role: string }[];
    expect(body.map((u) => u.fullName)).toEqual([
      'ปฏิภาณ ศรีสุข',
      'สมหญิง วงศ์ก',
    ]);
    expect(body.every((u) => u.role === 'Operation')).toBe(true);
  });

  it('คืนแค่ id/fullName/role — ไม่มี username/passwordHash', async () => {
    const op = await makeUser(prisma, {
      role: 'Operation',
      fullName: 'ทดสอบ',
    });
    const caller = await makeUser(prisma, { role: 'ConfigEngineer' });

    const res = await request(app.getHttpServer())
      .get('/api/v1/users?role=Operation')
      .set('Authorization', `Bearer ${tokenFor(caller.id, 'ConfigEngineer')}`)
      .expect(200);

    expect(res.body).toEqual([
      { id: op.id, fullName: 'ทดสอบ', role: 'Operation' },
    ]);
  });

  it('role ที่ไม่มีจริง -> list ว่าง (ไม่ error)', async () => {
    const caller = await makeUser(prisma, { role: 'ConfigEngineer' });
    const res = await request(app.getHttpServer())
      .get('/api/v1/users?role=NopeRole')
      .set('Authorization', `Bearer ${tokenFor(caller.id, 'ConfigEngineer')}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  // User / Role Management (RBAC_Matrix.md §2 — บัญชีทั่วไปเท่านั้น, ไม่รวม
  // Admin/SuperAdmin) — resource `user-management`, Admin เท่านั้น
  describe('GET /users/managed', () => {
    it('ไม่ส่ง Authorization -> 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/managed')
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ user-management.Read (Auditor) -> 403', async () => {
      const auditor = await makeUser(prisma, { role: 'Auditor' });
      await request(app.getHttpServer())
        .get('/api/v1/users/managed')
        .set('Authorization', `Bearer ${tokenFor(auditor.id, 'Auditor')}`)
        .expect(403);
    });

    it('Admin มีสิทธิ์ -> 200 ตัด Admin/SuperAdmin ออก + รวม inactive', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Read);
      await makeUser(prisma, {
        role: 'ConfigEngineer',
        username: 'ce.active',
        fullName: 'CE Active',
      });
      await makeUser(prisma, {
        role: 'Operation',
        username: 'op.inactive',
        fullName: 'Op Inactive',
        isActive: false,
      });
      await makeUser(prisma, {
        role: 'SuperAdmin',
        username: 'super.excluded',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/managed')
        .set('Authorization', `Bearer ${tokenFor(admin.id, 'Admin')}`)
        .expect(200);

      const body = res.body as { username: string; role: string }[];
      expect(body.map((u) => u.username).sort()).toEqual([
        'ce.active',
        'op.inactive',
      ]);
      expect(body.some((u) => u.role === 'SuperAdmin')).toBe(false);
      expect(body.some((u) => u.role === 'Admin')).toBe(false);
    });
  });

  describe('POST /users', () => {
    it('ไม่ส่ง Authorization -> 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .send({
          username: 'x',
          fullName: 'x',
          password: 'password123',
          role: 'Operation',
        })
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ user-management.Create (Operation) -> 403', async () => {
      const op = await makeUser(prisma, { role: 'Operation' });
      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenFor(op.id, 'Operation')}`)
        .send({
          username: 'x',
          fullName: 'x',
          password: 'password123',
          role: 'Operation',
        })
        .expect(403);
    });

    it('Admin สร้างสำเร็จ -> 201 + เขียน AuditLog', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Create);

      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenFor(admin.id, 'Admin')}`)
        .send({
          username: 'newop.test',
          fullName: 'New Operation Tester',
          password: 'password123',
          role: 'Operation',
        })
        .expect(201);

      const body = res.body as { id: string; username: string; role: string };
      expect(body.username).toBe('newop.test');
      expect(body.role).toBe('Operation');
      expect(body).not.toHaveProperty('passwordHash');

      const logs = await prisma.auditLog.findMany({
        where: { userId: admin.id, auditModule: 'user' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('create');
    });

    it('username ซ้ำ -> 409', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Create);
      await makeUser(prisma, { username: 'dup.test', role: 'Operation' });

      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenFor(admin.id, 'Admin')}`)
        .send({
          username: 'dup.test',
          fullName: 'x',
          password: 'password123',
          role: 'Operation',
        })
        .expect(409);
    });

    it.each(['Admin', 'SuperAdmin'])(
      'role %s -> 400 (กันสร้างบัญชี Admin/SuperAdmin ผ่านหน้านี้)',
      async (roleCode) => {
        const admin = await makeUser(prisma, { role: 'Admin' });
        await grant('Admin', ActionType.Create);

        await request(app.getHttpServer())
          .post('/api/v1/users')
          .set('Authorization', `Bearer ${tokenFor(admin.id, 'Admin')}`)
          .send({
            username: 'escalate.test',
            fullName: 'x',
            password: 'password123',
            role: roleCode,
          })
          .expect(400);
      },
    );

    it('password สั้นเกินไป -> 400 (validation)', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Create);

      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenFor(admin.id, 'Admin')}`)
        .send({
          username: 'shortpw.test',
          fullName: 'x',
          password: 'short',
          role: 'Operation',
        })
        .expect(400);
    });
  });

  describe('PATCH /users/:id', () => {
    it('ไม่ส่ง Authorization -> 401', async () => {
      const target = await makeUser(prisma, { role: 'Operation' });
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}`)
        .send({ isActive: false })
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ user-management.Update (Operation) -> 403', async () => {
      const op = await makeUser(prisma, { role: 'Operation' });
      const target = await makeUser(prisma, { role: 'ST' });
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}`)
        .set('Authorization', `Bearer ${tokenFor(op.id, 'Operation')}`)
        .send({ isActive: false })
        .expect(403);
    });

    it('Admin ปิดใช้งานบัญชีสำเร็จ -> 200 + เขียน AuditLog', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Update);
      const target = await makeUser(prisma, { role: 'ST', isActive: true });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}`)
        .set('Authorization', `Bearer ${tokenFor(admin.id, 'Admin')}`)
        .send({ isActive: false })
        .expect(200);

      expect((res.body as { isActive: boolean }).isActive).toBe(false);

      const logs = await prisma.auditLog.findMany({
        where: { userId: admin.id, auditModule: 'user' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('update');
    });

    it('Admin แก้ role สำเร็จ', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Update);
      const target = await makeUser(prisma, { role: 'ST' });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${target.id}`)
        .set('Authorization', `Bearer ${tokenFor(admin.id, 'Admin')}`)
        .send({ role: 'OT' })
        .expect(200);

      expect((res.body as { role: string }).role).toBe('OT');
    });

    it('ไม่พบผู้ใช้ -> 404', async () => {
      const admin = await makeUser(prisma, { role: 'Admin' });
      await grant('Admin', ActionType.Update);

      await request(app.getHttpServer())
        .patch('/api/v1/users/11111111-1111-1111-1111-111111111111')
        .set('Authorization', `Bearer ${tokenFor(admin.id, 'Admin')}`)
        .send({ isActive: false })
        .expect(404);
    });

    it.each(['Admin', 'SuperAdmin'])(
      'เป้าหมายเป็น role %s -> 404 (มองว่าไม่มีอยู่จากมุม resource นี้)',
      async (roleCode) => {
        const admin = await makeUser(prisma, { role: 'Admin' });
        await grant('Admin', ActionType.Update);
        const target = await makeUser(prisma, { role: roleCode as RoleCode });

        await request(app.getHttpServer())
          .patch(`/api/v1/users/${target.id}`)
          .set('Authorization', `Bearer ${tokenFor(admin.id, 'Admin')}`)
          .send({ isActive: false })
          .expect(404);
      },
    );

    it.each(['Admin', 'SuperAdmin'])(
      'พยายามเปลี่ยน role เป็น %s -> 400 (กัน escalation)',
      async (roleCode) => {
        const admin = await makeUser(prisma, { role: 'Admin' });
        await grant('Admin', ActionType.Update);
        const target = await makeUser(prisma, { role: 'ST' });

        await request(app.getHttpServer())
          .patch(`/api/v1/users/${target.id}`)
          .set('Authorization', `Bearer ${tokenFor(admin.id, 'Admin')}`)
          .send({ role: roleCode })
          .expect(400);
      },
    );
  });
});
