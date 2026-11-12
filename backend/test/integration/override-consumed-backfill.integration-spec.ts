import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTestPrisma,
  getOrCreateDeviceModel,
  makeUser,
  resetDb,
} from './setup';

/**
 * backfill `consumedAt` ของ migration `20261103090000` (รีวิว A #432 ข้อ 2) —
 * รัน UPDATE ใน migration จริงซ้ำบนข้อมูลที่ seed เอง (คอลัมน์มีแล้วจาก migrate
 * deploy) เพื่อยืนยันว่า mark เฉพาะแถวที่มีหลักฐานว่าถูกส่งหลังอนุมัติ
 * (versionNumber ไม่ซ้ำต่อเครื่อง จึงไล่ 1–4 ข้าม Config)
 */
const backfillSql = (() => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../prisma/migrations/20261103090000_add_device_config_override_consumed_at/migration.sql',
    ),
    'utf8',
  );
  return sql.slice(sql.indexOf('UPDATE "DeviceConfigOverride"'));
})();

describe('migration backfill DeviceConfigOverride.consumedAt (integration)', () => {
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

  it('mark เฉพาะแถวที่ถูกส่งหลังอนุมัติ (Rollout สำเร็จ หรือ apply-config) แถวที่ยังไม่เคยส่งคงไว้', async () => {
    const model = await getOrCreateDeviceModel(prisma, 'GT06N');
    const op = await makeUser(prisma, { role: 'Operation' });
    const device = await prisma.device.create({
      data: {
        deviceId: `DEV-${randomUUID().slice(0, 8)}`,
        simNumber: `8966${Math.floor(Math.random() * 1e8)}`,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'installed',
        modelId: model.id,
      },
    });
    const config = (name: string) =>
      prisma.config.create({
        data: {
          name,
          modelId: model.id,
          protocol: 'TCP',
          status: 'approved',
          fields: { SPEED_LIMIT: 120 },
          createdBy: op.id,
        },
      });
    const [viaRollout, viaAudit, neverSent, sentBefore] = await Promise.all([
      config(`a-${randomUUID()}`),
      config(`b-${randomUUID()}`),
      config(`c-${randomUUID()}`),
      config(`d-${randomUUID()}`),
    ]);
    const decidedAt = new Date('2026-10-01T00:00:00Z');
    const override = (configId: string, versionNumber: number) =>
      prisma.deviceConfigOverride.create({
        data: {
          deviceId: device.deviceId,
          configId,
          versionNumber,
          fields: { SPEED_LIMIT: 90 },
          reason: 'ลูกค้าขอ',
          status: 'approved',
          overriddenBy: op.id,
          decidedAt,
        },
      });
    const rows = {
      viaRollout: await override(viaRollout.id, 1),
      viaAudit: await override(viaAudit.id, 2),
      neverSent: await override(neverSent.id, 3),
      sentBefore: await override(sentBefore.id, 4),
    };

    // 1. Rollout สำเร็จหลังอนุมัติ
    const campaign = await prisma.campaign.create({
      data: { name: 'กลุ่ม', createdBy: op.id },
    });
    const rollout = await prisma.campaignRollout.create({
      data: {
        campaignId: campaign.id,
        payloadType: 'Config',
        configId: viaRollout.id,
        status: 'completed',
        createdBy: op.id,
      },
    });
    await prisma.campaignRolloutTarget.create({
      data: {
        rolloutId: rollout.id,
        deviceId: device.deviceId,
        status: 'success',
      },
    });
    // 2. apply-config ตรงหลังอนุมัติ · 4. apply-config ก่อนอนุมัติ (ไม่นับ)
    await prisma.auditLog.createMany({
      data: [
        {
          userId: op.id,
          auditModule: 'device',
          action: 'apply-config',
          metadata: { deviceId: device.deviceId, configId: viaAudit.id },
          createdAt: new Date('2026-10-02T00:00:00Z'),
        },
        {
          userId: op.id,
          auditModule: 'device',
          action: 'apply-config',
          metadata: { deviceId: device.deviceId, configId: sentBefore.id },
          createdAt: new Date('2026-09-01T00:00:00Z'),
        },
      ],
    });

    await prisma.$executeRawUnsafe(backfillSql);

    const after = async (id: string) =>
      (await prisma.deviceConfigOverride.findUniqueOrThrow({ where: { id } }))
        .consumedAt;
    expect(await after(rows.viaRollout.id)).toEqual(decidedAt);
    expect(await after(rows.viaAudit.id)).toEqual(decidedAt);
    expect(await after(rows.neverSent.id)).toBeNull();
    expect(await after(rows.sentBefore.id)).toBeNull();
  });
});
