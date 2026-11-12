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
import { ConfigSyncWriterQueue } from '../config-sync-writer/config-sync-writer-queue.service';
import { DeviceModelService } from '../device-model/device-model.service';
import { ActingUser, ConfigService } from './config.service';
import { DEVICE_SIMULATOR, DeviceSimulator } from './device-simulator';

type ConfigDelegateMock = {
  create: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

type ConfigVersionDelegateMock = {
  count: jest.Mock;
  create: jest.Mock;
  findMany: jest.Mock;
  findUnique: jest.Mock;
};

/** แถวที่ Prisma คืน (include ชื่อรุ่นจาก relation — Config ผูกรุ่นด้วย modelId) */
type ConfigRow = Config & { model: { name: string } };

const MODEL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GT06L_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MODEL_INCLUDE = { model: { select: { name: true } } };

const draftConfig: ConfigRow = {
  id: '11111111-1111-1111-1111-111111111111',
  idMaster: '99999999-9999-4999-8999-999999999999',
  name: 'ชุดตั้งค่าทดสอบ',
  description: null,
  modelId: MODEL_ID,
  model: { name: 'GT06N' },
  protocol: 'TCP',
  status: 'draft',
  fields: { APN1: 'internet' },
  createdBy: 'ce-1',
  approvedBy: null,
  suggestedApproverId: null,
  deletedAt: null,
  clonedFromId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const testingConfig: ConfigRow = { ...draftConfig, status: 'testing' };
const approvedConfig: ConfigRow = { ...draftConfig, status: 'approved' };
const syncedConfig: ConfigRow = { ...draftConfig, status: 'synced' };

/** รูปที่ ConfigService คืนให้ API: ไม่มี object `model` แต่มี `deviceModel` (ชื่อรุ่น) */
function view(row: ConfigRow) {
  const { model, ...rest } = row;
  return { ...rest, deviceModel: model.name };
}

const configEngineer: ActingUser = { id: 'ce-1', role: 'ConfigEngineer' };
const operation: ActingUser = { id: 'op-1', role: 'Operation' };

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
  let configVersion: ConfigVersionDelegateMock;
  let auditLog: { create: jest.Mock };
  let user: { findUnique: jest.Mock };
  let campaignRollout: { count: jest.Mock };
  let configApplyRequest: { count: jest.Mock };
  let deviceConfigOverride: { count: jest.Mock };
  let task: { count: jest.Mock };
  let incident: { count: jest.Mock };
  let queryRaw: jest.Mock;
  let configDeletionRequest: { updateMany: jest.Mock };
  let deviceSimulator: jest.Mocked<DeviceSimulator>;
  let configDefinitionService: { validateFields: jest.Mock };
  let configSyncQueue: { enqueueConfigSync: jest.Mock };
  let deviceModelService: { findOne: jest.Mock };

  beforeEach(async () => {
    config = {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    configVersion = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };
    user = { findUnique: jest.fn() };
    // ตัวนับ "ยังถูกใช้งานอยู่ไหม" ของ remove() — default 0 = ไม่ติดอะไร
    campaignRollout = { count: jest.fn().mockResolvedValue(0) };
    configApplyRequest = { count: jest.fn().mockResolvedValue(0) };
    deviceConfigOverride = { count: jest.fn().mockResolvedValue(0) };
    task = { count: jest.fn().mockResolvedValue(0) };
    incident = { count: jest.fn().mockResolvedValue(0) };
    // ล็อกแถว Config (FOR UPDATE) ของ remove() - default เจอแถว
    // $queryRaw ใช้ 2 งาน: ล็อกแถว Config ตอนลบ (FOR UPDATE) -> [{ id }] · ล็อกนิยาม field ที่ Config ใช้
    // ตอนสร้าง/แก้ (FOR SHARE, ส่งรายชื่อ field มาเป็น argument) -> คืนแถวครบทุกชื่อ (ไม่มี field ถูกลบ)
    queryRaw = jest.fn((_strings: TemplateStringsArray, names?: string[]) =>
      Promise.resolve(
        Array.isArray(names)
          ? names.map((fieldName) => ({ fieldName }))
          : [{ id: 'cfg-1' }],
      ),
    );
    configDeletionRequest = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    deviceSimulator = { simulateConfig: jest.fn() };
    // default: ผ่าน validate เสมอ (test เดิมทั้งหมดไม่เกี่ยวกับ Semantic
    // Validation) — describe('create'/'update') ด้านล่างจะ override เฉพาะ
    // test ที่ต้องเช็ค wiring/behavior ตอน validateFields โยน exception
    configDefinitionService = {
      validateFields: jest.fn().mockResolvedValue(undefined),
    };
    configSyncQueue = { enqueueConfigSync: jest.fn() };
    // default: รุ่น "GT06N" (ค่าเริ่มต้นของ draftConfig ด้านบน) รองรับ TCP —
    // เทสเดิมทั้งหมดไม่เกี่ยวกับ issue #209 ข้อ 4 โดยตรง จึงให้ผ่านเสมอ
    // describe ที่เกี่ยวกับ validateDeviceModelProtocol โดยตรงจะ override เอง
    deviceModelService = {
      findOne: jest.fn().mockResolvedValue({
        id: MODEL_ID,
        name: 'GT06N',
        supportedProtocols: ['TCP'],
      }),
    };

    // $transaction (interactive form) — เรียก callback ด้วย tx ที่ใช้ delegate
    // mock ตัวเดียวกับนอก transaction เพื่อให้ assertion เดิม (config.update
    // ฯลฯ) ยังทำงาน และเทส approve เช็ค configVersion.create ได้
    const prismaMock = {
      config,
      configVersion,
      auditLog,
      user,
      campaignRollout,
      configApplyRequest,
      deviceConfigOverride,
      task,
      configDeletionRequest,
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({
          config,
          configVersion,
          auditLog,
          configDeletionRequest,
          campaignRollout,
          configApplyRequest,
          deviceConfigOverride,
          task,
          incident,
          $queryRaw: queryRaw,
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: DEVICE_SIMULATOR, useValue: deviceSimulator },
        {
          provide: ConfigDefinitionService,
          useValue: configDefinitionService,
        },
        {
          provide: ConfigSyncWriterQueue,
          useValue: configSyncQueue,
        },
        {
          provide: DeviceModelService,
          useValue: deviceModelService,
        },
      ],
    }).compile();

    service = module.get(ConfigService);
  });

  describe('create', () => {
    it('ผูก createdBy จาก actor และส่ง name/fields/deviceModel/protocol ตรงๆ ให้ Prisma', async () => {
      config.create.mockResolvedValue(draftConfig);

      await service.create(
        {
          name: 'ชุดตั้งค่าทดสอบ',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
        },
        configEngineer,
      );

      expect(config.create).toHaveBeenCalledWith({
        data: {
          name: 'ชุดตั้งค่าทดสอบ',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          description: undefined,
          createdBy: 'ce-1',
        },
        include: MODEL_INCLUDE,
      });
    });

    it('AuditLog (#27) -> เขียน action create หลัง config.create สำเร็จ', async () => {
      config.create.mockResolvedValue(draftConfig);

      await service.create(
        {
          name: 'ชุดตั้งค่าทดสอบ',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
        },
        configEngineer,
      );

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: 'ce-1', auditModule: 'config', action: 'create' },
      });
    });

    it('AuditLog เขียนไม่สำเร็จ -> create() ยังสำเร็จปกติ (never-throw)', async () => {
      config.create.mockResolvedValue(draftConfig);
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.create(
          {
            name: 'ชุดตั้งค่าทดสอบ',
            modelId: MODEL_ID,
            protocol: 'TCP',
            fields: { APN1: 'internet' },
          },
          configEngineer,
        ),
      ).resolves.toEqual(view(draftConfig));
    });

    it('ส่ง description มา -> เขียนลง DB ตามนั้น', async () => {
      config.create.mockResolvedValue(draftConfig);

      await service.create(
        {
          name: 'ชุดตั้งค่าทดสอบ',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          description: 'ตั้งค่ามาตรฐานภาคกลาง',
        },
        configEngineer,
      );

      expect(config.create).toHaveBeenCalledWith({
        data: {
          name: 'ชุดตั้งค่าทดสอบ',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          description: 'ตั้งค่ามาตรฐานภาคกลาง',
          createdBy: 'ce-1',
        },
        include: MODEL_INCLUDE,
      });
    });

    it('คืน Config พร้อม deviceModel (ชื่อรุ่นจาก relation) และ idMaster ที่ฐานข้อมูลสร้าง ไม่ส่ง object model ออกไป', async () => {
      config.create.mockResolvedValue(draftConfig);

      const result = await service.create(
        {
          name: 'ชุดตั้งค่าทดสอบ',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
        },
        configEngineer,
      );

      expect(result.deviceModel).toBe('GT06N');
      expect(result.modelId).toBe(MODEL_ID);
      expect(result.idMaster).toBe(draftConfig.idMaster);
      expect(result).not.toHaveProperty('model');
      expect(deviceModelService.findOne).toHaveBeenCalledWith(MODEL_ID);
    });

    it('เรียก validateFields ด้วยชื่อรุ่น (จาก modelId)/protocol/fields จาก dto ก่อนเขียนลง DB', async () => {
      config.create.mockResolvedValue(draftConfig);

      await service.create(
        {
          name: 'ชุดตั้งค่าทดสอบ',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
        },
        configEngineer,
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
          {
            name: 'ชุดตั้งค่าทดสอบ',
            modelId: MODEL_ID,
            protocol: 'TCP',
            fields: { APN1: 'xxx' },
          },
          configEngineer,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('modelId ไม่มีในทะเบียน DeviceModel -> 404 จาก DeviceModelService ไม่เรียก config.create', async () => {
      deviceModelService.findOne.mockRejectedValue(
        new NotFoundException('ไม่พบรุ่นอุปกรณ์'),
      );

      await expect(
        service.create(
          {
            name: 'ชุดตั้งค่าทดสอบ',
            modelId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            protocol: 'TCP',
            fields: { APN1: 'internet' },
          },
          configEngineer,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('protocol ไม่อยู่ใน supportedProtocols ของรุ่นนั้น -> BadRequestException ไม่เรียก config.create (issue #209)', async () => {
      deviceModelService.findOne.mockResolvedValue({
        id: 'dm-1',
        name: 'GT06N',
        supportedProtocols: ['TCP'],
      });

      await expect(
        service.create(
          {
            name: 'ชุดตั้งค่าทดสอบ',
            modelId: MODEL_ID,
            protocol: 'UDP',
            fields: { APN1: 'internet' },
          },
          configEngineer,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('protocol อยู่ใน supportedProtocols -> ผ่านปกติ เรียก config.create (issue #209)', async () => {
      config.create.mockResolvedValue(draftConfig);
      deviceModelService.findOne.mockResolvedValue({
        id: 'dm-1',
        name: 'GT06N',
        supportedProtocols: ['TCP', 'UDP'],
      });

      await service.create(
        {
          name: 'ชุดตั้งค่าทดสอบ',
          modelId: MODEL_ID,
          protocol: 'UDP',
          fields: { APN1: 'internet' },
        },
        configEngineer,
      );

      expect(config.create).toHaveBeenCalled();
    });

    it('ชื่อ Config ซ้ำ (Prisma P2002 บน name) -> ConflictException (409)', async () => {
      config.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['name'] },
        }),
      );

      await expect(
        service.create(
          {
            name: 'ชื่อซ้ำ',
            modelId: MODEL_ID,
            protocol: 'TCP',
            fields: { APN1: 'internet' },
          },
          configEngineer,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('create: clonedFromId (ต้นทางของการโคลน)', () => {
    const base = {
      name: 'โคลนจาก SOS',
      modelId: MODEL_ID,
      protocol: 'TCP',
      fields: { APN1: 'internet' },
    };

    it('ส่ง clonedFromId ของ Config ที่มีอยู่ -> บันทึกต้นทางลง Config ใหม่', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);
      config.create.mockResolvedValue({
        ...draftConfig,
        clonedFromId: approvedConfig.id,
      });

      const result = await service.create(
        { ...base, clonedFromId: approvedConfig.id },
        configEngineer,
      );

      expect(config.findUnique).toHaveBeenCalledWith({
        where: { id: approvedConfig.id },
        include: MODEL_INCLUDE,
      });
      expect(config.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clonedFromId: approvedConfig.id,
        }) as Record<string, unknown>,
        include: MODEL_INCLUDE,
      });
      expect(result.clonedFromId).toBe(approvedConfig.id);
    });

    it('ต้นทางไม่พบ -> 404 และไม่สร้าง Config', async () => {
      config.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          { ...base, clonedFromId: '99999999-9999-4999-8999-999999999999' },
          configEngineer,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('ต้นทางถูก soft-delete แล้ว -> 404 (ไม่ผูกกับ Config ที่ถูกถอดออกจากระบบ)', async () => {
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        deletedAt: new Date('2026-02-01T00:00:00.000Z'),
      });

      await expect(
        service.create(
          { ...base, clonedFromId: approvedConfig.id },
          configEngineer,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('ไม่ส่ง clonedFromId (สร้างใหม่ตั้งแต่ต้น) -> ไม่ค้นหาต้นทาง และบันทึกเป็น undefined', async () => {
      config.create.mockResolvedValue(draftConfig);

      await service.create(base, configEngineer);

      expect(config.findUnique).not.toHaveBeenCalled();
      expect(config.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clonedFromId: undefined,
        }) as Record<string, unknown>,
        include: MODEL_INCLUDE,
      });
    });
  });

  describe('importFromJson', () => {
    it('ไม่มีไฟล์แนบมา -> BadRequestException', async () => {
      await expect(
        service.importFromJson(undefined, 'json', configEngineer),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('format ไม่ใช่ json (หรือไม่ส่งมา) -> BadRequestException', async () => {
      const file = makeMulterFile('{}');
      await expect(
        service.importFromJson(file, 'csv', configEngineer),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importFromJson(file, undefined, configEngineer),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('ไฟล์รูปแบบเดิมระบุรุ่นด้วยชื่อ (deviceModel) -> 400 บอกให้ใช้ modelId ไม่สร้าง Config', async () => {
      const file = makeMulterFile(
        JSON.stringify({
          name: 'ไฟล์เก่า',
          deviceModel: 'GT06N',
          protocol: 'TCP',
          fields: { APN1: 'internet' },
        }),
      );

      await expect(
        service.importFromJson(file, 'json', configEngineer),
      ).rejects.toThrow('modelId');
      expect(config.create).not.toHaveBeenCalled();
    });

    it('ไฟล์ parse เป็น JSON ไม่ได้ -> BadRequestException', async () => {
      const file = makeMulterFile('{ not valid json');
      await expect(
        service.importFromJson(file, 'json', configEngineer),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON เป็น null (valid JSON แต่ไม่ใช่ object) -> BadRequestException ไม่ใช่ TypeError', async () => {
      const file = makeMulterFile('null');
      await expect(
        service.importFromJson(file, 'json', configEngineer),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON เป็น array -> BadRequestException', async () => {
      const file = makeMulterFile(
        JSON.stringify([{ modelId: MODEL_ID, protocol: 'TCP', fields: {} }]),
      );
      await expect(
        service.importFromJson(file, 'json', configEngineer),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON เป็นค่าเดี่ยว (number/string) -> BadRequestException', async () => {
      await expect(
        service.importFromJson(makeMulterFile('42'), 'json', configEngineer),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importFromJson(
          makeMulterFile('"hello"'),
          'json',
          configEngineer,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON validate ไม่ผ่าน (ขาด deviceModel) -> BadRequestException', async () => {
      const file = makeMulterFile(
        JSON.stringify({ protocol: 'TCP', fields: {} }),
      );
      await expect(
        service.importFromJson(file, 'json', configEngineer),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON มี field แปลกปลอม (เช่น id/status) -> BadRequestException (forbidNonWhitelisted)', async () => {
      const file = makeMulterFile(
        JSON.stringify({
          id: 'should-not-be-here',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: {},
        }),
      );
      await expect(
        service.importFromJson(file, 'json', configEngineer),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('JSON ถูกต้อง -> create() ผ่าน flow เดียวกับฟอร์ม พร้อม createdBy จาก actor', async () => {
      config.create.mockResolvedValue(draftConfig);
      const file = makeMulterFile(
        JSON.stringify({
          name: 'ชุดตั้งค่านำเข้า',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
        }),
      );

      const result = await service.importFromJson(file, 'json', configEngineer);

      expect(result).toEqual(view(draftConfig));
      expect(config.create).toHaveBeenCalledWith({
        data: {
          name: 'ชุดตั้งค่านำเข้า',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          createdBy: 'ce-1',
        },
        include: MODEL_INCLUDE,
      });
    });

    it('JSON ไม่มี field name -> BadRequestException (name บังคับกรอก — มติ Sprint 1 review ข้อ 4)', async () => {
      const file = makeMulterFile(
        JSON.stringify({
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
        }),
      );

      await expect(
        service.importFromJson(file, 'json', configEngineer),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('format ใหม่ "settings" ซ้อนชั้น -> flatten เป็น "fields" คีย์มีจุดก่อน create() (รีวิวพี่เลี้ยง 27 ต.ค. — ให้ตรงกับ JSON ที่ Server กลางรับจริง)', async () => {
      config.create.mockResolvedValue(draftConfig);
      const file = makeMulterFile(
        JSON.stringify({
          name: 'ชุดตั้งค่านำเข้าแบบใหม่',
          modelId: MODEL_ID,
          protocol: 'TCP',
          settings: {
            gps: { enabled: true, send_interval_sec: 10 },
            data_server: { protocol: 'https', port: 443 },
          },
        }),
      );

      await service.importFromJson(file, 'json', configEngineer);

      expect(config.create).toHaveBeenCalledWith({
        data: {
          name: 'ชุดตั้งค่านำเข้าแบบใหม่',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: {
            'gps.enabled': true,
            'gps.send_interval_sec': 10,
            'data_server.protocol': 'https',
            'data_server.port': 443,
          },
          createdBy: 'ce-1',
        },
        include: MODEL_INCLUDE,
      });
    });

    it('มีทั้ง "fields" และ "settings" พร้อมกัน -> BadRequestException (กำกวม ไม่เดาให้)', async () => {
      const file = makeMulterFile(
        JSON.stringify({
          name: 'กำกวม',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: { APN1: 'internet' },
          settings: { gps: { enabled: true } },
        }),
      );

      await expect(
        service.importFromJson(file, 'json', configEngineer),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('"settings" ไม่ใช่ object (เช่น string) -> BadRequestException', async () => {
      const file = makeMulterFile(
        JSON.stringify({
          name: 'settings ผิดชนิด',
          modelId: MODEL_ID,
          protocol: 'TCP',
          settings: 'not-an-object',
        }),
      );

      await expect(
        service.importFromJson(file, 'json', configEngineer),
      ).rejects.toThrow(BadRequestException);
      expect(config.create).not.toHaveBeenCalled();
    });

    it('"settings" ของรุ่นที่ไม่มี key แบบมีจุด (เช่น SMARTEYEPLUS) -> flatten แบบไม่มีผล (no-op)', async () => {
      config.create.mockResolvedValue(draftConfig);
      const file = makeMulterFile(
        JSON.stringify({
          name: 'ตัวอย่าง SMARTEYEPLUS',
          modelId: MODEL_ID,
          protocol: 'TCP',
          settings: { APN1: 'internet', MTYP: '1', SIM1: '0812345678' },
        }),
      );

      await service.importFromJson(file, 'json', configEngineer);

      expect(config.create).toHaveBeenCalledWith({
        data: {
          name: 'ตัวอย่าง SMARTEYEPLUS',
          modelId: MODEL_ID,
          protocol: 'TCP',
          fields: { APN1: 'internet', MTYP: '1', SIM1: '0812345678' },
          createdBy: 'ce-1',
        },
        include: MODEL_INCLUDE,
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
        deviceModel: draftConfig.model.name,
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

      const result = await service.decide(draftConfig.id, true, configEngineer);

      expect(result).toEqual(view(testingConfig));
      expect(config.update).toHaveBeenCalledWith({
        where: { id: draftConfig.id },
        data: { status: 'testing' },
        include: MODEL_INCLUDE,
      });
    });

    it('AuditLog (#27) -> เขียน action decide เฉพาะตอน passed:true', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockResolvedValue(testingConfig);

      await service.decide(draftConfig.id, true, configEngineer);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: 'ce-1', auditModule: 'config', action: 'decide' },
      });
    });

    it('AuditLog เขียนไม่สำเร็จ -> decide() ยังสำเร็จปกติ (never-throw)', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockResolvedValue(testingConfig);
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.decide(draftConfig.id, true, configEngineer),
      ).resolves.toEqual(view(testingConfig));
    });

    it('status draft, passed:false -> ไม่ยิง update ลง DB เลย คืน config เดิม (ยังเป็น draft) ไม่เขียน AuditLog', async () => {
      config.findUnique.mockResolvedValue(draftConfig);

      const result = await service.decide(
        draftConfig.id,
        false,
        configEngineer,
      );

      expect(result).toEqual(view(draftConfig));
      expect(config.update).not.toHaveBeenCalled();
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('status testing (ส่งต่อ Operation ไปแล้ว) -> ConflictException ไม่ว่า passed จะเป็นอะไร', async () => {
      config.findUnique.mockResolvedValue(testingConfig);

      await expect(
        service.decide(testingConfig.id, true, configEngineer),
      ).rejects.toThrow(ConflictException);
      expect(config.update).not.toHaveBeenCalled();
    });

    it('status approved -> ConflictException', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);

      await expect(
        service.decide(approvedConfig.id, true, configEngineer),
      ).rejects.toThrow(ConflictException);
      expect(config.update).not.toHaveBeenCalled();
    });

    it('ไม่เจอ config เลย -> NotFoundException', async () => {
      config.findUnique.mockResolvedValue(null);

      await expect(
        service.decide('missing-id', true, configEngineer),
      ).rejects.toThrow(NotFoundException);
    });

    it('race condition: row ถูกลบไปพอดีระหว่าง findOne กับ update (P2025) -> NotFoundException ไม่ใช่ 500', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockRejectedValue(makeP2025());

      await expect(
        service.decide(draftConfig.id, true, configEngineer),
      ).rejects.toThrow(NotFoundException);
    });

    describe('suggestedApproverId (เจาะจงผู้อนุมัติ — #19)', () => {
      it('ไม่ส่ง suggestedApproverId -> update แค่ status (ไม่แตะ user.findUnique)', async () => {
        config.findUnique.mockResolvedValue(draftConfig);
        config.update.mockResolvedValue(testingConfig);

        await service.decide(draftConfig.id, true, configEngineer);

        expect(user.findUnique).not.toHaveBeenCalled();
        expect(config.update).toHaveBeenCalledWith({
          where: { id: draftConfig.id },
          data: { status: 'testing' },
          include: MODEL_INCLUDE,
        });
      });

      it('suggestedApproverId เป็น Operation ที่ active -> set ค่าใน update', async () => {
        config.findUnique.mockResolvedValue(draftConfig);
        config.update.mockResolvedValue(testingConfig);
        user.findUnique.mockResolvedValue({
          id: 'op-1',
          isActive: true,
          role: { code: 'Operation' },
        });

        await service.decide(draftConfig.id, true, configEngineer, 'op-1');

        expect(config.update).toHaveBeenCalledWith({
          where: { id: draftConfig.id },
          data: { status: 'testing', suggestedApproverId: 'op-1' },
          include: MODEL_INCLUDE,
        });
      });

      it('suggestedApproverId เป็น role อื่น (ไม่ใช่ Operation) -> BadRequestException', async () => {
        config.findUnique.mockResolvedValue(draftConfig);
        user.findUnique.mockResolvedValue({
          id: 'ce-2',
          isActive: true,
          role: { code: 'ConfigEngineer' },
        });

        await expect(
          service.decide(draftConfig.id, true, configEngineer, 'ce-2'),
        ).rejects.toThrow(BadRequestException);
        expect(config.update).not.toHaveBeenCalled();
      });

      it('suggestedApproverId เป็น Operation ที่ถูกปิดใช้งาน -> BadRequestException', async () => {
        config.findUnique.mockResolvedValue(draftConfig);
        user.findUnique.mockResolvedValue({
          id: 'op-x',
          isActive: false,
          role: { code: 'Operation' },
        });

        await expect(
          service.decide(draftConfig.id, true, configEngineer, 'op-x'),
        ).rejects.toThrow(BadRequestException);
        expect(config.update).not.toHaveBeenCalled();
      });

      it('suggestedApproverId ไม่มี user นี้ -> BadRequestException', async () => {
        config.findUnique.mockResolvedValue(draftConfig);
        user.findUnique.mockResolvedValue(null);

        await expect(
          service.decide(draftConfig.id, true, configEngineer, 'ghost'),
        ).rejects.toThrow(BadRequestException);
      });

      it('passed:false -> ไม่เช็ค suggestedApproverId เลย (คืน config เดิม)', async () => {
        config.findUnique.mockResolvedValue(draftConfig);

        const result = await service.decide(
          draftConfig.id,
          false,
          configEngineer,
          'op-1',
        );

        expect(result).toEqual(view(draftConfig));
        expect(user.findUnique).not.toHaveBeenCalled();
        expect(config.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('approve', () => {
    it('status testing -> update สถานะเป็น approved พร้อมบันทึก approvedBy = actor', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockResolvedValue({
        ...approvedConfig,
        approvedBy: operation.id,
      });

      const result = await service.approve(testingConfig.id, operation);

      expect(result).toEqual(
        view({ ...approvedConfig, approvedBy: operation.id }),
      );
      expect(config.update).toHaveBeenCalledWith({
        where: { id: testingConfig.id },
        data: { status: 'approved', approvedBy: operation.id },
        include: MODEL_INCLUDE,
      });
    });

    it('AuditLog (#27) -> เขียน action approve ใน transaction เดียวกัน', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockResolvedValue(approvedConfig);
      configVersion.count.mockResolvedValue(0);

      await service.approve(testingConfig.id, operation);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: 'op-1', auditModule: 'config', action: 'approve' },
      });
    });

    it('AuditLog เขียนไม่สำเร็จ -> approve() ยังสำเร็จปกติ ConfigVersion/status ยัง commit (never-throw)', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockResolvedValue(approvedConfig);
      configVersion.count.mockResolvedValue(0);
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.approve(testingConfig.id, operation),
      ).resolves.toEqual(view(approvedConfig));
      expect(configVersion.create).toHaveBeenCalled();
    });

    it('Stage 5: เขียน ConfigVersion snapshot (versionNumber = prior + 1) ใน transaction เดียวกัน', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockResolvedValue(approvedConfig);
      configVersion.count.mockResolvedValue(2); // เคย approve มาแล้ว 2 ครั้ง

      await service.approve(testingConfig.id, operation);

      expect(configVersion.create).toHaveBeenCalledWith({
        data: {
          configId: testingConfig.id,
          versionNumber: 3,
          fields: testingConfig.fields,
          deviceModel: testingConfig.model.name,
          protocol: testingConfig.protocol,
          approvedBy: operation.id,
        },
      });
    });

    it('Stage 5: config ที่ approve ครั้งแรก -> versionNumber = 1', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockResolvedValue(approvedConfig);
      configVersion.count.mockResolvedValue(0);

      await service.approve(testingConfig.id, operation);

      expect(configVersion.create).toHaveBeenCalledWith({
        data: {
          configId: testingConfig.id,
          versionNumber: 1,
          fields: testingConfig.fields,
          deviceModel: testingConfig.model.name,
          protocol: testingConfig.protocol,
          approvedBy: operation.id,
        },
      });
    });

    it('Stage 5: precondition ไม่ผ่าน -> ไม่แตะ ConfigVersion เลย', async () => {
      config.findUnique.mockResolvedValue(draftConfig);

      await expect(service.approve(draftConfig.id, operation)).rejects.toThrow(
        ConflictException,
      );
      expect(configVersion.create).not.toHaveBeenCalled();
    });

    it('config-sync: approve สำเร็จ -> enqueue งานเขียนเข้าระบบเดิม พร้อม payload ครบ', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockResolvedValue(approvedConfig);
      configVersion.count.mockResolvedValue(0);

      await service.approve(testingConfig.id, operation);

      expect(configSyncQueue.enqueueConfigSync).toHaveBeenCalledTimes(1);
      expect(configSyncQueue.enqueueConfigSync).toHaveBeenCalledWith({
        configId: approvedConfig.id,
        versionNumber: 1,
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: { APN1: 'internet' },
      });
    });

    it('config-sync: precondition ไม่ผ่าน -> ไม่ enqueue งาน config-sync', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);

      await expect(
        service.approve(approvedConfig.id, operation),
      ).rejects.toThrow(ConflictException);
      expect(configSyncQueue.enqueueConfigSync).not.toHaveBeenCalled();
    });

    it('config-sync: fields ที่มี boolean -> แปลงเป็น "true"/"false" ตอน enqueue', async () => {
      config.findUnique.mockResolvedValue({
        ...testingConfig,
        fields: { GPS: true, RATE: 30, APN: 'internet' },
      });
      config.update.mockResolvedValue(approvedConfig);
      configVersion.count.mockResolvedValue(0);

      await service.approve(testingConfig.id, operation);

      expect(configSyncQueue.enqueueConfigSync).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: { GPS: 'true', RATE: 30, APN: 'internet' },
        }),
      );
    });

    it('status draft (ยังไม่ผ่าน decide ของ ConfigEngineer) -> ConflictException', async () => {
      config.findUnique.mockResolvedValue(draftConfig);

      await expect(service.approve(draftConfig.id, operation)).rejects.toThrow(
        ConflictException,
      );
      expect(config.update).not.toHaveBeenCalled();
    });

    it('status approved อยู่แล้ว -> ConflictException (กันกดซ้ำ)', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);

      await expect(
        service.approve(approvedConfig.id, operation),
      ).rejects.toThrow(ConflictException);
      expect(config.update).not.toHaveBeenCalled();
    });

    it('ไม่เจอ config เลย -> NotFoundException', async () => {
      config.findUnique.mockResolvedValue(null);

      await expect(service.approve('missing-id', operation)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('race condition (P2025) -> NotFoundException ไม่ใช่ 500', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockRejectedValue(makeP2025());

      await expect(
        service.approve(testingConfig.id, operation),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reject', () => {
    it('status testing -> update สถานะย้อนกลับเป็น draft', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockResolvedValue(draftConfig);

      const result = await service.reject(testingConfig.id, operation);

      expect(result).toEqual(view(draftConfig));
      expect(config.update).toHaveBeenCalledWith({
        where: { id: testingConfig.id },
        data: { status: 'draft' },
        include: MODEL_INCLUDE,
      });
    });

    it('AuditLog (#27) -> เขียน action reject หลัง update สำเร็จ', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockResolvedValue(draftConfig);

      await service.reject(testingConfig.id, operation);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: 'op-1', auditModule: 'config', action: 'reject' },
      });
    });

    it('AuditLog เขียนไม่สำเร็จ -> reject() ยังสำเร็จปกติ (never-throw)', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockResolvedValue(draftConfig);
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.reject(testingConfig.id, operation),
      ).resolves.toEqual(view(draftConfig));
    });

    it('status draft (ยังไม่เคยส่งต่อ Operation) -> ConflictException', async () => {
      config.findUnique.mockResolvedValue(draftConfig);

      await expect(service.reject(draftConfig.id, operation)).rejects.toThrow(
        ConflictException,
      );
      expect(config.update).not.toHaveBeenCalled();
    });

    it('status approved ไปแล้ว -> ConflictException', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);

      await expect(
        service.reject(approvedConfig.id, operation),
      ).rejects.toThrow(ConflictException);
      expect(config.update).not.toHaveBeenCalled();
    });

    it('ไม่เจอ config เลย -> NotFoundException', async () => {
      config.findUnique.mockResolvedValue(null);

      await expect(service.reject('missing-id', operation)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('race condition (P2025) -> NotFoundException ไม่ใช่ 500', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      config.update.mockRejectedValue(makeP2025());

      await expect(service.reject(testingConfig.id, operation)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listVersions (Stage 5, #26 ข้อ 9)', () => {
    const v1 = {
      id: 'v-1',
      configId: draftConfig.id,
      versionNumber: 1,
      fields: { APN1: 'internet' },
      deviceModel: 'GT06N',
      protocol: 'TCP',
      approvedBy: 'op-1',
      approvedAt: new Date('2026-02-01T00:00:00.000Z'),
    };

    it('config มีจริง -> คืน versions เรียง versionNumber มาก→น้อย', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);
      configVersion.findMany.mockResolvedValue([v1]);

      const result = await service.listVersions(draftConfig.id);

      expect(result).toEqual([v1]);
      expect(configVersion.findMany).toHaveBeenCalledWith({
        where: { configId: draftConfig.id },
        orderBy: { versionNumber: 'desc' },
      });
    });

    it('config มีจริงแต่ยังไม่เคย approve -> คืน []', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      configVersion.findMany.mockResolvedValue([]);

      await expect(service.listVersions(draftConfig.id)).resolves.toEqual([]);
    });

    it('ไม่พบ config -> NotFoundException (ไม่ query versions)', async () => {
      config.findUnique.mockResolvedValue(null);

      await expect(service.listVersions('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(configVersion.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getVersion (Stage 5, #26 ข้อ 9)', () => {
    const v2 = {
      id: 'v-2',
      configId: draftConfig.id,
      versionNumber: 2,
      fields: { APN1: 'internet2' },
      deviceModel: 'GT06N',
      protocol: 'TCP',
      approvedBy: 'op-1',
      approvedAt: new Date('2026-03-01T00:00:00.000Z'),
    };

    it('เจอเวอร์ชัน -> คืน snapshot', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);
      configVersion.findUnique.mockResolvedValue(v2);

      const result = await service.getVersion(draftConfig.id, 2);

      expect(result).toEqual(v2);
      expect(configVersion.findUnique).toHaveBeenCalledWith({
        where: {
          configId_versionNumber: {
            configId: draftConfig.id,
            versionNumber: 2,
          },
        },
      });
    });

    it('config เจอ แต่ไม่มีเวอร์ชันนั้น -> NotFoundException', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);
      configVersion.findUnique.mockResolvedValue(null);

      await expect(service.getVersion(draftConfig.id, 99)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('ไม่พบ config -> NotFoundException (ไม่ query version)', async () => {
      config.findUnique.mockResolvedValue(null);

      await expect(service.getVersion('missing-id', 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(configVersion.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('ส่ง status filter ต่อให้ Prisma ตรงๆ + กรอง soft-deleted ออก ไม่ scope ตาม creator', async () => {
      config.findMany.mockResolvedValue([draftConfig]);

      const result = await service.findAll({ status: 'draft' });

      expect(result).toEqual([view(draftConfig)]);
      expect(config.findMany).toHaveBeenCalledWith({
        where: { status: 'draft', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: MODEL_INCLUDE,
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

    it('config ถูก soft-delete (deletedAt != null) -> NotFoundException (docs/11 Part A)', async () => {
      config.findUnique.mockResolvedValue({
        ...draftConfig,
        deletedAt: new Date('2026-06-01T00:00:00.000Z'),
      });
      await expect(service.findOne(draftConfig.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('เจอ config -> คืนค่าตรงๆ', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      await expect(service.findOne(draftConfig.id)).resolves.toEqual(
        view(draftConfig),
      );
    });
  });

  describe('update', () => {
    it('config status ไม่ใช่ draft -> ConflictException', async () => {
      config.findUnique.mockResolvedValue(testingConfig);
      await expect(
        service.update(testingConfig.id, { modelId: GT06L_ID }, configEngineer),
      ).rejects.toThrow(ConflictException);
      expect(config.update).not.toHaveBeenCalled();
    });

    it('config status เป็น draft -> update ผ่าน', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockResolvedValue({
        ...draftConfig,
        modelId: GT06L_ID,
        model: { name: 'GT06L' },
      });

      await service.update(
        draftConfig.id,
        { modelId: GT06L_ID },
        configEngineer,
      );

      expect(config.update).toHaveBeenCalledWith({
        where: { id: draftConfig.id },
        data: {
          name: undefined,
          modelId: GT06L_ID,
          protocol: undefined,
          fields: undefined,
          description: undefined,
        },
        include: MODEL_INCLUDE,
      });
    });

    it('protocol ใหม่ไม่อยู่ใน supportedProtocols ของ deviceModel เดิม -> BadRequestException ไม่เรียก config.update (issue #209)', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      deviceModelService.findOne.mockResolvedValue({
        id: 'dm-1',
        name: 'GT06N',
        supportedProtocols: ['TCP'],
      });

      await expect(
        service.update(draftConfig.id, { protocol: 'UDP' }, configEngineer),
      ).rejects.toThrow(BadRequestException);
      expect(config.update).not.toHaveBeenCalled();
    });

    it('AuditLog (#27) -> เขียน action update หลัง config.update สำเร็จ', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockResolvedValue({
        ...draftConfig,
        modelId: GT06L_ID,
        model: { name: 'GT06L' },
      });

      await service.update(
        draftConfig.id,
        { modelId: GT06L_ID },
        configEngineer,
      );

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: 'ce-1', auditModule: 'config', action: 'update' },
      });
    });

    it('AuditLog เขียนไม่สำเร็จ -> update() ยังสำเร็จปกติ (never-throw)', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      const updated: ConfigRow = {
        ...draftConfig,
        modelId: GT06L_ID,
        model: { name: 'GT06L' },
      };
      config.update.mockResolvedValue(updated);
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.update(draftConfig.id, { modelId: GT06L_ID }, configEngineer),
      ).resolves.toEqual(view(updated));
    });

    it('ส่ง description ใหม่มา -> update ค่านั้น', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockResolvedValue(draftConfig);

      await service.update(
        draftConfig.id,
        { description: 'อัปเดตคำอธิบาย' },
        configEngineer,
      );

      expect(config.update).toHaveBeenCalledWith({
        where: { id: draftConfig.id },
        data: {
          name: undefined,
          modelId: undefined,
          protocol: undefined,
          fields: undefined,
          description: 'อัปเดตคำอธิบาย',
        },
        include: MODEL_INCLUDE,
      });
    });

    it('เปลี่ยนชื่อไปชนกับ Config อื่น (Prisma P2002 บน name) -> ConflictException (409)', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['name'] },
        }),
      );

      await expect(
        service.update(
          draftConfig.id,
          { name: 'ชื่อที่มีอยู่แล้ว' },
          configEngineer,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('ไม่เจอ config เลย -> NotFoundException (ไม่ใช่ ConflictException)', async () => {
      config.findUnique.mockResolvedValue(null);
      await expect(
        service.update('missing-id', { modelId: GT06L_ID }, configEngineer),
      ).rejects.toThrow(NotFoundException);
    });

    it('race condition: row ถูกลบไปพอดีระหว่าง findOne กับ update (P2025) -> NotFoundException ไม่ใช่ 500', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockRejectedValue(makeP2025());

      await expect(
        service.update(draftConfig.id, { modelId: GT06L_ID }, configEngineer),
      ).rejects.toThrow(NotFoundException);
    });

    it('ส่งแค่ fields ใหม่มา -> validateFields ใช้ deviceModel/protocol เดิมจาก DB มา merge ให้ (ไม่ใช่ undefined)', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockResolvedValue({
        ...draftConfig,
        fields: { APN1: 'new-apn' },
      });

      await service.update(
        draftConfig.id,
        { fields: { APN1: 'new-apn' } },
        configEngineer,
      );

      expect(configDefinitionService.validateFields).toHaveBeenCalledWith(
        draftConfig.model.name,
        draftConfig.protocol,
        { APN1: 'new-apn' },
      );
    });

    it('ส่งแค่ modelId ใหม่มา -> validateFields ใช้ fields เดิมจาก DB มา merge ให้ (เช็คว่า fields เดิมยังตรงกับรุ่นใหม่ไหม)', async () => {
      deviceModelService.findOne.mockResolvedValue({
        id: GT06L_ID,
        name: 'GT06L',
        supportedProtocols: ['TCP'],
      });
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockResolvedValue({
        ...draftConfig,
        modelId: GT06L_ID,
        model: { name: 'GT06L' },
      });

      await service.update(
        draftConfig.id,
        { modelId: GT06L_ID },
        configEngineer,
      );

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
        service.update(
          draftConfig.id,
          { fields: { APN1: 'xxx' } },
          configEngineer,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(config.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('draft ที่ไม่มีอะไรอ้างถึงเลย -> ลบจริง (hard delete)', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.delete.mockResolvedValue(draftConfig);

      await service.remove(draftConfig.id, configEngineer);

      expect(config.delete).toHaveBeenCalledWith({
        where: { id: draftConfig.id },
      });
      expect(config.update).not.toHaveBeenCalled();
    });

    it('draft ที่มีแถวอ้างถึงอยู่ (เช่น ConfigVersion/ประวัติ) -> soft delete แทนลบจริง', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.update.mockResolvedValue(draftConfig);
      configVersion.count.mockResolvedValue(1);

      await service.remove(draftConfig.id, configEngineer);

      expect(config.delete).not.toHaveBeenCalled();
      expect(config.update).toHaveBeenCalled();
    });

    it.each([
      ['testing', testingConfig],
      ['approved', approvedConfig],
      ['synced', syncedConfig],
    ])(
      'config status %s -> soft delete (deletedAt + เปลี่ยนชื่อปล่อยชื่อเดิม) และยกเลิกคำขอลบอัตโนมัติที่ค้าง',
      async (_label, existing) => {
        config.findUnique.mockResolvedValue(existing);
        config.update.mockResolvedValue(existing);

        await service.remove(existing.id, configEngineer);

        expect(config.delete).not.toHaveBeenCalled();
        expect(config.update).toHaveBeenCalledWith({
          where: { id: existing.id },
          data: {
            deletedAt: expect.any(Date) as Date,
            name: `${existing.name} [ลบแล้ว ${existing.id.slice(0, 8)}]`,
          },
        });
        expect(configDeletionRequest.updateMany).toHaveBeenCalledWith({
          where: { configId: existing.id, status: 'pending' },
          data: { status: 'cancelled' },
        });
      },
    );

    it('Config ที่ถูกลบไปแล้ว -> NotFoundException', async () => {
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        deletedAt: new Date(),
      });

      await expect(
        service.remove(approvedConfig.id, configEngineer),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([
      ['Rollout ที่ยังไม่จบ', () => campaignRollout.count],
      ['คำขอส่งเข้ากล่องที่ยังไม่จบ', () => configApplyRequest.count],
      ['คำขอ Override ที่รออนุมัติ', () => deviceConfigOverride.count],
      ['งานของช่างที่ยังเปิดอยู่', () => task.count],
    ])('ยังมี %s -> ConflictException ไม่ลบ', async (label, counter) => {
      config.findUnique.mockResolvedValue(approvedConfig);
      counter().mockResolvedValue(1);

      await expect(
        service.remove(approvedConfig.id, configEngineer),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.remove(approvedConfig.id, configEngineer),
      ).rejects.toThrow(label);
      expect(config.delete).not.toHaveBeenCalled();
      expect(config.update).not.toHaveBeenCalled();
    });

    it('ตรวจ Rollout ค้างด้วยสถานะ pending_approval/approved/active/paused เท่านั้น', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);
      config.update.mockResolvedValue(approvedConfig);

      await service.remove(approvedConfig.id, configEngineer);

      expect(campaignRollout.count).toHaveBeenCalledWith({
        where: {
          configId: approvedConfig.id,
          status: { in: ['pending_approval', 'approved', 'active', 'paused'] },
        },
      });
    });

    it('ล็อกแถว Config (FOR UPDATE) ก่อน แล้วตรวจ "ยังถูกใช้งานอยู่" ซ้ำหลังได้ล็อก แล้วค่อยลบ (กัน TOCTOU - review B บน #425)', async () => {
      const order: string[] = [];
      queryRaw.mockImplementation((strings: TemplateStringsArray) => {
        order.push(`lock:${strings.join('?').includes('FOR UPDATE')}`);
        return Promise.resolve([{ id: approvedConfig.id }]);
      });
      campaignRollout.count.mockImplementation(() => {
        order.push('check-in-use');
        return Promise.resolve(0);
      });
      config.update.mockImplementation(() => {
        order.push('soft-delete');
        return Promise.resolve(approvedConfig);
      });
      config.findUnique.mockResolvedValue(approvedConfig);

      await service.remove(approvedConfig.id, configEngineer);

      expect(order).toEqual(['lock:true', 'check-in-use', 'soft-delete']);
    });

    it('แถวหายไประหว่างรอล็อก (ถูกลบพร้อมกัน) -> NotFoundException ไม่ลบซ้ำ', async () => {
      config.findUnique.mockResolvedValue(approvedConfig);
      queryRaw.mockResolvedValue([]);

      await expect(
        service.remove(approvedConfig.id, configEngineer),
      ).rejects.toThrow(NotFoundException);
      expect(config.update).not.toHaveBeenCalled();
      expect(config.delete).not.toHaveBeenCalled();
    });

    it('ถูกลบโดยอีกคำขอระหว่างรอล็อก (อ่านซ้ำหลังล็อกเจอ deletedAt) -> NotFoundException', async () => {
      config.findUnique
        .mockResolvedValueOnce(approvedConfig)
        .mockResolvedValueOnce({ ...approvedConfig, deletedAt: new Date() });

      await expect(
        service.remove(approvedConfig.id, configEngineer),
      ).rejects.toThrow(NotFoundException);
      expect(config.update).not.toHaveBeenCalled();
    });

    it('AuditLog (#27) -> เขียน action delete พร้อม configId หลังลบสำเร็จ', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.delete.mockResolvedValue(draftConfig);

      await service.remove(draftConfig.id, configEngineer);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'ce-1',
          auditModule: 'config',
          action: 'delete',
          metadata: { configId: draftConfig.id },
        },
      });
    });

    it('AuditLog เขียนไม่สำเร็จ -> remove() ยังสำเร็จปกติ (never-throw)', async () => {
      config.findUnique.mockResolvedValue(draftConfig);
      config.delete.mockResolvedValue(draftConfig);
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.remove(draftConfig.id, configEngineer),
      ).resolves.toBeUndefined();
    });
  });
});
