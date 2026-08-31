import { Prisma, PrismaClient } from '@prisma/client';
import { createTestPrisma, resetDb } from './setup';

/**
 * Device.simNumber ไม่มี @unique เต็มคอลัมน์ใน schema.prisma — ใช้ partial
 * unique index ที่เขียนเป็น raw SQL ตรงใน migration.sql แทน (unique เฉพาะ
 * record ที่ status != decommissioned) ตัดสินใจใน PR #38 comment thread
 * (#issuecomment-5474171067 / #issuecomment-5474255608, paveekornkwork-dev,
 * 2026-08-31) — เทสนี้พิสูจน์ว่า partial index ทำงานตรงตามที่ออกแบบไว้จริง
 * (ไม่ใช่แค่เชื่อ comment เฉยๆ)
 */
describe('Device.simNumber partial unique index (integration — real postgres)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('สอง Device ที่ status ไม่ decommissioned ใช้ simNumber เดียวกัน -> unique violation ที่ error message อ่านออก', async () => {
    await prisma.device.create({
      data: {
        deviceId: 'DEV-ACTIVE-1',
        simNumber: 'SIM-DUP-0001',
        deviceModel: 'GT06N',
        protocol: 'TCP',
      },
    });

    // ยังไม่มี Device service/controller จริง (schema-only PR — ดู B ทำใน
    // Phase 5) เทสนี้จึงเช็คที่ระดับ Prisma error ตรงๆ ก่อน — ตอนสร้าง
    // DeviceService จริง ควรจับ P2002 นี้แล้วโยนเป็น ConflictException (409)
    // พร้อมข้อความภาษาที่ผู้ใช้อ่านเข้าใจ (เช่น "หมายเลข SIM นี้ถูกใช้งานอยู่
    // กับอุปกรณ์ที่ active อยู่แล้ว") แทนที่จะปล่อย Prisma error ดิบออกไป
    expect.assertions(4);
    try {
      await prisma.device.create({
        data: {
          deviceId: 'DEV-ACTIVE-2',
          simNumber: 'SIM-DUP-0001',
          deviceModel: 'GT06N',
          protocol: 'TCP',
        },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      const prismaErr = err as Prisma.PrismaClientKnownRequestError;
      expect(prismaErr.code).toBe('P2002');
      // Prisma แปลง P2002 ให้บอกชื่อ field ที่ชนกันได้จริงแม้ constraint นี้จะ
      // ไม่ได้ประกาศผ่าน @unique ใน schema (มาจาก raw SQL migration ล้วนๆ) —
      // ยืนยันแล้วว่า meta.target บอก "simNumber" ตรงๆ ไม่ใช่ index name ดิบ
      expect(prismaErr.meta?.target).toEqual(['simNumber']);
      expect(prismaErr.message).toContain('simNumber');
    }
  });

  it('Device decommissioned ใช้ simNumber เดิม + Device ใหม่ (status registered) ใช้ simNumber เดียวกัน -> สำเร็จทั้งคู่', async () => {
    const decommissioned = await prisma.device.create({
      data: {
        deviceId: 'DEV-OLD-1',
        simNumber: 'SIM-REUSE-0001',
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'decommissioned',
      },
    });

    const replacement = await prisma.device.create({
      data: {
        deviceId: 'DEV-NEW-1',
        simNumber: 'SIM-REUSE-0001',
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'registered',
      },
    });

    expect(decommissioned.simNumber).toBe('SIM-REUSE-0001');
    expect(replacement.simNumber).toBe('SIM-REUSE-0001');
    expect(await prisma.device.count()).toBe(2);
  });
});
