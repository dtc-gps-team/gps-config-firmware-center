import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { ConfigDefinitionService } from '../config-definition/config-definition.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser, ConfigService } from './config.service';
import { DEVICE_SIMULATOR, DeviceSimulator } from './device-simulator';

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
const approvedConfig: Config = { ...draftConfig, status: 'approved' };
const syncedConfig: Config = { ...draftConfig, status: 'synced' };

const sw: ActingUser = { id: 'sw-1', role: 'SW' };

/** จำลอง Prisma error P2025 ("Record to update/delete not found") ให้ตรงกับ
 * shape จริงของ PrismaClientKnownRequestError (ต้องมี code + clientVersion) */
function makeP2025(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('Record to update not found.', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

function makeMulterFile(
  content: string,
  filename = 'config.json',
): Express.Multer.File {
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
  let deviceSimulator: jest.Mocked<DeviceSimulator>;
  let configDefinitionService: { validateFields: jest.Mock };

  beforeEach(async () => {
    config = {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    deviceSimulator = { simulateConfig: jest.fn() };
    // default: ผ่าน validate เสมอ (test เดิมทั้งหมดไม่เกี่ยวกับ Semantic
    // Validation) — describe('create'/'update') ด้านล่างจะ override เฉพาะ
    // test ที่ต้องเช็ค wiring/behavior ตอน validateFields โยน exception
    configDefinitionService = {
      validateFields: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigService,
        { provide: PrismaService, useValue: { config } },
        { provide: DEVICE_SIMULATOR, useValue: deviceSimulator },
        {
          provide: ConfigDefinitionService,
          useValue: configDefinitionService,
        },
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

    it('เรียก validateFields ด้วย deviceModel/protocol/fields จาก dto ก่อนเขียนลง DB', async () => {
      config.create.mockResolvedValue(draftConfig);

      await service.create(
        { deviceModel: 'GT06N', protocol: 'TCP', fields: { APN1: 'internet' } },
        sw,
      );

      expect(configDefinitionService.validateFields).toHaveBeenCalledWith(
        'GT06N',
        'TCP',
        { APN1: 'internet' },
      );
    });

    it('validateFields โยน exception -> ไม่เรียก prisma.config.create เลย (ไม่บันทึกค่าที่ไม่ผ่าน)', async () => {
      configDefinitionService.validateFields.mockRejectedValue(
        new BadRequestException('ค่าที่กรอกไม่ตรงกับ Config Definition'),
      );

      await expect(
        service.create(
          { deviceModel: 'GT06N', protocol: 'TCP', fields: { APN1: 'xxx' } },
          sw,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
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
      await expect(service.importFromJson(file, 'csv', sw)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.importFromJson(file, undefined, sw)).rejects.toThrow(
        BadRequestException,
      );
      expect(config.create).not.toHaveBeenCalled();
    });

    it('ไฟล์ parse เป็น JSON ไม่ได้ -> BadRequestException', async () => {
      const file = makeMulterFile('{ not valid json');
      await expect(service.importFromJson(file, 'json', sw)).rejects.toThrow(
        BadRequestException,
      );
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON เป็น null (valid JSON แต่ไม่ใช่ object) -> BadRequestException ไม่ใช่ TypeError', async () => {
      const file = makeMulterFile('null');
      await expect(service.importFromJson(file, 'json', sw)).rejects.toThrow(
        BadRequestException,
      );
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON เป็น array -> BadRequestException', async () => {
      const file = makeMulterFile(
        JSON.stringify([{ deviceModel: 'GT06N', protocol: 'TCP', fields: {} }]),
      );
      await expect(service.importFromJson(file, 'json', sw)).rejects.toThrow(
        BadRequestException,
      );
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
      await expect(service.importFromJson(file, 'json', sw)).rejects.toThrow(
        BadRequestException,
      );
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
      await expect(service.importFromJson(file, 'json', sw)).rejects.toThrow(
        BadRequestException,
      );
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

  describe('simulate', () => {
    it('status draft -> เรียก deviceSimulator.simulateConfig ด้วย deviceModel/protocol/fields จาก DB (ไม่ใช่จาก client)', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      deviceSimulator.simulateConfig.mockResolvedValue({
        passed: true,
        details: ['ผ่านหมด'],
      });

      const result = await service.simulate(draftConfig.id);

      expect(result).toEqual({ passed: true, details: ['ผ่านหมด'] });
      expect(deviceSimulator.simulateConfig).toHaveBeenCalledWith({
        deviceModel: draftConfig.deviceModel,
        protocol: draftConfig.protocol,
        fields: draftConfig.fields,
      });
    });

    it('status testing -> ยังทดสอบซ้ำได้ (ไม่ถูกบล็อก)', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      deviceSimulator.simulateConfig.mockResolvedValue({
        passed: false,
        details: ['APN1 ไม่ถูกต้อง'],
      });

      await expect(service.simulate(testingConfig.id)).resolves.toEqual({
        passed: false,
        details: ['APN1 ไม่ถูกต้อง'],
      });
    });

    it('status approved -> ConflictException ไม่เรียก simulator เลย', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);

      await expect(service.simulate(approvedConfig.id)).rejects.toThrow(
        ConflictException,
      );
      expect(deviceSimulator.simulateConfig).not.toHaveBeenCalled();
    });

    it('status synced -> ConflictException ไม่เรียก simulator เลย', async () => {
      config.findUnique.mockResolvedValue(syncedConfig);

      await expect(service.simulate(syncedConfig.id)).rejects.toThrow(
        ConflictException,
      );
      expect(deviceSimulator.simulateConfig).not.toHaveBeenCalled();
    });

    it('ไม่เจอ config เลย -> NotFoundException', async () => {
      config.findUnique.mockResolvedValue(null);

      await expect(service.simulate('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(deviceSimulator.simulateConfig).not.toHaveBeenCalled();
    });
  });

  describe('decide', () => {
    it('status draft, passed:true -> update สถานะเป็น testing', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockResolvedValue(testingConfig);

      const result = await service.decide(draftConfig.id, true);

      expect(result).toEqual(testingConfig);
      expect(config.update).toHaveBeenCalledWith({
        where: { id: draftConfig.id },
        data: { status: 'testing' },
      });
    });

    it('status draft, passed:false -> ไม่ยิง update ลง DB เลย คืน config เดิม (ยังเป็น draft)', async () => {
      config.findUnique.mockResolvedValue(draftConfig);

      const result = await service.decide(draftConfig.id, false);

      expect(result).toEqual(draftConfig);
      expect(config.update).not.toHaveBeenCalled();
    });

    it('status testing (ส่งต่อ Operation ไปแล้ว) -> ConflictException ไม่ว่า passed จะเป็นอะไร', async () => {
      config.findUnique.mockResolvedValue(testingConfig);

      await expect(service.decide(testingConfig.id, true)).rejects.toThrow(
        ConflictException,
      );
      expect(config.update).not.toHaveBeenCalled();
    });

    it('status approved -> ConflictException', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);

      await expect(service.decide(approvedConfig.id, true)).rejects.toThrow(
        ConflictException,
      );
      expect(config.update).not.toHaveBeenCalled();
    });

    it('ไม่เจอ config เลย -> NotFoundException', async () => {
      config.findUnique.mockResolvedValue(null);

      await expect(service.decide('missing-id', true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('race condition: row ถูกลบไปพอดีระหว่าง findOne กับ update (P2025) -> NotFoundException ไม่ใช่ 500', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockRejectedValue(makeP2025());

      await expect(service.decide(draftConfig.id, true)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('approve', () => {
    it('status testing -> update สถานะเป็น approved', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockResolvedValue(approvedConfig);

      const result = await service.approve(testingConfig.id);

      expect(result).toEqual(approvedConfig);
      expect(config.update).toHaveBeenCalledWith({
        where: { id: testingConfig.id },
        data: { status: 'approved' },
      });
    });

    it('status draft (ยังไม่ผ่าน decide ของ SW) -> ConflictException', async () => {
      config.findUnique.mockResolvedValue(draftConfig);

      await expect(service.approve(draftConfig.id)).rejects.toThrow(
        ConflictException,
      );
      expect(config.update).not.toHaveBeenCalled();
    });

    it('status approved อยู่แล้ว -> ConflictException (กันกดซ้ำ)', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);

      await expect(service.approve(approvedConfig.id)).rejects.toThrow(
        ConflictException,
      );
      expect(config.update).not.toHaveBeenCalled();
    });

    it('ไม่เจอ config เลย -> NotFoundException', async () => {
      config.findUnique.mockResolvedValue(null);

      await expect(service.approve('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('race condition (P2025) -> NotFoundException ไม่ใช่ 500', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockRejectedValue(makeP2025());

      await expect(service.approve(testingConfig.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reject', () => {
    it('status testing -> update สถานะย้อนกลับเป็น draft', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockResolvedValue(draftConfig);

      const result = await service.reject(testingConfig.id);

      expect(result).toEqual(draftConfig);
      expect(config.update).toHaveBeenCalledWith({
        where: { id: testingConfig.id },
        data: { status: 'draft' },
      });
    });

    it('status draft (ยังไม่เคยส่งต่อ Operation) -> ConflictException', async () => {
      config.findUnique.mockResolvedValue(draftConfig);

      await expect(service.reject(draftConfig.id)).rejects.toThrow(
        ConflictException,
      );
      expect(config.update).not.toHaveBeenCalled();
    });

    it('status approved ไปแล้ว -> ConflictException', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);

      await expect(service.reject(approvedConfig.id)).rejects.toThrow(
        ConflictException,
      );
      expect(config.update).not.toHaveBeenCalled();
    });

    it('ไม่เจอ config เลย -> NotFoundException', async () => {
      config.findUnique.mockResolvedValue(null);

      await expect(service.reject('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('race condition (P2025) -> NotFoundException ไม่ใช่ 500', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockRejectedValue(makeP2025());

      await expect(service.reject(testingConfig.id)).rejects.toThrow(
        NotFoundException,
      );
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

    it('ส่งแค่ fields ใหม่มา -> validateFields ใช้ deviceModel/protocol เดิมจาก DB มา merge ให้ (ไม่ใช่ undefined)', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockResolvedValue({
        ...draftConfig,
        fields: { APN1: 'new-apn' },
      });

      await service.update(draftConfig.id, { fields: { APN1: 'new-apn' } });

      expect(configDefinitionService.validateFields).toHaveBeenCalledWith(
        draftConfig.deviceModel,
        draftConfig.protocol,
        { APN1: 'new-apn' },
      );
    });

    it('ส่งแค่ deviceModel ใหม่มา -> validateFields ใช้ fields เดิมจาก DB มา merge ให้ (เช็คว่า fields เดิมยังตรงกับรุ่นใหม่ไหม)', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockResolvedValue({
        ...draftConfig,
        deviceModel: 'GT06L',
      });

      await service.update(draftConfig.id, { deviceModel: 'GT06L' });

      expect(configDefinitionService.validateFields).toHaveBeenCalledWith(
        'GT06L',
        draftConfig.protocol,
        draftConfig.fields,
      );
    });

    it('validateFields โยน exception -> ไม่เรียก prisma.config.update เลย (ไม่บันทึกค่าที่ไม่ผ่าน)', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      configDefinitionService.validateFields.mockRejectedValue(
        new BadRequestException('ค่าที่กรอกไม่ตรงกับ Config Definition'),
      );

      await expect(
        service.update(draftConfig.id, { fields: { APN1: 'xxx' } }),
      ).rejects.toThrow(BadRequestException);
      expect(config.update).not.toHaveBeenCalled();
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
