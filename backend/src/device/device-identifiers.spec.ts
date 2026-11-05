import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertDeviceIdentifiersFree,
  lockDeviceIdentifiers,
} from './device-identifiers';

type Row = { deviceId: string; status: string };

/**
 * tx จำลอง: `$queryRaw` คืนผลตามลำดับการเรียก (ตรวจทีละช่องตามลำดับ IMEI -> Serial -> Blackbox) —
 * ตัว SQL จริง (เทียบไม่สนตัวพิมพ์/ช่องว่าง, status::text) ครอบด้วย integration test กับ Postgres จริง
 */
function makeTx(results: Row[][] = []) {
  const queryRaw = jest.fn();
  for (const rows of results) queryRaw.mockResolvedValueOnce(rows);
  queryRaw.mockResolvedValue([]);
  const executeRaw = jest.fn().mockResolvedValue(0);
  return {
    tx: {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
    } as unknown as Prisma.TransactionClient,
    queryRaw,
    executeRaw,
  };
}

const ALL = { imei: '1', serialNumber: '2', blackboxId: '3' };

describe('device-identifiers', () => {
  it('lockDeviceIdentifiers -> ขอ advisory lock ระดับ transaction', async () => {
    const { tx, executeRaw } = makeTx();

    await lockDeviceIdentifiers(tx);

    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('ไม่ซ้ำเลย -> ผ่าน ตรวจครบทั้ง 3 ช่อง', async () => {
    const { tx, queryRaw } = makeTx();

    await expect(assertDeviceIdentifiersFree(tx, ALL)).resolves.toBeUndefined();
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });

  it('ค่าว่าง/null/ช่องว่างล้วนไม่ถูกตรวจ (เครื่องเดิมที่ไม่มีค่าไม่นับว่าซ้ำ)', async () => {
    const { tx, queryRaw } = makeTx();

    await assertDeviceIdentifiersFree(tx, {
      imei: null,
      serialNumber: '   ',
      blackboxId: undefined,
    });

    expect(queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    [0, 'IMEI'],
    [1, 'Serial Number'],
    [2, 'Blackbox ID'],
  ])(
    'ช่องลำดับ %i ซ้ำ -> 409 ขึ้นต้นด้วยชื่อช่อง "%s" บอกเครื่องที่ซ้ำ',
    async (index, label) => {
      const results: Row[][] = [[], [], []];
      results[index] = [{ deviceId: 'DEV-OLD', status: 'installed' }];
      const { tx } = makeTx(results);

      const err = await assertDeviceIdentifiersFree(tx, ALL).catch(
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(ConflictException);
      const message = (err as ConflictException).message;
      expect(message.startsWith(`${label} `)).toBe(true);
      expect(message).toContain('DEV-OLD');
      expect(message).not.toContain('ปลดระวางแล้ว');
    },
  );

  it('ซ้ำกับเครื่องที่ปลดระวางแล้ว -> ข้อความระบุว่าปลดระวางแล้ว (ยังห้ามซ้ำ)', async () => {
    const { tx } = makeTx([
      [{ deviceId: 'DEV-RET', status: 'decommissioned' }],
    ]);

    await expect(
      assertDeviceIdentifiersFree(tx, { imei: '860000000000001' }),
    ).rejects.toThrow(/DEV-RET.*ปลดระวางแล้ว/);
  });
});
