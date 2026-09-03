import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConfigFieldDefinition,
  ConfigFieldDefinitionModelSupport,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigDefinitionService } from './config-definition.service';
import { CreateConfigDefinitionDto } from './dto/create-config-definition.dto';

const gt06nTcp: ConfigFieldDefinitionModelSupport = {
  id: 'sup-1',
  fieldDefinitionId: '11111111-1111-1111-1111-111111111111',
  deviceModel: 'GT06N',
  protocol: 'TCP',
};

const apnDef: ConfigFieldDefinition & {
  supportedModels: ConfigFieldDefinitionModelSupport[];
} = {
  id: '11111111-1111-1111-1111-111111111111',
  fieldName: 'APN1',
  dataType: 'string',
  allowedValues: [],
  required: true,
  unknownSpec: false,
  description: 'Access Point Name สำหรับเชื่อมต่อ GPRS/4G ของอุปกรณ์',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  supportedModels: [gt06nTcp],
};

const modeDef: ConfigFieldDefinition & {
  supportedModels: ConfigFieldDefinitionModelSupport[];
} = {
  id: '22222222-2222-2222-2222-222222222222',
  fieldName: 'MODE',
  dataType: 'string',
  allowedValues: ['GPRS', 'SMS'],
  required: false,
  unknownSpec: false,
  description: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  supportedModels: [
    {
      id: 'sup-2',
      fieldDefinitionId: '22222222-2222-2222-2222-222222222222',
      deviceModel: 'GT06N',
      protocol: 'TCP',
    },
  ],
};

function makeP2002(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('ConfigDefinitionService', () => {
  let service: ConfigDefinitionService;
  let findMany: jest.Mock;
  let create: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn();
    create = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigDefinitionService,
        {
          provide: PrismaService,
          useValue: { configFieldDefinition: { findMany, create } },
        },
      ],
    }).compile();

    service = module.get(ConfigDefinitionService);
  });

  describe('findAll', () => {
    it('คืน field definition ทั้งหมด พร้อม supportedModels เรียงตาม fieldName', async () => {
      findMany.mockResolvedValue([apnDef]);

      const result = await service.findAll();

      expect(result).toEqual([apnDef]);
      expect(findMany).toHaveBeenCalledWith({
        orderBy: { fieldName: 'asc' },
        include: { supportedModels: true },
      });
    });

    it('ตารางว่างเปล่า -> คืน []', async () => {
      findMany.mockResolvedValue([]);

      await expect(service.findAll()).resolves.toEqual([]);
    });
  });

  describe('create', () => {
    const dto: CreateConfigDefinitionDto = {
      fieldName: 'APN1',
      dataType: 'string',
      required: true,
      supportedModels: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
    };

    it('สร้าง field definition ใหม่พร้อม supportedModels ที่ระบุ', async () => {
      create.mockResolvedValue(apnDef);

      const result = await service.create(dto);

      expect(result).toEqual(apnDef);
      expect(create).toHaveBeenCalledWith({
        data: {
          fieldName: 'APN1',
          dataType: 'string',
          allowedValues: [],
          required: true,
          description: undefined,
          supportedModels: {
            create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
          },
        },
        include: { supportedModels: true },
      });
    });

    it('fieldName ซ้ำ (P2002) -> ConflictException', async () => {
      create.mockRejectedValue(makeP2002());

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('error อื่นที่ไม่ใช่ P2002 -> โยนต่อตรงๆ', async () => {
      create.mockRejectedValue(new Error('db down'));

      await expect(service.create(dto)).rejects.toThrow('db down');
    });
  });

  describe('validateFields', () => {
    it('ทุก field ตรงนิยามและครบ required -> ผ่าน ไม่ throw', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateFields('GT06N', 'TCP', { APN1: 'internet' }),
      ).resolves.toBeUndefined();
    });

    it('field ที่ไม่มีนิยามในคลังเลย -> BadRequestException', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateFields('GT06N', 'TCP', {
          APN1: 'internet',
          UNKNOWN_FIELD: 'x',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('field มีนิยามแต่ไม่รองรับ deviceModel/protocol นี้ -> BadRequestException', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateFields('GT06L', 'TCP', { APN1: 'internet' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ชนิดข้อมูลไม่ตรง dataType ที่ประกาศ -> BadRequestException', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateFields('GT06N', 'TCP', { APN1: 12345 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ค่าไม่อยู่ใน allowedValues -> BadRequestException', async () => {
      findMany.mockResolvedValue([modeDef]);

      await expect(
        service.validateFields('GT06N', 'TCP', { MODE: 'INVALID' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ค่าอยู่ใน allowedValues -> ผ่าน', async () => {
      findMany.mockResolvedValue([modeDef]);

      await expect(
        service.validateFields('GT06N', 'TCP', { MODE: 'GPRS' }),
      ).resolves.toBeUndefined();
    });

    it('ขาด field ที่บังคับกรอกสำหรับรุ่นนี้ -> BadRequestException', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(service.validateFields('GT06N', 'TCP', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('field บังคับกรอกแต่ไม่รองรับรุ่นนี้ -> ไม่นับว่าขาด (ไม่ถูก block ซ้ำ)', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateFields('OTHER_MODEL', 'TCP', {}),
      ).resolves.toBeUndefined();
    });

    it('มีหลาย error พร้อมกัน -> รวบรวมทุก error ไว้ใน exception เดียว ไม่หยุดที่จุดแรก', async () => {
      findMany.mockResolvedValue([apnDef, modeDef]);

      // ไม่ใช้ .rejects.toMatchObject({ response: { errors: expect.arrayContaining([...]) } })
      // ตรงๆ เพราะ expect.arrayContaining คืน type `any` เสมอ (ตาม @types/jest)
      // ทำให้ assign เข้า property ของ object literal โดน
      // @typescript-eslint/no-unsafe-assignment — จับ error เองแล้ว cast type
      // ของ response ให้ชัดเจนแทน
      let thrown: unknown;
      try {
        await service.validateFields('GT06N', 'TCP', {
          APN1: 999,
          MODE: 'INVALID',
          UNKNOWN: 'x',
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(BadRequestException);
      const response = (thrown as BadRequestException).getResponse() as {
        errors: string[];
      };
      expect(response.errors.some((e) => e.includes('APN1'))).toBe(true);
      expect(response.errors.some((e) => e.includes('MODE'))).toBe(true);
      expect(response.errors.some((e) => e.includes('UNKNOWN'))).toBe(true);
    });
  });
});
