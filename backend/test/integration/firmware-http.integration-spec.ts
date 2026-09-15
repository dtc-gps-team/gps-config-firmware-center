import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ActionType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { FirmwareModule } from '../../src/firmware/firmware.module';
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
// ไปที่ DB _test เดียวกับที่ integration test อื่นใช้ (pattern เดียวกับ
// config-http.integration-spec.ts / campaign-http.integration-spec.ts)
process.env.DATABASE_URL = TEST_DATABASE_URL;

/**
 * Firmware Repository (Sprint 3 #23) — `POST/GET/PATCH /firmware` +
 * `/firmware/{id}/simulate` ผ่าน HTTP จริง (JwtAuthGuard -> PermissionGuard
 * เต็มเส้นทาง) + ยืนยันว่าไฟล์อัปโหลดขึ้น Object Storage จริง (MinIO —
 * ไม่ mock เพราะ FirmwareStorageService ตั้งใจไม่มี mock mode ดู comment
 * ในไฟล์นั้น) ต้องมี MinIO รันอยู่ (`docker-compose up -d` — CI มี service
 * `minio` ให้แล้วใน backend-ci.yml)
 */
describe('FirmwareController (integration — real postgres + guard chain + real MinIO)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // FirmwareModule -> FirmwareStorageService/FIRMWARE_SIMULATOR factory
      // inject @nestjs/config — forRoot เองเหมือน campaign-http spec ·
      // envFilePath ชี้ไป .env root ให้ได้ OBJECT_STORAGE_* จริง (local) —
      // CI ตั้งผ่าน job env แทน (ไม่มีไฟล์ .env ใน CI)
      imports: [
        NestConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env'] }),
        PrismaModule,
        FirmwareModule,
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
    await resetDb(prisma); // ลบ firmware ให้แล้ว (ดู setup.ts)
    await prisma.rolePermission.deleteMany();
  });

  function tokenFor(sub: string, role: string): string {
    return jwtService.sign({ sub, role });
  }

  async function grant(
    roleCode: RoleCode,
    action: ActionType,
    resource = 'firmware',
  ): Promise<void> {
    const role = await getOrCreateRole(prisma, roleCode);
    await prisma.rolePermission.create({
      data: { roleId: role.id, resource, action },
    });
  }

  describe('POST /firmware', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/firmware')
        .field('version', 'v1')
        .field('deviceModel', 'GT06N')
        .attach('file', Buffer.from('firmware bytes'), 'fw.bin')
        .expect(401);
    });

    it('role ไม่มีสิทธิ์ firmware.Create (Operation) -> 403', async () => {
      const opUser = await makeUser(prisma, { role: 'Operation' });
      const token = tokenFor(opUser.id, 'Operation');

      await request(app.getHttpServer())
        .post('/api/v1/firmware')
        .set('Authorization', `Bearer ${token}`)
        .field('version', 'v1')
        .field('deviceModel', 'GT06N')
        .attach('file', Buffer.from('firmware bytes'), 'fw.bin')
        .expect(403);
    });

    it('SW มีสิทธิ์ firmware.Create -> 201 อัปโหลดขึ้น Object Storage จริง + สร้าง record ครบ', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Create);
      const token = tokenFor(swUser.id, 'SW');

      const res = await request(app.getHttpServer())
        .post('/api/v1/firmware')
        .set('Authorization', `Bearer ${token}`)
        .field('version', 'GT06N-v2.4.1')
        .field('deviceModel', 'GT06N')
        .attach('file', Buffer.from('firmware bytes'), 'fw.bin')
        .expect(201);

      const body = res.body as {
        id: string;
        version: string;
        deviceModelCompatibility: string[];
        uploadStatus: string;
        originalFilename: string;
        fileSizeBytes: number;
        uploadedBy: string;
      };
      expect(body.version).toBe('GT06N-v2.4.1');
      expect(body.deviceModelCompatibility).toEqual(['GT06N']);
      expect(body.uploadStatus).toBe('stored');
      expect(body.originalFilename).toBe('fw.bin');
      expect(body.fileSizeBytes).toBe(Buffer.byteLength('firmware bytes'));
      expect(body.uploadedBy).toBe(swUser.id);

      const stored = await prisma.firmware.findUnique({
        where: { id: body.id },
      });
      expect(stored?.objectKey).toContain(body.id);
    });

    it('สำเร็จ -> เขียน AuditLog action create (module firmware)', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Create);
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .post('/api/v1/firmware')
        .set('Authorization', `Bearer ${token}`)
        .field('version', 'v1')
        .field('deviceModel', 'GT06N')
        .attach('file', Buffer.from('firmware bytes'), 'fw.bin')
        .expect(201);

      const logs = await prisma.auditLog.findMany({
        where: { userId: swUser.id, auditModule: 'firmware' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('create');
    });

    it('ไม่แนบไฟล์ -> 400', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Create);
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .post('/api/v1/firmware')
        .set('Authorization', `Bearer ${token}`)
        .field('version', 'v1')
        .field('deviceModel', 'GT06N')
        .expect(400);
    });

    it('ไม่ระบุ version -> 400', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Create);
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .post('/api/v1/firmware')
        .set('Authorization', `Bearer ${token}`)
        .field('deviceModel', 'GT06N')
        .attach('file', Buffer.from('firmware bytes'), 'fw.bin')
        .expect(400);
    });
  });

  describe('GET /firmware', () => {
    it('ไม่ส่ง Authorization header -> 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/firmware').expect(401);
    });

    it('role มีสิทธิ์ firmware.Read (Auditor) -> 200 คืนรายการ', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await prisma.firmware.create({
        data: {
          version: 'v1',
          deviceModelCompatibility: ['GT06N'],
          uploadStatus: 'stored',
          objectKey: 'firmware/x/fw.bin',
          originalFilename: 'fw.bin',
          fileSizeBytes: 10,
          uploadedBy: swUser.id,
        },
      });
      const auditorUser = await makeUser(prisma, { role: 'Auditor' });
      await grant('Auditor', ActionType.Read);
      const token = tokenFor(auditorUser.id, 'Auditor');

      const res = await request(app.getHttpServer())
        .get('/api/v1/firmware')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
    });
  });

  describe('GET /firmware/:id', () => {
    it('ไม่เจอ -> 404', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Read);
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .get('/api/v1/firmware/11111111-1111-1111-1111-111111111111')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('PATCH /firmware/:id', () => {
    async function seedFirmware(uploadedBy: string) {
      return prisma.firmware.create({
        data: {
          version: 'v1',
          deviceModelCompatibility: ['GT06N'],
          uploadStatus: 'stored',
          objectKey: 'firmware/x/fw.bin',
          originalFilename: 'fw.bin',
          fileSizeBytes: 10,
          uploadedBy,
        },
      });
    }

    it('role ไม่มีสิทธิ์ firmware.Update (ST) -> 403', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const firmware = await seedFirmware(swUser.id);
      const stUser = await makeUser(prisma, { role: 'ST' });
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .patch(`/api/v1/firmware/${firmware.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceModelCompatibility: ['GT06N', 'GT06L'] })
        .expect(403);
    });

    it('SW มีสิทธิ์ firmware.Update -> 200 แทนที่ deviceModelCompatibility ทั้ง array', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Update);
      const firmware = await seedFirmware(swUser.id);
      const token = tokenFor(swUser.id, 'SW');

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/firmware/${firmware.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceModelCompatibility: ['GT06N', 'GT06L'] })
        .expect(200);

      const body = res.body as { deviceModelCompatibility: string[] };
      expect(body.deviceModelCompatibility).toEqual(['GT06N', 'GT06L']);
    });

    it('array ว่างเปล่า -> 400 (validation)', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      await grant('SW', ActionType.Update);
      const firmware = await seedFirmware(swUser.id);
      const token = tokenFor(swUser.id, 'SW');

      await request(app.getHttpServer())
        .patch(`/api/v1/firmware/${firmware.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceModelCompatibility: [] })
        .expect(400);
    });
  });

  describe('POST /firmware/:id/simulate', () => {
    async function seedFirmware(
      uploadedBy: string,
      overrides?: { uploadStatus?: 'pending' | 'stored' | 'failed' },
    ) {
      return prisma.firmware.create({
        data: {
          version: 'v1',
          deviceModelCompatibility: ['GT06N'],
          uploadStatus: overrides?.uploadStatus ?? 'stored',
          objectKey: 'firmware/x/fw.bin',
          originalFilename: 'fw.bin',
          fileSizeBytes: 10,
          uploadedBy,
        },
      });
    }

    it('role ไม่มีสิทธิ์ firmware-simulation (Auditor) -> 403', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const firmware = await seedFirmware(swUser.id);
      const auditorUser = await makeUser(prisma, { role: 'Auditor' });
      const token = tokenFor(auditorUser.id, 'Auditor');

      await request(app.getHttpServer())
        .post(`/api/v1/firmware/${firmware.id}/simulate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceModel: 'GT06N' })
        .expect(403);
    });

    it('ST มีสิทธิ์ firmware-simulation, รุ่นตรงกับ compatibility -> 200 passed:true', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const firmware = await seedFirmware(swUser.id);
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'firmware-simulation');
      const token = tokenFor(stUser.id, 'ST');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/firmware/${firmware.id}/simulate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceModel: 'GT06N' })
        .expect(200);

      expect((res.body as { passed: boolean }).passed).toBe(true);
    });

    it('รุ่นไม่ตรงกับ compatibility -> 200 passed:false', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const firmware = await seedFirmware(swUser.id);
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'firmware-simulation');
      const token = tokenFor(stUser.id, 'ST');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/firmware/${firmware.id}/simulate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceModel: 'GT06L' })
        .expect(200);

      expect((res.body as { passed: boolean }).passed).toBe(false);
    });

    it('uploadStatus ยัง pending -> 409', async () => {
      const swUser = await makeUser(prisma, { role: 'SW' });
      const firmware = await seedFirmware(swUser.id, {
        uploadStatus: 'pending',
      });
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'firmware-simulation');
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .post(`/api/v1/firmware/${firmware.id}/simulate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceModel: 'GT06N' })
        .expect(409);
    });

    it('ไม่พบ Firmware -> 404', async () => {
      const stUser = await makeUser(prisma, { role: 'ST' });
      await grant('ST', ActionType.Read, 'firmware-simulation');
      const token = tokenFor(stUser.id, 'ST');

      await request(app.getHttpServer())
        .post('/api/v1/firmware/11111111-1111-1111-1111-111111111111/simulate')
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceModel: 'GT06N' })
        .expect(404);
    });
  });
});
