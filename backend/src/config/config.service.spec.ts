import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser, ConfigService } from './config.service';

type ConfigDelegateMock = {
  create: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

const draftConfig: Config = {
  id: '11111111-1111-1111-1111-111111111111',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'draft',
  fields: { APN1: 'internet' },
  createdBy: 'sw-1',
  approvedBy: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const testingConfig: Config = { ...draftConfig, status: 'testing' };

const sw: ActingUser = { id: 'sw-1', role: 'SW' };

describe('ConfigService', () => {
  let service: ConfigService;
  let config: ConfigDelegateMock;

  beforeEach(async () => {
    config = {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigService,
        { provide: PrismaService, useValue: { config } },
      ],
    }).compile();

    service = module.get(ConfigService);
  });

  describe('create', () => {
    it('ผูก createdBy จาก actor และส่ง fields/deviceModel/protocol ตรงๆ ให้ Prisma', async () => {
      config.create.mockResolvedValue(draftConfig);

      await service.create(
        { deviceModel: 'GT06N', protocol: 'TCP', fields: { APN1: 'internet' } },
        sw,
      );

      expect(config.create).toHaveBeenCalledWith({
        data: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          createdBy: 'sw-1',
        },
      });
    });
  });

  describe('findAll', () => {
    it('ส่ง status filter ต่อให้ Prisma ตรงๆ ไม่ scope ตาม creator', async () => {
      config.findMany.mockResolvedValue([draftConfig]);

      const result = await service.findAll({ status: 'draft' });

      expect(result).toEqual([draftConfig]);
      expect(config.findMany).toHaveBeenCalledWith({
        where: { status: 'draft' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('ไม่เจอ config -> NotFoundException', async () => {
      config.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('เจอ config -> คืนค่าตรงๆ', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      await expect(service.findOne(draftConfig.id)).resolves.toEqual(
        draftConfig,
      );
    });
  });

  describe('update', () => {
    it('config status ไม่ใช่ draft -> ConflictException', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      await expect(
        service.update(testingConfig.id, { deviceModel: 'GT06L' }),
      ).rejects.toThrow(ConflictException);
      expect(config.update).not.toHaveBeenCalled();
    });

    it('config status เป็น draft -> update ผ่าน', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockResolvedValue({
        ...draftConfig,
        deviceModel: 'GT06L',
      });

      await service.update(draftConfig.id, { deviceModel: 'GT06L' });

      expect(config.update).toHaveBeenCalledWith({
        where: { id: draftConfig.id },
        data: {
          deviceModel: 'GT06L',
          protocol: undefined,
          fields: undefined,
        },
      });
    });

    it('ไม่เจอ config เลย -> NotFoundException (ไม่ใช่ ConflictException)', async () => {
      config.findUnique.mockResolvedValue(null);
      await expect(
        service.update('missing-id', { deviceModel: 'GT06L' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('config status ไม่ใช่ draft -> ConflictException', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      await expect(service.remove(testingConfig.id)).rejects.toThrow(
        ConflictException,
      );
      expect(config.delete).not.toHaveBeenCalled();
    });

    it('config status เป็น draft -> delete ผ่าน', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.delete.mockResolvedValue(draftConfig);

      await service.remove(draftConfig.id);

      expect(config.delete).toHaveBeenCalledWith({
        where: { id: draftConfig.id },
      });
    });
  });
});
