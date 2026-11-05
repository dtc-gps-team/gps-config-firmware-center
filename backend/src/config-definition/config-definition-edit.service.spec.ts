import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigFieldDefinition } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { lockFieldsForUse } from './config-definition-lock';
import {
  ActingUser,
  ConfigDefinitionService,
} from './config-definition.service';
import { Prisma } from '@prisma/client';

const actor: ActingUser = { id: 'ce-1', role: 'ConfigEngineer' };

const def: ConfigFieldDefinition = {
  id: '11111111-1111-1111-1111-111111111111',
  fieldName: 'SPEED_LIMIT',
  dataType: 'integer',
  allowedValues: [],
  required: false,
  unknownSpec: false,
  description: null,
  unit: 'km/h',
  stOverridable: false,
  category: null,
  sensitive: false,
  restartRequired: false,
  defaultValue: null,
  minValue: 0,
  maxValue: 200,
  appliesToAllModels: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('ConfigDefinitionService แก้ไข/ลบ/usage', () => {
  let service: ConfigDefinitionService;
  let configFieldDefinition: {
    findUnique: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let support: { deleteMany: jest.Mock; createMany: jest.Mock };
  let auditLog: { create: jest.Mock };
  let queryRaw: jest.Mock;

  beforeEach(async () => {
    configFieldDefinition = {
      // update() เรียก findUnique พร้อม include: { supportedModels: true } ตั้งแต่
      // เพิ่ม appliesToAllModels (ต้องรู้จำนวนคู่เดิมไว้เช็ค cross-field กับ flag
      // นี้) — mock คืนให้มีอย่างน้อย 1 คู่ (def นี้สมมติว่ามีรุ่นผูกไว้แล้วจริง)
      // ไม่งั้น update() ที่ไม่ได้แตะ supportedModels/appliesToAllModels เลยจะ
      // โดน assertSupportedModelsOrAppliesToAll บล็อกผิดจุด
      findUnique: jest.fn().mockResolvedValue({
        ...def,
        supportedModels: [
          {
            id: 'sup-x',
            fieldDefinitionId: def.id,
            deviceModel: 'GT06N',
            protocol: 'TCP',
          },
        ],
      }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ ...def, supportedModels: [] }),
      update: jest.fn().mockResolvedValue(def),
      delete: jest.fn().mockResolvedValue(def),
    };
    support = {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };
    // $queryRaw ใช้ 3 งาน: ล็อกแถว (FOR UPDATE), นับ Config ที่ใช้ field, ดึงชื่อ Config ที่ใช้
    queryRaw = jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FOR UPDATE')) return Promise.resolve([{ id: def.id }]);
      if (sql.includes('count(*)')) return Promise.resolve([{ count: 0 }]);
      return Promise.resolve([]);
    });
    const prismaMock: Record<string, unknown> = {
      configFieldDefinition,
      configFieldDefinitionModelSupport: support,
      auditLog,
      $queryRaw: queryRaw,
    };
    prismaMock.$transaction = jest.fn((cb: (tx: unknown) => unknown) =>
      cb(prismaMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigDefinitionService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(ConfigDefinitionService);
  });

  describe('update', () => {
    it('แก้ metadata -> update เฉพาะ field ที่ส่ง + AuditLog update พร้อมชื่อ field (ไม่เก็บค่า)', async () => {
      await service.update(def.id, { unit: 'mph', category: 'GPS' }, actor);

      expect(configFieldDefinition.update).toHaveBeenCalledWith({
        where: { id: def.id },
        data: expect.objectContaining({
          unit: 'mph',
          category: 'GPS',
          dataType: undefined,
        }) as object,
      });
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: actor.id,
          auditModule: 'config-definition',
          action: 'update',
          ipAddress: null,
          metadata: { fieldNames: ['SPEED_LIMIT'] },
        },
      });
    });

    it('ส่ง null ล้างค่าที่ไม่บังคับได้ (เช่น minValue)', async () => {
      await service.update(def.id, { minValue: null }, actor);

      expect(configFieldDefinition.update).toHaveBeenCalledWith({
        where: { id: def.id },
        data: expect.objectContaining({ minValue: null }) as object,
      });
    });

    it('supportedModels ส่งมา -> แทนที่ทั้งชุด (ลบเดิมแล้วสร้างใหม่)', async () => {
      await service.update(
        def.id,
        { supportedModels: [{ deviceModel: 'GT06N', protocol: 'TCP' }] },
        actor,
      );

      expect(support.deleteMany).toHaveBeenCalledWith({
        where: { fieldDefinitionId: def.id },
      });
      expect(support.createMany).toHaveBeenCalledWith({
        data: [
          {
            fieldDefinitionId: def.id,
            deviceModel: 'GT06N',
            protocol: 'TCP',
          },
        ],
        skipDuplicates: true,
      });
    });

    // ฟีดแบ็ก 2026-11-04: ล้าง supportedModels ทั้งชุดโดยไม่เปิด
    // appliesToAllModels ต้องโดนบล็อก (field จะไม่ validate อะไรได้เลย)
    it('ส่ง supportedModels: [] โดยไม่เปิด appliesToAllModels -> 400', async () => {
      await expect(
        service.update(def.id, { supportedModels: [] }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(configFieldDefinition.update).not.toHaveBeenCalled();
    });

    it('ส่ง supportedModels: [] พร้อม appliesToAllModels: true -> ผ่าน', async () => {
      await service.update(
        def.id,
        { supportedModels: [], appliesToAllModels: true },
        actor,
      );
      expect(configFieldDefinition.update).toHaveBeenCalledWith({
        where: { id: def.id },
        data: expect.objectContaining({ appliesToAllModels: true }) as object,
      });
    });

    it('ไม่ส่ง field ใดเลย -> 400', async () => {
      await expect(service.update(def.id, {}, actor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('ไม่พบ -> 404', async () => {
      configFieldDefinition.findUnique.mockResolvedValue(null);
      await expect(
        service.update(def.id, { unit: 'x' }, actor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('เปลี่ยนเป็น dataType ที่ไม่ใช่ตัวเลขทั้งที่ยังมี min/max -> 400 (ตรวจบนค่าหลังแก้)', async () => {
      await expect(
        service.update(def.id, { dataType: 'string' }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(configFieldDefinition.update).not.toHaveBeenCalled();
    });

    it('min มากกว่า max -> 400', async () => {
      await expect(
        service.update(def.id, { minValue: 500 }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ตั้ง sensitive ทั้งที่มี defaultValue -> 400', async () => {
      configFieldDefinition.findUnique.mockResolvedValue({
        ...def,
        dataType: 'string',
        minValue: null,
        maxValue: null,
        defaultValue: 'abc',
      });
      await expect(
        service.update(def.id, { sensitive: true }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remove', () => {
    it('ไม่มี Config ใช้ -> ล็อกแถว (FOR UPDATE) -> ตรวจซ้ำ -> ลบ + AuditLog delete ตามลำดับ', async () => {
      const order: string[] = [];
      queryRaw.mockImplementation((strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        if (sql.includes('FOR UPDATE')) {
          order.push('lock');
          return Promise.resolve([{ id: def.id }]);
        }
        if (sql.includes('count(*)')) {
          order.push('check-usage');
          return Promise.resolve([{ count: 0 }]);
        }
        return Promise.resolve([]);
      });
      configFieldDefinition.delete.mockImplementation(() => {
        order.push('delete');
        return Promise.resolve(def);
      });

      await service.remove(def.id, actor);

      expect(order).toEqual(['lock', 'check-usage', 'delete']);
      expect(auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'delete',
          metadata: { fieldNames: ['SPEED_LIMIT'] },
        }) as object,
      });
    });

    it('มี Config ใช้อยู่ -> 409 บอกจำนวนและชื่อ ไม่ลบ', async () => {
      queryRaw.mockImplementation((strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        if (sql.includes('FOR UPDATE'))
          return Promise.resolve([{ id: def.id }]);
        if (sql.includes('count(*)')) return Promise.resolve([{ count: 2 }]);
        return Promise.resolve([
          { id: 'c1', name: 'Config A' },
          { id: 'c2', name: 'Config B' },
        ]);
      });

      await expect(service.remove(def.id, actor)).rejects.toThrow(
        /ใช้อยู่ 2 ตัว \(Config A, Config B\)/,
      );
      await expect(service.remove(def.id, actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(configFieldDefinition.delete).not.toHaveBeenCalled();
    });

    it('แถวหายระหว่างรอล็อก -> 404', async () => {
      queryRaw.mockResolvedValue([]);
      await expect(service.remove(def.id, actor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(configFieldDefinition.delete).not.toHaveBeenCalled();
    });
  });

  describe('getUsage', () => {
    it('คืนจำนวนและตัวอย่างชื่อ Config ที่ใช้ field นี้', async () => {
      queryRaw.mockImplementation((strings: TemplateStringsArray) =>
        Promise.resolve(
          strings.join('?').includes('count(*)')
            ? [{ count: 7 }]
            : [{ id: 'c1', name: 'Config A' }],
        ),
      );

      await expect(service.getUsage(def.id)).resolves.toEqual({
        count: 7,
        configs: [{ id: 'c1', name: 'Config A' }],
      });
    });

    it('ไม่พบ field -> 404', async () => {
      configFieldDefinition.findUnique.mockResolvedValue(null);
      await expect(service.getUsage(def.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

describe('lockFieldsForUse (ฝั่งสร้าง/แก้ Config - FOR SHARE)', () => {
  const txWith = (queryRaw: jest.Mock) =>
    ({ $queryRaw: queryRaw }) as unknown as Prisma.TransactionClient;

  it('ทุก field ยังอยู่ในคลัง -> ผ่าน และล็อกแบบ FOR SHARE', async () => {
    const queryRaw = jest.fn((_s: TemplateStringsArray, names: string[]) =>
      Promise.resolve(names.map((fieldName) => ({ fieldName }))),
    );

    await expect(
      lockFieldsForUse(txWith(queryRaw), ['A', 'B']),
    ).resolves.toBeUndefined();
    const calls = queryRaw.mock.calls as unknown as [TemplateStringsArray][];
    expect(calls[0][0].join('?')).toContain('FOR SHARE');
  });

  it('field ถูกลบไปแล้ว -> 409 บอกชื่อที่หาย', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ fieldName: 'A' }]);

    await expect(
      lockFieldsForUse(txWith(queryRaw), ['A', 'B']),
    ).rejects.toThrow(/B/);
    await expect(
      lockFieldsForUse(txWith(queryRaw), ['A', 'B']),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('Config ที่ไม่มี field เลย -> ไม่ query', async () => {
    const queryRaw = jest.fn();
    await lockFieldsForUse(txWith(queryRaw), []);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
