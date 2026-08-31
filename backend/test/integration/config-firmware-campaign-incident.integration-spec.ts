import { Prisma, PrismaClient } from '@prisma/client';
import { createTestPrisma, resetDb, makeUser } from './setup';

/**
 * Schema-only PR (#25) สำหรับ Config/Firmware/Campaign/Incident — ยังไม่มี
 * service/controller จริง (รอ #26 เป็นต้นไป) เทสนี้จึงเช็คที่ระดับ Prisma/DB
 * ตรงๆ เหมือนกับที่ device.integration-spec.ts ทำไว้ให้ PR #38 — ยืนยันแค่
 * ว่า FK constraint ที่ Prisma generate ให้ทำงานตรงตามที่ตั้งใจไว้จริง
 * (required relation = RESTRICT, optional relation = SET NULL) ตามที่ตอบ
 * kittiphong ไว้ใน PR #25 review — ไม่ใช่การเทส business logic ของแต่ละโมดูล
 * (อันนั้นเป็น scope ของ #26/#27 เป็นต้นไป)
 */
describe('Config/Firmware/Campaign/Incident FK constraints (integration — real postgres)', () => {
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

  it('Config.createdBy ชี้ไป user id ที่ไม่มีจริง -> FK violation (P2003)', async () => {
    expect.assertions(2);
    try {
      await prisma.config.create({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
          createdBy: 'non-existent-user-id',
        },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((err as Prisma.PrismaClientKnownRequestError).code).toBe('P2003');
    }
  });

  it('Config.createdBy เป็น required relation (ON DELETE RESTRICT) -> ลบ User ที่ยังมี Config อ้างอิงอยู่ไม่ได้', async () => {
    const sw = await makeUser(prisma, { role: 'SW' });
    await prisma.config.create({
      data: {
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: {},
        createdBy: sw.id,
      },
    });

    expect.assertions(2);
    try {
      await prisma.user.delete({ where: { id: sw.id } });
    } catch (err) {
      expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((err as Prisma.PrismaClientKnownRequestError).code).toBe('P2003');
    }
  });

  it('Campaign.configId เป็น optional relation (ON DELETE SET NULL) -> ลบ Config แล้ว Campaign เหลืออยู่พร้อม configId เป็น null', async () => {
    const sw = await makeUser(prisma, { role: 'SW' });
    const operation = await makeUser(prisma, { role: 'Operation' });

    const config = await prisma.config.create({
      data: {
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: {},
        createdBy: sw.id,
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: 'Rollout GT06N batch 1',
        payloadType: 'Config',
        configId: config.id,
        createdBy: operation.id,
      },
    });

    await prisma.config.delete({ where: { id: config.id } });

    const reloaded = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    });
    expect(reloaded.configId).toBeNull();
  });

  it('Incident.relatedFirmwareId เป็น optional relation (ON DELETE SET NULL) -> ลบ Firmware แล้ว Incident เหลืออยู่พร้อม relatedFirmwareId เป็น null', async () => {
    const sw = await makeUser(prisma, { role: 'SW' });

    const firmware = await prisma.firmware.create({
      data: {
        version: '1.2.3',
        deviceModelCompatibility: ['GT06N'],
        uploadedBy: sw.id,
      },
    });

    const incident = await prisma.incident.create({
      data: {
        title: 'Firmware update ล้มเหลวหลายกล่อง',
        severity: 'high',
        relatedFirmwareId: firmware.id,
      },
    });

    await prisma.firmware.delete({ where: { id: firmware.id } });

    const reloaded = await prisma.incident.findUniqueOrThrow({
      where: { id: incident.id },
    });
    expect(reloaded.relatedFirmwareId).toBeNull();
  });
});
