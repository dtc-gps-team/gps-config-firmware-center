import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
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

/** จำลอง Prisma error P2025 ("Record to update/delete not found") ให้ตรงกับ
 * shape จริงของ PrismaClientKnownRequestError (ต้องมี code + clientVersion) */
function makeP2025(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Record to update not found.', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

function makeMulterFile(content: string, filename = 'config.json'): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: filename,
    encoding: '7bit',
    mimetype: 'application/json',
    buffer: Buffer.from(content, 'utf-8'),
    size: Buffer.byteLength(content, 'utf-8'),
  } as Express.Multer.File;
}

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

  describe('importFromJson', () => {
    it('ไม่มีไฟล์แนบมา -> BadRequestException', async () => {
      await expect(
        service.importFromJson(undefined, 'json', sw),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('format ไม่ใช่ json (หรือไม่ส่งมา) -> BadRequestException', async () => {
      const file = makeMulterFile('{}');
      await expect(
        service.importFromJson(file, 'csv', sw),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importFromJson(file, undefined, sw),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('ไฟล์ parse เป็น JSON ไม่ได้ -> BadRequestException', async () => {
      const file = makeMulterFile('{ not valid json');
      await expect(
        service.importFromJson(file, 'json', sw),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON เป็น null (valid JSON แต่ไม่ใช่ object) -> BadRequestException ไม่ใช่ TypeError', async () => {
      const file = makeMulterFile('null');
      await expect(
        service.importFromJson(file, 'json', sw),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON เป็น array -> BadRequestException', async () => {
      const file = makeMulterFile(
        JSON.stringify([{ deviceModel: 'GT06N', protocol: 'TCP', fields: {} }]),
      );
      await expect(
        service.importFromJson(file, 'json', sw),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON เป็นค่าเดี่ยว (number/string) -> BadRequestException', async () => {
      await expect(
        service.importFromJson(makeMulterFile('42'), 'json', sw),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importFromJson(makeMulterFile('"hello"'), 'json', sw),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON validate ไม่ผ่าน (ขาด deviceModel) -> BadRequestException', async () => {
      const file = makeMulterFile(
        JSON.stringify({ protocol: 'TCP', fields: {} }),
      );
      await expect(
        service.importFromJson(file, 'json', sw),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON มี field แปลกปลอม (เช่น id/status) -> BadRequestException (forbidNonWhitelisted)', async () => {
      const file = makeMulterFile(
        JSON.stringify({
          id: 'should-not-be-here',
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: {},
        }),
      );
      await expect(
        service.importFromJson(file, 'json', sw),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON ถูกต้อง -> create() ผ่าน flow เดียวกับฟอร์ม พร้อม createdBy จาก actor', async () => {
      config.create.mockResolvedValue(draftConfig);
      const file = makeMulterFile(
        JSON.stringify({
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: { APN1: 'internet' },
        }),
      );

      const result = await service.importFromJson(file, 'json', sw);

      expect(result).toEqual(draftConfig);
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

    it('race condition: row ถูกลบไปพอดีระหว่าง findOne กับ update (P2025) -> NotFoundException ไม่ใช่ 500', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockRejectedValue(makeP2025());

      await expect(
        service.update(draftConfig.id, { deviceModel: 'GT06L' }),
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

    it('race condition: row ถูกลบไปพอดีระหว่าง findOne กับ delete (P2025) -> NotFoundException ไม่ใช่ 500', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.delete.mockRejectedValue(makeP2025());

      await expect(service.remove(draftConfig.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
