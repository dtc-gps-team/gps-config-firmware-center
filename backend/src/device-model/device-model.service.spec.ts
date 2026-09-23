import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DeviceModel } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceModelService } from './device-model.service';

const gt06n: DeviceModel = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'GT06N',
  manufacturer: null,
  supportedProtocols: ['TCP'],
  status: 'active',
  warrantyMonths: null,
  endOfSupportDate: null,
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makeP2002(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function makeP2025(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Record to update not found.', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

describe('DeviceModelService', () => {
  let service: DeviceModelService;
  let findMany: jest.Mock;
  let findUnique: jest.Mock;
  let create: jest.Mock;
  let update: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn();
    findUnique = jest.fn();
    create = jest.fn();
    update = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceModelService,
        {
          provide: PrismaService,
          useValue: { deviceModel: { findMany, findUnique, create, update } },
        },
      ],
    }).compile();

    service = module.get(DeviceModelService);
  });

  describe('findAll', () => {
    it('คืนรุ่นทั้งหมดเรียงตามชื่อ', async () => {
      findMany.mockResolvedValue([gt06n]);

      const result = await service.findAll();

      expect(result).toEqual([gt06n]);
      expect(findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
    });
  });

  describe('findOne', () => {
    it('เจอ -> คืนรุ่นนั้น', async () => {
      findUnique.mockResolvedValue(gt06n);

      await expect(service.findOne(gt06n.id)).resolves.toEqual(gt06n);
    });

    it('ไม่เจอ -> NotFoundException', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByName', () => {
    it('เจอ -> คืนรุ่นนั้น', async () => {
      findUnique.mockResolvedValue(gt06n);

      await expect(service.findByName('GT06N')).resolves.toEqual(gt06n);
      expect(findUnique).toHaveBeenCalledWith({ where: { name: 'GT06N' } });
    });

    it('ไม่เจอ -> คืน null (ไม่ throw — ให้ผู้เรียกตัดสินใจเอง)', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.findByName('UNKNOWN')).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('สร้างรุ่นใหม่พร้อม field ที่ระบุ', async () => {
      create.mockResolvedValue(gt06n);

      const result = await service.create({
        name: 'GT06N',
        supportedProtocols: ['TCP'],
      });

      expect(result).toEqual(gt06n);
      expect(create).toHaveBeenCalledWith({
        data: {
          name: 'GT06N',
          manufacturer: undefined,
          supportedProtocols: ['TCP'],
          status: undefined,
          warrantyMonths: undefined,
          endOfSupportDate: undefined,
          notes: undefined,
        },
      });
    });

    it('ชื่อรุ่นซ้ำ (P2002) -> ConflictException', async () => {
      create.mockRejectedValue(makeP2002());

      await expect(
        service.create({ name: 'GT06N', supportedProtocols: ['TCP'] }),
      ).rejects.toThrow(ConflictException);
    });

    it('error อื่นที่ไม่ใช่ P2002 -> โยนต่อตรงๆ', async () => {
      create.mockRejectedValue(new Error('db down'));

      await expect(
        service.create({ name: 'GT06N', supportedProtocols: ['TCP'] }),
      ).rejects.toThrow('db down');
    });
  });

  describe('update', () => {
    it('เจอ -> แก้และคืนค่าใหม่', async () => {
      findUnique.mockResolvedValue(gt06n);
      update.mockResolvedValue({ ...gt06n, status: 'discontinued' });

      const result = await service.update(gt06n.id, {
        status: 'discontinued',
      });

      expect(result.status).toBe('discontinued');
      expect(update).toHaveBeenCalledWith({
        where: { id: gt06n.id },
        data: {
          manufacturer: undefined,
          supportedProtocols: undefined,
          status: 'discontinued',
          warrantyMonths: undefined,
          endOfSupportDate: undefined,
          notes: undefined,
        },
      });
    });

    it('ไม่เจอ (findOne ก่อน) -> NotFoundException ไม่เรียก update เลย', async () => {
      findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { status: 'discontinued' }),
      ).rejects.toThrow(NotFoundException);
      expect(update).not.toHaveBeenCalled();
    });

    it('race condition: ถูกลบไปพอดีระหว่าง findOne กับ update (P2025) -> NotFoundException', async () => {
      findUnique.mockResolvedValue(gt06n);
      update.mockRejectedValue(makeP2025());

      await expect(
        service.update(gt06n.id, { status: 'discontinued' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
