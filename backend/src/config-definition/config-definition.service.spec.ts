import { Test, TestingModule } from '@nestjs/testing';
import { ConfigFieldDefinition } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigDefinitionService } from './config-definition.service';

const apnDef: ConfigFieldDefinition = {
  id: '11111111-1111-1111-1111-111111111111',
  fieldName: 'APN',
  dataType: 'string',
  allowedValues: [],
  required: true,
  unknownSpec: false,
  description: 'Access Point Name สำหรับเชื่อมต่อ GPRS/4G ของอุปกรณ์',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('ConfigDefinitionService', () => {
  let service: ConfigDefinitionService;
  let findMany: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigDefinitionService,
        {
          provide: PrismaService,
          useValue: { configFieldDefinition: { findMany } },
        },
      ],
    }).compile();

    service = module.get(ConfigDefinitionService);
  });

  describe('findAll', () => {
    it('คืน field definition ทั้งหมด เรียงตาม fieldName', async () => {
      findMany.mockResolvedValue([apnDef]);

      const result = await service.findAll();

      expect(result).toEqual([apnDef]);
      expect(findMany).toHaveBeenCalledWith({
        orderBy: { fieldName: 'asc' },
      });
    });

    it('ตารางว่างเปล่า -> คืน []', async () => {
      findMany.mockResolvedValue([]);

      await expect(service.findAll()).resolves.toEqual([]);
    });
  });
});
