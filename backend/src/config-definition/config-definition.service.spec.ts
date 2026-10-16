import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConfigFieldDefinition,
  ConfigFieldDefinitionModelSupport,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActingUser,
  ConfigDefinitionService,
} from './config-definition.service';
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
  unit: null,
  stOverridable: true,
  category: 'Network',
  sensitive: false,
  restartRequired: true,
  defaultValue: null,
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
  unit: null,
  stOverridable: false,
  category: null,
  sensitive: false,
  restartRequired: false,
  defaultValue: null,
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

const actor: ActingUser = {
  id: 'admin-1',
  role: 'Admin',
  ipAddress: '10.0.0.7',
};

describe('ConfigDefinitionService', () => {
  let service: ConfigDefinitionService;
  let findMany: jest.Mock;
  let create: jest.Mock;
  let auditCreate: jest.Mock;
  let transaction: jest.Mock;

  const createDefinition = (dto: CreateConfigDefinitionDto) =>
    service.create(dto, actor);

  beforeEach(async () => {
    findMany = jest.fn();
    create = jest.fn();
    auditCreate = jest.fn().mockResolvedValue({});
    // $transaction แบบ interactive — tx client มี configFieldDefinition + auditLog
    const tx = {
      configFieldDefinition: { create },
      auditLog: { create: auditCreate },
    };
    transaction = jest.fn((cb: (client: typeof tx) => unknown) => cb(tx));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigDefinitionService,
        {
          provide: PrismaService,
          useValue: {
            configFieldDefinition: { findMany, create },
            $transaction: transaction,
          },
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

    it('เขียน AuditLog ใน tx เดียวกับการสร้าง พร้อม IP และชื่อ field (ไม่เก็บค่า)', async () => {
      create.mockResolvedValue(apnDef);

      await createDefinition({ ...dto, defaultValue: 'internet' });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(auditCreate).toHaveBeenCalledWith({
        data: {
          userId: 'admin-1',
          auditModule: 'config-definition',
          action: 'create',
          ipAddress: '10.0.0.7',
          metadata: { fieldNames: [apnDef.fieldName] },
        },
      });
    });

    it('เขียน AuditLog ไม่สำเร็จ -> การสร้างล้มตามไปด้วย (ไม่ใช่ never-throw)', async () => {
      create.mockResolvedValue(apnDef);
      auditCreate.mockRejectedValue(new Error('audit down'));

      await expect(createDefinition(dto)).rejects.toThrow('audit down');
    });

    it('ชื่อซ้ำ (P2002) -> ConflictException และไม่เขียน AuditLog', async () => {
      create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(createDefinition(dto)).rejects.toThrow(ConflictException);
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it('validate ไม่ผ่านก่อนสร้าง -> ไม่เปิดทรานแซกชันและไม่เขียน AuditLog', async () => {
      await expect(
        createDefinition({ ...dto, sensitive: true, defaultValue: 'secret' }),
      ).rejects.toThrow(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it('สร้าง field definition ใหม่พร้อม supportedModels ที่ระบุ', async () => {
      create.mockResolvedValue(apnDef);

      const result = await createDefinition(dto);

      expect(result).toEqual(apnDef);
      expect(create).toHaveBeenCalledWith({
        data: {
          fieldName: 'APN1',
          dataType: 'string',
          allowedValues: [],
          required: true,
          unknownSpec: false,
          description: undefined,
          unit: undefined,
          stOverridable: false,
          category: undefined,
          sensitive: false,
          restartRequired: false,
          defaultValue: undefined,
          supportedModels: {
            create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
          },
        },
        include: { supportedModels: true },
      });
    });

    it('ส่ง description + unit มา -> เขียนลง DB ตามนั้น', async () => {
      create.mockResolvedValue(apnDef);

      await createDefinition({
        ...dto,
        description: 'ช่วงเวลารายงาน',
        unit: 'วินาที',
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          fieldName: 'APN1',
          dataType: 'string',
          allowedValues: [],
          required: true,
          unknownSpec: false,
          description: 'ช่วงเวลารายงาน',
          unit: 'วินาที',
          stOverridable: false,
          category: undefined,
          sensitive: false,
          restartRequired: false,
          defaultValue: undefined,
          supportedModels: {
            create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
          },
        },
        include: { supportedModels: true },
      });
    });

    it('ส่ง unknownSpec: true มา -> เขียนลง DB ตามนั้น (ไม่ default เป็น false)', async () => {
      create.mockResolvedValue(apnDef);

      await createDefinition({ ...dto, unknownSpec: true });

      expect(create).toHaveBeenCalledWith({
        data: {
          fieldName: 'APN1',
          dataType: 'string',
          allowedValues: [],
          required: true,
          unknownSpec: true,
          description: undefined,
          unit: undefined,
          stOverridable: false,
          category: undefined,
          sensitive: false,
          restartRequired: false,
          defaultValue: undefined,
          supportedModels: {
            create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
          },
        },
        include: { supportedModels: true },
      });
    });

    it('ส่ง stOverridable: true มา -> เขียนลง DB ตามนั้น', async () => {
      create.mockResolvedValue(apnDef);

      await createDefinition({ ...dto, stOverridable: true });

      expect(create).toHaveBeenCalledWith({
        data: {
          fieldName: 'APN1',
          dataType: 'string',
          allowedValues: [],
          required: true,
          unknownSpec: false,
          description: undefined,
          unit: undefined,
          stOverridable: true,
          category: undefined,
          sensitive: false,
          restartRequired: false,
          defaultValue: undefined,
          supportedModels: {
            create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
          },
        },
        include: { supportedModels: true },
      });
    });

    it('ส่ง category/sensitive/restartRequired มา -> เขียนลง DB ตามนั้น', async () => {
      create.mockResolvedValue(apnDef);

      await createDefinition({
        ...dto,
        category: 'Network',
        sensitive: true,
        restartRequired: true,
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          fieldName: 'APN1',
          dataType: 'string',
          allowedValues: [],
          required: true,
          unknownSpec: false,
          description: undefined,
          unit: undefined,
          stOverridable: false,
          category: 'Network',
          sensitive: true,
          restartRequired: true,
          defaultValue: undefined,
          supportedModels: {
            create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
          },
        },
        include: { supportedModels: true },
      });
    });

    it('ส่ง defaultValue มา -> เขียนลง DB ตามนั้น (issue #202)', async () => {
      create.mockResolvedValue(apnDef);

      await createDefinition({ ...dto, defaultValue: 'internet' });

      expect(create).toHaveBeenCalledWith({
        data: {
          fieldName: 'APN1',
          dataType: 'string',
          allowedValues: [],
          required: true,
          unknownSpec: false,
          description: undefined,
          unit: undefined,
          stOverridable: false,
          category: undefined,
          sensitive: false,
          restartRequired: false,
          defaultValue: 'internet',
          supportedModels: {
            create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
          },
        },
        include: { supportedModels: true },
      });
    });

    it('ไม่ส่ง defaultValue มา -> ยังสร้างได้ตามปกติ (undefined, ไม่ error)', async () => {
      create.mockResolvedValue(apnDef);

      await createDefinition(dto);

      expect(create).toHaveBeenCalledWith({
        data: {
          fieldName: 'APN1',
          dataType: 'string',
          allowedValues: [],
          required: true,
          unknownSpec: false,
          description: undefined,
          unit: undefined,
          stOverridable: false,
          category: undefined,
          sensitive: false,
          restartRequired: false,
          defaultValue: undefined,
          supportedModels: {
            create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
          },
        },
        include: { supportedModels: true },
      });
    });

    it('sensitive: true + defaultValue มีค่า -> BadRequestException กันค่ารั่วผ่าน GET /config-definitions', async () => {
      await expect(
        createDefinition({
          ...dto,
          sensitive: true,
          defaultValue: 'super-secret-password',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(create).not.toHaveBeenCalled();
    });

    it('sensitive: true + ไม่ส่ง defaultValue มา -> ผ่านปกติ', async () => {
      create.mockResolvedValue(apnDef);

      await createDefinition({ ...dto, sensitive: true });

      expect(create).toHaveBeenCalledWith({
        data: {
          fieldName: 'APN1',
          dataType: 'string',
          allowedValues: [],
          required: true,
          unknownSpec: false,
          description: undefined,
          unit: undefined,
          stOverridable: false,
          category: undefined,
          sensitive: true,
          restartRequired: false,
          defaultValue: undefined,
          supportedModels: {
            create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
          },
        },
        include: { supportedModels: true },
      });
    });

    it('sensitive: true + defaultValue เป็น "" (ว่างเปล่า) -> ผ่านปกติ (ไม่ถือว่ามีค่า)', async () => {
      create.mockResolvedValue(apnDef);

      await createDefinition({ ...dto, sensitive: true, defaultValue: '' });

      expect(create).toHaveBeenCalledWith({
        data: {
          fieldName: 'APN1',
          dataType: 'string',
          allowedValues: [],
          required: true,
          unknownSpec: false,
          description: undefined,
          unit: undefined,
          stOverridable: false,
          category: undefined,
          sensitive: true,
          restartRequired: false,
          defaultValue: '',
          supportedModels: {
            create: [{ deviceModel: 'GT06N', protocol: 'TCP' }],
          },
        },
        include: { supportedModels: true },
      });
    });

    it.each([
      ['integer', '42'],
      ['decimal', '3.14'],
      ['boolean', 'true'],
      ['boolean', 'false'],
      ['date', '2026-10-05'],
      ['datetime', '2026-10-05T12:00:00Z'],
      ['json', '{"a":1}'],
      ['array', '[1,2,3]'],
      ['uuid', '11111111-1111-1111-1111-111111111111'],
    ])(
      'defaultValue ตรงกับ dataType %s (%s) -> ผ่านปกติ',
      async (dataType, defaultValue) => {
        create.mockResolvedValue(apnDef);

        await expect(
          createDefinition({ ...dto, dataType, defaultValue }),
        ).resolves.toEqual(apnDef);
      },
    );

    it.each([
      ['integer', '3.14'],
      ['integer', 'abc'],
      ['decimal', 'abc'],
      ['boolean', 'yes'],
      ['date', '2026-13-99'],
      ['date', '05/10/2026'],
      ['datetime', '2026-10-05'],
      ['json', '[1,2,3]'],
      ['json', 'not-json'],
      ['array', '{"a":1}'],
      ['uuid', 'not-a-uuid'],
      // แก้ตามรีวิว B บน PR #255 ข้อ 4 — edge case ที่ Number() native แปลงให้
      // "ดูเหมือน" ผ่านได้ทั้งที่ไม่ควร
      ['integer', ''],
      ['decimal', ''],
      ['integer', '0x10'],
      ['decimal', '0x10'],
      ['integer', 'Infinity'],
      ['decimal', 'Infinity'],
      ['integer', 'NaN'],
      ['decimal', '1e10'],
      // แก้ตามรีวิว B บน PR #255 ข้อ 4 — วันที่ไม่มีจริงบนปฏิทินที่
      // Date.parse() เคย rollover ให้แบบเงียบๆ
      ['date', '2026-02-31'],
      ['datetime', '2026-02-31T12:00:00Z'],
      ['datetime', '2026-10-05T25:00:00Z'],
      ['datetime', '2026-10-05T12:60:00Z'],
    ])(
      'defaultValue "%s" ไม่ตรงกับ dataType %s -> BadRequestException',
      async (dataType, defaultValue) => {
        await expect(
          createDefinition({ ...dto, dataType, defaultValue }),
        ).rejects.toThrow(BadRequestException);

        expect(create).not.toHaveBeenCalled();
      },
    );

    it('fieldName ซ้ำ (P2002) -> ConflictException', async () => {
      create.mockRejectedValue(makeP2002());

      await expect(createDefinition(dto)).rejects.toThrow(ConflictException);
    });

    it('error อื่นที่ไม่ใช่ P2002 -> โยนต่อตรงๆ', async () => {
      create.mockRejectedValue(new Error('db down'));

      await expect(createDefinition(dto)).rejects.toThrow('db down');
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

    // รีวิวพี่เลี้ยง 12 ต.ค. 2569: ผู้สร้าง template เพิ่มพารามิเตอร์นอกชุด
    // ของรุ่นได้ (เดิมเคสนี้ถูก block)
    it('field มีนิยามแต่ไม่ได้ผูกกับ deviceModel/protocol นี้ -> ผ่าน', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateFields('GT06L', 'TCP', { APN1: 'internet' }),
      ).resolves.toBeUndefined();
    });

    it('field นอกชุดของรุ่น ยังตรวจชนิดข้อมูลตามนิยาม -> BadRequestException ถ้าผิดชนิด', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateFields('GT06L', 'TCP', { APN1: 12345 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('field นอกชุดของรุ่น ยังตรวจ allowedValues -> BadRequestException ถ้าไม่อยู่ในรายการ', async () => {
      findMany.mockResolvedValue([modeDef]);

      await expect(
        service.validateFields('GT06L', 'TCP', { MODE: 'INVALID' }),
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

  describe('matchesDataType — ชุด dataType ใหม่ (#201)', () => {
    function defOf(dataType: string): typeof apnDef {
      return { ...apnDef, fieldName: 'FIELD', dataType, allowedValues: [] };
    }

    it.each([
      ['integer', 42],
      ['decimal', 3.14],
      ['decimal', 42],
      ['string', 'hello'],
      ['text', 'hello'],
      ['boolean', true],
      ['boolean', false],
      ['date', '2026-10-05'],
      ['datetime', '2026-10-05T12:00:00Z'],
      ['json', { a: 1 }],
      ['array', [1, 2, 3]],
      ['uuid', '11111111-1111-1111-1111-111111111111'],
    ])('ค่าตรงกับ dataType %s -> ผ่าน', async (dataType, value) => {
      findMany.mockResolvedValue([defOf(dataType)]);

      await expect(
        service.validateFields('GT06N', 'TCP', { FIELD: value }),
      ).resolves.toBeUndefined();
    });

    it.each([
      ['integer', 3.14],
      ['integer', '42'],
      ['decimal', '3.14'],
      ['boolean', 'true'],
      ['date', '2026-10-05T12:00:00Z'],
      ['date', 'not-a-date'],
      ['datetime', '2026-10-05'],
      ['json', [1, 2, 3]],
      ['json', 'x'],
      ['array', { a: 1 }],
      ['uuid', 'not-a-uuid'],
      // แก้ตามรีวิว B บน PR #255 ข้อ 4 — decimal ต้อง Number.isFinite จริง
      // (NaN/Infinity ก็ typeof === 'number' เหมือนกัน แต่ไม่ใช่ค่าที่ valid)
      ['decimal', Infinity],
      ['decimal', -Infinity],
      ['decimal', NaN],
      // วันที่ไม่มีจริงบนปฏิทิน (rollover) และเวลาเกินช่วงที่ valid
      ['date', '2026-02-31'],
      ['datetime', '2026-10-05T25:00:00Z'],
    ])(
      'ค่าไม่ตรงกับ dataType %s -> BadRequestException',
      async (dataType, value) => {
        findMany.mockResolvedValue([defOf(dataType)]);

        await expect(
          service.validateFields('GT06N', 'TCP', { FIELD: value }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    describe('legacy "number" (แก้ตามรีวิว B บน PR #255 ข้อ 3)', () => {
      it('ยังเหลือ field เดิมที่เป็น dataType "number" (ยังไม่ backfill) + ค่าเป็นตัวเลขจริง -> ผ่าน', async () => {
        findMany.mockResolvedValue([defOf('number')]);

        await expect(
          service.validateFields('GT06N', 'TCP', { FIELD: 909 }),
        ).resolves.toBeUndefined();
      });

      it('field "number" เดิม + ค่าเป็น string (เช่น seed data เก่าที่ผิดพลาด) -> BadRequestException ไม่ใช่ปล่อยผ่านเงียบๆ', async () => {
        findMany.mockResolvedValue([defOf('number')]);

        await expect(
          service.validateFields('GT06N', 'TCP', { FIELD: '909' }),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });

  describe('validateOverridableFields', () => {
    it('field stOverridable: true + ตรงนิยาม -> ผ่าน ไม่ throw', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateOverridableFields('GT06N', 'TCP', {
          APN1: 'internet2',
        }),
      ).resolves.toBeUndefined();
    });

    it('field stOverridable: false -> BadRequestException แม้นิยามถูกต้องทุกอย่าง', async () => {
      findMany.mockResolvedValue([modeDef]);

      await expect(
        service.validateOverridableFields('GT06N', 'TCP', { MODE: 'GPRS' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ไม่เช็ค required field ที่ขาด — partial update ปกติของ override', async () => {
      findMany.mockResolvedValue([apnDef]);

      // apnDef.required = true แต่ไม่ส่งมาใน fields เลย — validateFields()
      // ปกติจะ throw แต่ validateOverridableFields ต้องไม่ throw เพราะเป็น
      // partial update (override field อื่นที่ไม่ใช่ APN1)
      await expect(
        service.validateOverridableFields('GT06N', 'TCP', {}),
      ).resolves.toBeUndefined();
    });

    it('field ที่ไม่มีนิยามในคลังเลย -> BadRequestException', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateOverridableFields('GT06N', 'TCP', {
          UNKNOWN_FIELD: 'x',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ชนิดข้อมูลไม่ตรง dataType ที่ประกาศ -> BadRequestException', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateOverridableFields('GT06N', 'TCP', { APN1: 12345 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('field ไม่รองรับรุ่นนี้และไม่อยู่ใน template -> BadRequestException (ช่างเพิ่ม field นอกชุดเองไม่ได้)', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateOverridableFields('GT06L', 'TCP', { APN1: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('field ไม่รองรับรุ่นนี้แต่อยู่ใน template แล้ว -> ผ่าน (ผู้สร้าง template เพิ่มไว้)', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateOverridableFields('GT06L', 'TCP', { APN1: 'x' }, [
          'APN1',
        ]),
      ).resolves.toBeUndefined();
    });

    it('field อยู่ใน template แต่ stOverridable: false -> ยัง BadRequestException', async () => {
      findMany.mockResolvedValue([modeDef]);

      await expect(
        service.validateOverridableFields('GT06L', 'TCP', { MODE: 'GPRS' }, [
          'MODE',
        ]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateOperationOverridableFields (ค่าเฉพาะเครื่องตอนสร้าง Rollout)', () => {
    it('field รองรับรุ่นนี้ + ชนิดถูก -> ไม่มี error', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateOperationOverridableFields('GT06N', 'TCP', {
          APN1: 'internet',
        }),
      ).resolves.toEqual([]);
    });

    it('field ไม่รองรับรุ่นนี้และไม่อยู่ใน template -> error ไม่รองรับโมเดล', async () => {
      findMany.mockResolvedValue([apnDef]);

      const errors = await service.validateOperationOverridableFields(
        'GT06L',
        'TCP',
        { APN1: 'x' },
      );

      expect(errors).toEqual(['field "APN1" ไม่รองรับโมเดล GT06L/TCP']);
    });

    it('field ไม่รองรับรุ่นนี้แต่อยู่ใน template ของ Config -> ผ่าน (กฎเดียวกับช่าง)', async () => {
      findMany.mockResolvedValue([apnDef]);

      await expect(
        service.validateOperationOverridableFields(
          'GT06L',
          'TCP',
          { APN1: 'x' },
          ['APN1'],
        ),
      ).resolves.toEqual([]);
    });

    it('field อยู่ใน template แต่ชนิดข้อมูลผิด -> ยัง error', async () => {
      findMany.mockResolvedValue([apnDef]);

      const errors = await service.validateOperationOverridableFields(
        'GT06L',
        'TCP',
        { APN1: 12345 },
        ['APN1'],
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('ชนิดข้อมูล');
    });

    it('field ที่ไม่มีนิยามในคลัง -> error แม้อยู่ใน template', async () => {
      findMany.mockResolvedValue([apnDef]);

      const errors = await service.validateOperationOverridableFields(
        'GT06N',
        'TCP',
        { GHOST: 1 },
        ['GHOST'],
      );

      expect(errors[0]).toContain('ไม่รู้จัก field "GHOST"');
    });

    it('ไม่เช็ค stOverridable (Operation แก้ field ที่ช่างแก้ไม่ได้)', async () => {
      findMany.mockResolvedValue([modeDef]);

      await expect(
        service.validateOperationOverridableFields('GT06N', 'TCP', {
          MODE: 'GPRS',
        }),
      ).resolves.toEqual([]);
    });
  });
});
