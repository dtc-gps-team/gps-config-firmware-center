import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import {
  lockFirmwareForDelete,
  lockFirmwareForReference,
} from './firmware-lock';

function txWith(queryRaw: jest.Mock): Prisma.TransactionClient {
  return { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;
}

function sqlOf(queryRaw: jest.Mock): string {
  const calls = queryRaw.mock.calls as [TemplateStringsArray][];
  return calls[0][0].join('?');
}

describe('firmware-lock', () => {
  describe('lockFirmwareForReference (ฝั่งสร้าง reference - FOR SHARE)', () => {
    it('Firmware อยู่และยังไม่ถูกลบ -> ผ่าน และล็อกแบบ FOR SHARE', async () => {
      const queryRaw = jest.fn().mockResolvedValue([{ deletedAt: null }]);

      await expect(
        lockFirmwareForReference(txWith(queryRaw), 'fw-1'),
      ).resolves.toBeUndefined();
      expect(sqlOf(queryRaw)).toContain('FOR SHARE');
    });

    it('ไม่พบ Firmware -> NotFoundException', async () => {
      const queryRaw = jest.fn().mockResolvedValue([]);

      await expect(
        lockFirmwareForReference(txWith(queryRaw), 'fw-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ถูกลบแล้ว/กำลังถูกลบ (deletedAt มีค่า) -> ConflictException ไม่ให้สร้าง reference ใหม่', async () => {
      const queryRaw = jest.fn().mockResolvedValue([{ deletedAt: new Date() }]);

      await expect(
        lockFirmwareForReference(txWith(queryRaw), 'fw-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('Postgres 40001 ผ่าน $queryRaw (P2010) -> ConflictException ให้ลองใหม่ ไม่ใช่ 500', async () => {
      const queryRaw = jest.fn().mockRejectedValue(
        new PrismaClientKnownRequestError('Raw query failed', {
          code: 'P2010',
          clientVersion: 'test',
          meta: { code: '40001' },
        }),
      );

      await expect(
        lockFirmwareForReference(txWith(queryRaw), 'fw-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('lockFirmwareForDelete (ฝั่งลบ - FOR UPDATE)', () => {
    it('เจอแถว -> ผ่าน และล็อกแบบ FOR UPDATE', async () => {
      const queryRaw = jest.fn().mockResolvedValue([{ id: 'fw-1' }]);

      await expect(
        lockFirmwareForDelete(txWith(queryRaw), 'fw-1'),
      ).resolves.toBeUndefined();
      expect(sqlOf(queryRaw)).toContain('FOR UPDATE');
    });

    it('ไม่พบแถว -> NotFoundException', async () => {
      const queryRaw = jest.fn().mockResolvedValue([]);

      await expect(
        lockFirmwareForDelete(txWith(queryRaw), 'fw-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
