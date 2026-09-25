import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Config, Device, Firmware } from '@prisma/client';
import { CampaignRolloutService } from '../campaign/campaign-rollout.service';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigDefinitionService } from '../config-definition/config-definition.service';
import { DEVICE_SIMULATOR, DeviceSimulator } from '../config/device-simulator';
import { CONFIG_APPLIER, ConfigApplier } from './config-applier';
import {
  DEVICE_CONNECTION_TESTER,
  DeviceConnectionTester,
} from './device-connection-tester';
import { ActingUser, DeviceService } from './device.service';

/** `include` ที่ `findAll`/`findByDeviceId` แนบไปทุกครั้ง (docs/12 เฟส B —
 * ดึงลูกค้าแบบย่อมาแสดง/กรองบน Device Search) */
const CUSTOMER_INCLUDE = {
  customer: { select: { id: true, companyName: true } },
};

const installedDevice: Device = {
  id: '11111111-1111-1111-1111-111111111111',
  deviceId: 'DTC-0001',
  simNumber: '0899999999',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  hardwareRevisionCode: null,
  status: 'installed',
  registeredAt: new Date('2026-01-01T00:00:00.000Z'),
  installedAt: new Date('2026-01-02T00:00:00.000Z'),
  customerId: null,
  modelId: 'dm-1',
};

const registeredDevice: Device = {
  ...installedDevice,
  status: 'registered',
  installedAt: null,
};
const decommissionedDevice: Device = {
  ...installedDevice,
  status: 'decommissioned',
};

const mockResult = {
  passed: true,
  signalStrength: -65,
  details: ['ทดสอบผ่าน (mock)'],
  testedAt: '2026-09-02T10:00:00.000Z',
};

const approvedConfig: Config = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'ชุดตั้งค่าทดสอบ (device spec)',
  description: null,
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'approved',
  fields: { APN: 'internet' },
  createdBy: 'user-1',
  approvedBy: 'user-2',
  suggestedApproverId: null,
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const applyResult = {
  applied: true,
  details: ['ส่ง Config แล้ว (mock)'],
  appliedAt: '2026-09-04T10:00:00.000Z',
};

const readyFirmware: Firmware = {
  id: '33333333-3333-3333-3333-333333333333',
  version: 'GT06N-v2.4.1',
  deviceModelCompatibility: ['GT06N'],
  uploadStatus: 'stored',
  deviceUpdateStatus: 'unknown',
  objectKey: 'firmware/gt06n/v2.4.1.bin',
  originalFilename: 'gt06n-v2.4.1.bin',
  fileSizeBytes: 2048,
  uploadedBy: 'user-3',
  uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
  approvalStatus: 'approved',
  approvedBy: 'user-4',
};

const st: ActingUser = { id: 'st-1', role: 'ST' };
const operation: ActingUser = { id: 'op-1', role: 'Operation' };

const simPass = { passed: true, details: ['config ok (mock)'] };
const connPass = {
  passed: true,
  signalStrength: -65,
  details: ['สัญญาณ ok (mock)'],
  testedAt: '2026-09-07T10:00:00.000Z',
};

describe('DeviceService', () => {
  let service: DeviceService;
  let device: { findUnique: jest.Mock; findMany: jest.Mock };
  let config: { findUnique: jest.Mock };
  let task: { findFirst: jest.Mock };
  let firmware: { findUnique: jest.Mock };
  let deviceConfigOverride: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
  };
  let auditLog: { create: jest.Mock };
  let connectionTester: jest.Mocked<DeviceConnectionTester>;
  let configApplier: jest.Mocked<ConfigApplier>;
  let deviceSimulator: jest.Mocked<DeviceSimulator>;
  let campaignRolloutService: { recordTargetResult: jest.Mock };
  let validateOverridableFields: jest.Mock;

  beforeEach(async () => {
    device = { findUnique: jest.fn(), findMany: jest.fn() };
    config = { findUnique: jest.fn() };
    task = { findFirst: jest.fn() };
    firmware = { findUnique: jest.fn() };
    deviceConfigOverride = {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };
    connectionTester = { testConnection: jest.fn() };
    configApplier = { applyConfig: jest.fn() };
    deviceSimulator = { simulateConfig: jest.fn() };
    campaignRolloutService = {
      recordTargetResult: jest.fn().mockResolvedValue(undefined),
    };
    validateOverridableFields = jest.fn().mockResolvedValue(undefined);

    // `overrideDeviceConfig()`/`approveDeviceConfigOverride()`/
    // `rejectDeviceConfigOverride()` (issue #223) เขียนผ่าน `$transaction` —
    // tx ใช้ mock ตัวเดียวกับด้านนอกทั้งหมด (ไม่แยก mock ใหม่) ให้เทสเดิม/ใหม่
    // assert ผ่าน mock เดียวกันได้ตรงๆ mirror pattern ของ
    // `config-override.service.spec.ts`
    const tx = {
      deviceConfigOverride: {
        findFirst: deviceConfigOverride.findFirst,
        findUniqueOrThrow: deviceConfigOverride.findUniqueOrThrow,
        create: deviceConfigOverride.create,
        updateMany: deviceConfigOverride.updateMany,
      },
      auditLog: { create: auditLog.create },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceService,
        {
          provide: PrismaService,
          useValue: {
            device,
            config,
            task,
            firmware,
            deviceConfigOverride,
            auditLog,
            $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
          },
        },
        { provide: DEVICE_CONNECTION_TESTER, useValue: connectionTester },
        { provide: CONFIG_APPLIER, useValue: configApplier },
        { provide: DEVICE_SIMULATOR, useValue: deviceSimulator },
        { provide: CampaignRolloutService, useValue: campaignRolloutService },
        {
          provide: ConfigDefinitionService,
          useValue: { validateOverridableFields },
        },
      ],
    }).compile();

    service = module.get(DeviceService);
  });

  describe('findAll', () => {
    it('ไม่มี filter -> where ว่าง (ทุก field undefined) เรียงตาม deviceId', async () => {
      device.findMany.mockResolvedValue([installedDevice]);

      const result = await service.findAll({});

      expect(result).toEqual([installedDevice]);
      expect(device.findMany).toHaveBeenCalledWith({
        where: {
          deviceModel: undefined,
          protocol: undefined,
          status: undefined,
          customerId: undefined,
        },
        orderBy: { deviceId: 'asc' },
        include: CUSTOMER_INCLUDE,
      });
    });

    it('มี deviceModel/protocol/status -> ส่งต่อ Prisma ตรงๆ', async () => {
      device.findMany.mockResolvedValue([]);

      await service.findAll({
        deviceModel: 'GT06N',
        protocol: 'TCP',
        status: 'installed',
      });

      expect(device.findMany).toHaveBeenCalledWith({
        where: {
          deviceModel: 'GT06N',
          protocol: 'TCP',
          status: 'installed',
          customerId: undefined,
        },
        orderBy: { deviceId: 'asc' },
        include: CUSTOMER_INCLUDE,
      });
    });

    it('มี customerId -> ส่งต่อ Prisma ตรงๆ (issue #204)', async () => {
      device.findMany.mockResolvedValue([]);

      await service.findAll({
        customerId: '33333333-3333-3333-3333-333333333333',
      });

      expect(device.findMany).toHaveBeenCalledWith({
        where: {
          deviceModel: undefined,
          protocol: undefined,
          status: undefined,
          customerId: '33333333-3333-3333-3333-333333333333',
        },
        orderBy: { deviceId: 'asc' },
        include: CUSTOMER_INCLUDE,
      });
    });

    it('search -> OR match deviceId + simNumber (contains, insensitive)', async () => {
      device.findMany.mockResolvedValue([installedDevice]);

      await service.findAll({ search: '0001' });

      expect(device.findMany).toHaveBeenCalledWith({
        where: {
          deviceModel: undefined,
          protocol: undefined,
          status: undefined,
          customerId: undefined,
          OR: [
            { deviceId: { contains: '0001', mode: 'insensitive' } },
            { simNumber: { contains: '0001', mode: 'insensitive' } },
          ],
        },
        orderBy: { deviceId: 'asc' },
        include: CUSTOMER_INCLUDE,
      });
    });
  });

  describe('findByDeviceId', () => {
    it('query ด้วย field deviceId (ไม่ใช่ id) แล้วคืน Device', async () => {
      device.findUnique.mockResolvedValue(installedDevice);

      const result = await service.findByDeviceId('DTC-0001');

      expect(result).toEqual(installedDevice);
      expect(device.findUnique).toHaveBeenCalledWith({
        where: { deviceId: 'DTC-0001' },
        include: CUSTOMER_INCLUDE,
      });
    });

    it('ไม่พบ -> NotFoundException', async () => {
      device.findUnique.mockResolvedValue(null);

      await expect(service.findByDeviceId('NOPE')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('testConnection', () => {
    it('status installed -> เรียก tester ด้วย deviceId/model/protocol จาก DB', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      connectionTester.testConnection.mockResolvedValue(mockResult);

      const result = await service.testConnection('DTC-0001');

      expect(result).toEqual(mockResult);
      expect(connectionTester.testConnection).toHaveBeenCalledWith({
        deviceId: 'DTC-0001',
        deviceModel: 'GT06N',
        protocol: 'TCP',
      });
    });

    it('status registered -> ConflictException ไม่เรียก tester', async () => {
      device.findUnique.mockResolvedValue(registeredDevice);

      await expect(service.testConnection('DTC-0001')).rejects.toThrow(
        ConflictException,
      );
      expect(connectionTester.testConnection).not.toHaveBeenCalled();
    });

    it('status decommissioned -> ConflictException ไม่เรียก tester', async () => {
      device.findUnique.mockResolvedValue(decommissionedDevice);

      await expect(service.testConnection('DTC-0001')).rejects.toThrow(
        ConflictException,
      );
      expect(connectionTester.testConnection).not.toHaveBeenCalled();
    });

    it('ไม่พบ device -> NotFoundException ไม่เรียก tester', async () => {
      device.findUnique.mockResolvedValue(null);

      await expect(service.testConnection('NOPE')).rejects.toThrow(
        NotFoundException,
      );
      expect(connectionTester.testConnection).not.toHaveBeenCalled();
    });
  });

  describe('applyConfig', () => {
    it('device installed + config approved + รุ่นตรง -> เรียก applier ด้วย fields จาก DB', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(approvedConfig);
      configApplier.applyConfig.mockResolvedValue(applyResult);

      const result = await service.applyConfig(
        'DTC-0001',
        approvedConfig.id,
        st,
      );

      expect(result).toEqual(applyResult);
      expect(config.findUnique).toHaveBeenCalledWith({
        where: { id: approvedConfig.id },
      });
      expect(configApplier.applyConfig).toHaveBeenCalledWith({
        deviceId: 'DTC-0001',
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: { APN: 'internet' },
      });
    });

    it('AuditLog (#27) -> เขียน action apply-config หลัง applier สำเร็จ พร้อม metadata (issue #205)', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(approvedConfig);
      configApplier.applyConfig.mockResolvedValue(applyResult);

      await service.applyConfig('DTC-0001', approvedConfig.id, st);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'st-1',
          auditModule: 'device',
          action: 'apply-config',
          metadata: {
            deviceId: 'DTC-0001',
            configId: approvedConfig.id,
            fieldNames: ['APN'],
          },
        },
      });
    });

    it('AuditLog metadata.fieldNames -> เก็บแค่ชื่อ field ไม่ใช่ค่าจริง (กันข้อมูลอ่อนไหวรั่ว, issue #205)', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        fields: { APN: 'internet', COMMAND_PASSWORD: 'super-secret' },
      });
      configApplier.applyConfig.mockResolvedValue(applyResult);

      await service.applyConfig('DTC-0001', approvedConfig.id, st);

      // full object match — ถ้า implementation แอบใส่ค่าจริง (เช่น
      // "super-secret") ปนเข้ามาใน metadata การเทียบทั้ง object นี้จะ fail
      // ทันที เพราะ shape ที่คาดไว้มีแค่ fieldNames (ชื่อ) ไม่มีค่าจริงเลย
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'st-1',
          auditModule: 'device',
          action: 'apply-config',
          metadata: {
            deviceId: 'DTC-0001',
            configId: approvedConfig.id,
            fieldNames: ['APN', 'COMMAND_PASSWORD'],
          },
        },
      });
    });

    it('Campaign Monitor (#22, แก้ไข 2026-09-24) -> เรียก recordTargetResult ด้วย deviceId/configId/ผล applied/details', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(approvedConfig);
      configApplier.applyConfig.mockResolvedValue(applyResult);

      await service.applyConfig('DTC-0001', approvedConfig.id, st);

      expect(campaignRolloutService.recordTargetResult).toHaveBeenCalledWith(
        'DTC-0001',
        { configId: approvedConfig.id },
        true,
        applyResult.details.join(' · '),
      );
    });

    it('AuditLog เขียนไม่สำเร็จ -> applyConfig() ยังสำเร็จปกติ (never-throw)', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(approvedConfig);
      configApplier.applyConfig.mockResolvedValue(applyResult);
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.applyConfig('DTC-0001', approvedConfig.id, st),
      ).resolves.toEqual(applyResult);
    });

    it('config สถานะ synced ก็ apply ได้', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        status: 'synced',
      });
      configApplier.applyConfig.mockResolvedValue(applyResult);

      await expect(
        service.applyConfig('DTC-0001', approvedConfig.id, st),
      ).resolves.toEqual(applyResult);
    });

    it('device ไม่พบ -> NotFoundException ไม่เรียก applier', async () => {
      device.findUnique.mockResolvedValue(null);

      await expect(
        service.applyConfig('NOPE', approvedConfig.id, st),
      ).rejects.toThrow(NotFoundException);
      expect(configApplier.applyConfig).not.toHaveBeenCalled();
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('device registered -> ConflictException ไม่ query config', async () => {
      device.findUnique.mockResolvedValue(registeredDevice);

      await expect(
        service.applyConfig('DTC-0001', approvedConfig.id, st),
      ).rejects.toThrow(ConflictException);
      expect(config.findUnique).not.toHaveBeenCalled();
      expect(configApplier.applyConfig).not.toHaveBeenCalled();
    });

    it('config ไม่พบ -> NotFoundException ไม่เรียก applier', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(null);

      await expect(
        service.applyConfig('DTC-0001', approvedConfig.id, st),
      ).rejects.toThrow(NotFoundException);
      expect(configApplier.applyConfig).not.toHaveBeenCalled();
    });

    it('config ยัง draft -> ConflictException ไม่เรียก applier', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        status: 'draft',
      });

      await expect(
        service.applyConfig('DTC-0001', approvedConfig.id, st),
      ).rejects.toThrow(ConflictException);
      expect(configApplier.applyConfig).not.toHaveBeenCalled();
    });

    it('config คนละ deviceModel/protocol กับ device -> ConflictException', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        deviceModel: 'GT06L',
      });

      await expect(
        service.applyConfig('DTC-0001', approvedConfig.id, st),
      ).rejects.toThrow(ConflictException);
      expect(configApplier.applyConfig).not.toHaveBeenCalled();
    });

    it('config ถูก soft-delete (deletedAt ไม่ null) -> NotFoundException ไม่เรียก applier (issue #226)', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        deletedAt: new Date('2026-09-20T00:00:00.000Z'),
      });

      await expect(
        service.applyConfig('DTC-0001', approvedConfig.id, st),
      ).rejects.toThrow(NotFoundException);
      expect(configApplier.applyConfig).not.toHaveBeenCalled();
    });

    it('มี DeviceConfigOverride สถานะ approved ของ Config เดียวกัน -> merge fields ทับ base ก่อนส่งเข้า applier (issue #223/#226)', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(approvedConfig);
      deviceConfigOverride.findFirst.mockResolvedValue({
        id: 'override-1',
        deviceId: 'DTC-0001',
        configId: approvedConfig.id,
        versionNumber: 2,
        fields: { APN: 'override-internet' },
        status: 'approved',
      });
      configApplier.applyConfig.mockResolvedValue(applyResult);

      await service.applyConfig('DTC-0001', approvedConfig.id, st);

      expect(deviceConfigOverride.findFirst).toHaveBeenCalledWith({
        where: {
          deviceId: 'DTC-0001',
          configId: approvedConfig.id,
          status: 'approved',
        },
        orderBy: { versionNumber: 'desc' },
      });
      expect(configApplier.applyConfig).toHaveBeenCalledWith({
        deviceId: 'DTC-0001',
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: { APN: 'override-internet' },
      });
    });

    it('ไม่มี DeviceConfigOverride ของเครื่องนี้ -> ใช้ base Config เดิมเฉยๆ ไม่ merge อะไร', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(approvedConfig);
      deviceConfigOverride.findFirst.mockResolvedValue(null);
      configApplier.applyConfig.mockResolvedValue(applyResult);

      await service.applyConfig('DTC-0001', approvedConfig.id, st);

      expect(configApplier.applyConfig).toHaveBeenCalledWith({
        deviceId: 'DTC-0001',
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: { APN: 'internet' },
      });
    });
  });

  describe('confirmFirmwareInstall (issue #181)', () => {
    it('device installed + firmware stored/approved + รุ่นตรง -> เขียน AuditLog แล้วคืนผลสำเร็จ', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      firmware.findUnique.mockResolvedValue(readyFirmware);

      const result = await service.confirmFirmwareInstall(
        'DTC-0001',
        { firmwareId: readyFirmware.id },
        st,
      );

      expect(result).toEqual({
        deviceId: 'DTC-0001',
        firmwareId: readyFirmware.id,
        confirmedAt: expect.any(String) as string,
      });
      expect(firmware.findUnique).toHaveBeenCalledWith({
        where: { id: readyFirmware.id },
      });
      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'st-1',
          auditModule: 'device',
          action: 'confirm-firmware-install',
          metadata: {
            deviceId: 'DTC-0001',
            firmwareId: readyFirmware.id,
            firmwareVersion: readyFirmware.version,
          },
        },
      });
    });

    it('Campaign Monitor (#22, แก้ไข 2026-09-24) -> เรียก recordTargetResult ด้วย deviceId/firmwareId/success:true เสมอ', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      firmware.findUnique.mockResolvedValue(readyFirmware);

      await service.confirmFirmwareInstall(
        'DTC-0001',
        { firmwareId: readyFirmware.id },
        st,
      );

      expect(campaignRolloutService.recordTargetResult).toHaveBeenCalledWith(
        'DTC-0001',
        { firmwareId: readyFirmware.id },
        true,
        expect.any(String) as string,
      );
    });

    it('AuditLog เขียนไม่สำเร็จ -> โยน error ต่อ (ต่างจาก applyConfig — ไม่ใช่ never-throw เพราะไม่มีการกระทำอื่นให้ถือว่าสำเร็จแล้ว)', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      firmware.findUnique.mockResolvedValue(readyFirmware);
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.confirmFirmwareInstall(
          'DTC-0001',
          { firmwareId: readyFirmware.id },
          st,
        ),
      ).rejects.toThrow('DB ล่ม');
    });

    it('device ไม่พบ -> NotFoundException ไม่ query firmware', async () => {
      device.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmFirmwareInstall(
          'NOPE',
          { firmwareId: readyFirmware.id },
          st,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(firmware.findUnique).not.toHaveBeenCalled();
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('device registered (ยังไม่ติดตั้ง) -> ConflictException ไม่ query firmware', async () => {
      device.findUnique.mockResolvedValue(registeredDevice);

      await expect(
        service.confirmFirmwareInstall(
          'DTC-0001',
          { firmwareId: readyFirmware.id },
          st,
        ),
      ).rejects.toThrow(ConflictException);
      expect(firmware.findUnique).not.toHaveBeenCalled();
    });

    it('firmware ไม่พบ -> NotFoundException ไม่เขียน AuditLog', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      firmware.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmFirmwareInstall(
          'DTC-0001',
          { firmwareId: readyFirmware.id },
          st,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('firmware uploadStatus ยังไม่ stored -> ConflictException ไม่เขียน AuditLog', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      firmware.findUnique.mockResolvedValue({
        ...readyFirmware,
        uploadStatus: 'pending',
      });

      await expect(
        service.confirmFirmwareInstall(
          'DTC-0001',
          { firmwareId: readyFirmware.id },
          st,
        ),
      ).rejects.toThrow(ConflictException);
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('firmware approvalStatus ยังไม่ approved -> ConflictException ไม่เขียน AuditLog', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      firmware.findUnique.mockResolvedValue({
        ...readyFirmware,
        approvalStatus: 'pending_review',
      });

      await expect(
        service.confirmFirmwareInstall(
          'DTC-0001',
          { firmwareId: readyFirmware.id },
          st,
        ),
      ).rejects.toThrow(ConflictException);
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('firmware ไม่รองรับรุ่นอุปกรณ์ -> ConflictException ไม่เขียน AuditLog', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      firmware.findUnique.mockResolvedValue({
        ...readyFirmware,
        deviceModelCompatibility: ['GT06L'],
      });

      await expect(
        service.confirmFirmwareInstall(
          'DTC-0001',
          { firmwareId: readyFirmware.id },
          st,
        ),
      ).rejects.toThrow(ConflictException);
      expect(auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('simulateConfig', () => {
    it('device installed + config approved + รุ่นตรง -> รวม 3 check, passed:true', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(approvedConfig);
      deviceSimulator.simulateConfig.mockResolvedValue(simPass);
      connectionTester.testConnection.mockResolvedValue(connPass);

      const result = await service.simulateConfig(
        'DTC-0001',
        approvedConfig.id,
      );

      expect(result.passed).toBe(true);
      expect(result.configCheck).toEqual(simPass);
      expect(result.compatibilityCheck.passed).toBe(true);
      expect(result.connectionCheck).toEqual(connPass);
      expect(deviceSimulator.simulateConfig).toHaveBeenCalledWith({
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: { APN: 'internet' },
      });
      expect(connectionTester.testConnection).toHaveBeenCalledWith({
        deviceId: 'DTC-0001',
        deviceModel: 'GT06N',
        protocol: 'TCP',
      });
    });

    it('config synced ก็เช็คได้', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        status: 'synced',
      });
      deviceSimulator.simulateConfig.mockResolvedValue(simPass);
      connectionTester.testConnection.mockResolvedValue(connPass);

      await expect(
        service.simulateConfig('DTC-0001', approvedConfig.id),
      ).resolves.toMatchObject({ passed: true });
    });

    it('รุ่นไม่ตรง -> ไม่ throw, compatibilityCheck.passed:false + passed:false แต่ยังรัน config/connection check', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        deviceModel: 'GT06L',
      });
      deviceSimulator.simulateConfig.mockResolvedValue(simPass);
      connectionTester.testConnection.mockResolvedValue(connPass);

      const result = await service.simulateConfig(
        'DTC-0001',
        approvedConfig.id,
      );

      expect(result.passed).toBe(false);
      expect(result.compatibilityCheck.passed).toBe(false);
      expect(result.configCheck.passed).toBe(true);
      expect(result.connectionCheck.passed).toBe(true);
      expect(deviceSimulator.simulateConfig).toHaveBeenCalled();
      expect(connectionTester.testConnection).toHaveBeenCalled();
    });

    it('configCheck ไม่ผ่าน -> passed:false', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(approvedConfig);
      deviceSimulator.simulateConfig.mockResolvedValue({
        passed: false,
        details: ['ไม่มี field'],
      });
      connectionTester.testConnection.mockResolvedValue(connPass);

      const result = await service.simulateConfig(
        'DTC-0001',
        approvedConfig.id,
      );

      expect(result.passed).toBe(false);
      expect(result.compatibilityCheck.passed).toBe(true);
    });

    it('device ไม่พบ -> NotFoundException', async () => {
      device.findUnique.mockResolvedValue(null);

      await expect(
        service.simulateConfig('NOPE', approvedConfig.id),
      ).rejects.toThrow(NotFoundException);
      expect(deviceSimulator.simulateConfig).not.toHaveBeenCalled();
    });

    it('device registered -> ConflictException ไม่ query config', async () => {
      device.findUnique.mockResolvedValue(registeredDevice);

      await expect(
        service.simulateConfig('DTC-0001', approvedConfig.id),
      ).rejects.toThrow(ConflictException);
      expect(config.findUnique).not.toHaveBeenCalled();
    });

    it('config ไม่พบ -> NotFoundException', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(null);

      await expect(
        service.simulateConfig('DTC-0001', approvedConfig.id),
      ).rejects.toThrow(NotFoundException);
      expect(deviceSimulator.simulateConfig).not.toHaveBeenCalled();
    });

    it('config draft -> ConflictException (ยังไม่อนุมัติ)', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        status: 'draft',
      });

      await expect(
        service.simulateConfig('DTC-0001', approvedConfig.id),
      ).rejects.toThrow(ConflictException);
      expect(deviceSimulator.simulateConfig).not.toHaveBeenCalled();
    });

    it('config ถูก soft-delete (deletedAt ไม่ null) -> NotFoundException (issue #226)', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        deletedAt: new Date('2026-09-20T00:00:00.000Z'),
      });

      await expect(
        service.simulateConfig('DTC-0001', approvedConfig.id),
      ).rejects.toThrow(NotFoundException);
      expect(deviceSimulator.simulateConfig).not.toHaveBeenCalled();
    });

    it('มี DeviceConfigOverride สถานะ approved ของ Config เดียวกัน -> readiness check ตรวจค่าที่ override แล้ว ไม่ใช่ base เดิม (issue #223/#226)', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(approvedConfig);
      deviceConfigOverride.findFirst.mockResolvedValue({
        id: 'override-1',
        deviceId: 'DTC-0001',
        configId: approvedConfig.id,
        versionNumber: 2,
        fields: { APN: 'override-internet' },
        status: 'approved',
      });
      deviceSimulator.simulateConfig.mockResolvedValue(simPass);
      connectionTester.testConnection.mockResolvedValue(connPass);

      await service.simulateConfig('DTC-0001', approvedConfig.id);

      expect(deviceConfigOverride.findFirst).toHaveBeenCalledWith({
        where: {
          deviceId: 'DTC-0001',
          configId: approvedConfig.id,
          status: 'approved',
        },
        orderBy: { versionNumber: 'desc' },
      });
      expect(deviceSimulator.simulateConfig).toHaveBeenCalledWith({
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: { APN: 'override-internet' },
      });
    });

    it('ไม่มี DeviceConfigOverride ของเครื่องนี้ -> ใช้ base Config เดิมเฉยๆ ไม่ merge อะไร', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(approvedConfig);
      deviceConfigOverride.findFirst.mockResolvedValue(null);
      deviceSimulator.simulateConfig.mockResolvedValue(simPass);
      connectionTester.testConnection.mockResolvedValue(connPass);

      await service.simulateConfig('DTC-0001', approvedConfig.id);

      expect(deviceSimulator.simulateConfig).toHaveBeenCalledWith({
        deviceModel: 'GT06N',
        protocol: 'TCP',
        fields: { APN: 'internet' },
      });
    });
  });

  describe('getCurrentConfig', () => {
    const completedTask = {
      id: 'task-1',
      deviceId: 'DTC-0001',
      status: 'completed',
      configId: approvedConfig.id,
      updatedAt: new Date('2026-09-10T00:00:00.000Z'),
    };

    /** routes `deviceConfigOverride.findFirst` ตาม `where.status` — mirror
     * จำนวน query จริงที่ `getCurrentConfig()`/`overrideDeviceConfig()` ยิง
     * (approved / pending / ไม่ filter status เลย) เพราะทั้งคู่ใช้ mock
     * function ตัวเดียวกัน (ทั้งนอกและใน `$transaction`) */
    function mockOverrideQueries(opts: {
      approved?: unknown;
      pending?: unknown;
      anyStatus?: unknown;
    }) {
      deviceConfigOverride.findFirst.mockImplementation(
        (args: { where?: { status?: string } }) => {
          const status = args?.where?.status;
          if (status === 'approved')
            return Promise.resolve(opts.approved ?? null);
          if (status === 'pending')
            return Promise.resolve(opts.pending ?? null);
          return Promise.resolve(opts.anyStatus ?? null);
        },
      );
    }

    it('ไม่มี override เลย -> hasDeviceOverride:false, pendingOverride:null, fields เป็น base ตรงๆ', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      task.findFirst.mockResolvedValue(completedTask);
      config.findUnique.mockResolvedValue(approvedConfig);
      mockOverrideQueries({});

      const result = await service.getCurrentConfig('DTC-0001');

      expect(result).toEqual({
        ...approvedConfig,
        hasDeviceOverride: false,
        pendingOverride: null,
      });
      expect(task.findFirst).toHaveBeenCalledWith({
        where: {
          deviceId: 'DTC-0001',
          status: 'completed',
          configId: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
      });
      expect(config.findUnique).toHaveBeenCalledWith({
        where: { id: approvedConfig.id },
      });
      expect(deviceConfigOverride.findFirst).toHaveBeenCalledWith({
        where: {
          deviceId: 'DTC-0001',
          configId: approvedConfig.id,
          status: 'approved',
        },
        orderBy: { versionNumber: 'desc' },
      });
      expect(deviceConfigOverride.findFirst).toHaveBeenCalledWith({
        where: { deviceId: 'DTC-0001', status: 'pending' },
      });
    });

    it('ไม่มี Task completed ที่ผูก configId เลย -> NotFoundException', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      task.findFirst.mockResolvedValue(null);

      await expect(service.getCurrentConfig('DTC-0001')).rejects.toThrow(
        NotFoundException,
      );
      expect(config.findUnique).not.toHaveBeenCalled();
    });

    it('Task ที่เจอ configId เป็น null (query filter หลุด) -> NotFoundException ไม่ query config', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      task.findFirst.mockResolvedValue({ ...completedTask, configId: null });

      await expect(service.getCurrentConfig('DTC-0001')).rejects.toThrow(
        NotFoundException,
      );
      expect(config.findUnique).not.toHaveBeenCalled();
    });

    it('Task ผูก configId ที่ Config ถูกลบไปแล้ว (hard-deleted, findUnique -> null) -> NotFoundException', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      task.findFirst.mockResolvedValue(completedTask);
      config.findUnique.mockResolvedValue(null);

      await expect(service.getCurrentConfig('DTC-0001')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('Config ยังอยู่แต่ถูก soft-delete แล้ว (deletedAt != null, docs/11 Part A) -> NotFoundException (mirror ConfigService.findOne())', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      task.findFirst.mockResolvedValue(completedTask);
      config.findUnique.mockResolvedValue({
        ...approvedConfig,
        deletedAt: new Date('2026-09-12T00:00:00.000Z'),
      });

      await expect(service.getCurrentConfig('DTC-0001')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('device ไม่พบ -> NotFoundException ไม่ query task/config', async () => {
      device.findUnique.mockResolvedValue(null);

      await expect(service.getCurrentConfig('NOPE')).rejects.toThrow(
        NotFoundException,
      );
      expect(task.findFirst).not.toHaveBeenCalled();
      expect(config.findUnique).not.toHaveBeenCalled();
    });

    it('มี DeviceConfigOverride สถานะ approved ของ Config เดียวกัน -> merge fields ทับ base, hasDeviceOverride:true (issue #223)', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      task.findFirst.mockResolvedValue(completedTask);
      config.findUnique.mockResolvedValue(approvedConfig);
      mockOverrideQueries({
        approved: {
          id: 'ov-2',
          deviceId: 'DTC-0001',
          configId: approvedConfig.id,
          versionNumber: 2,
          fields: { APN: 'overridden-apn', EXTRA: true },
          reason: 'ทดสอบ',
          status: 'approved',
          overriddenBy: 'st-1',
          overriddenAt: new Date('2026-09-15T00:00:00.000Z'),
        },
      });

      const result = await service.getCurrentConfig('DTC-0001');

      expect(result.hasDeviceOverride).toBe(true);
      expect(result.pendingOverride).toBeNull();
      expect(result.fields).toEqual({
        APN: 'overridden-apn', // ทับค่า base 'internet'
        EXTRA: true, // field ใหม่ที่ base ไม่มี
      });
    });

    it('มีแถว pending ของเครื่องนี้ -> pendingOverride คืนแถวนั้น แต่ไม่กระทบ fields/hasDeviceOverride เลย (ยังไม่ได้อนุมัติ)', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      task.findFirst.mockResolvedValue(completedTask);
      config.findUnique.mockResolvedValue(approvedConfig);
      const pendingRow = {
        id: 'ov-3',
        deviceId: 'DTC-0001',
        configId: approvedConfig.id,
        versionNumber: 3,
        fields: { APN: 'requested-apn' },
        reason: 'ขอเปลี่ยนอีกรอบ',
        status: 'pending',
        overriddenBy: 'st-1',
        overriddenAt: new Date('2026-09-20T00:00:00.000Z'),
      };
      mockOverrideQueries({ pending: pendingRow });

      const result = await service.getCurrentConfig('DTC-0001');

      expect(result.hasDeviceOverride).toBe(false);
      expect(result.pendingOverride).toEqual(pendingRow);
      expect(result.fields).toEqual(approvedConfig.fields); // ค่ายังเป็น base เดิม
    });

    it('bug fix (comment A บน PR #225): override ผูก configId เก่า (ก่อน Confirm Install ใหม่) -> ไม่ merge เข้า Config ใหม่', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      task.findFirst.mockResolvedValue(completedTask); // ตอนนี้ผูก approvedConfig.id
      config.findUnique.mockResolvedValue(approvedConfig);
      // override เดิมผูกกับ Config คนละตัว (เช่น Config ก่อนเปลี่ยน) —
      // ไม่ควร match query ที่กรอง configId: approvedConfig.id จึงคืน null
      mockOverrideQueries({ approved: null });

      const result = await service.getCurrentConfig('DTC-0001');

      expect(result.hasDeviceOverride).toBe(false);
      expect(result.fields).toEqual(approvedConfig.fields);
      expect(deviceConfigOverride.findFirst).toHaveBeenCalledWith({
        where: {
          deviceId: 'DTC-0001',
          configId: approvedConfig.id, // กรอง configId ด้วยเสมอ — ไม่ใช่แค่ deviceId
          status: 'approved',
        },
        orderBy: { versionNumber: 'desc' },
      });
    });
  });

  describe('overrideDeviceConfig (Per-device Config Override, issue #223, มติ 2026-09-24)', () => {
    const completedTask = {
      id: 'task-1',
      deviceId: 'DTC-0001',
      status: 'completed',
      configId: approvedConfig.id,
      updatedAt: new Date('2026-09-10T00:00:00.000Z'),
    };
    const dto = { fields: { APN: 'new-apn' }, reason: 'ลูกค้าขอเปลี่ยนค่า' };

    /** routes `deviceConfigOverride.findFirst` (ใช้ตัวเดียวกันทั้งนอกและใน
     * `$transaction`) ตาม `where.status` — `overrideDeviceConfig()` ยิง 3
     * query ต่อครั้ง: existingPending (`status: 'pending'`), previousApproved
     * (`status: 'approved'`), latestVersion (ไม่ filter status เลย) */
    function mockOverrideQueries(opts: {
      existingPending?: unknown;
      previousApproved?: unknown;
      latestVersion?: unknown;
    }) {
      deviceConfigOverride.findFirst.mockImplementation(
        (args: { where?: { status?: string } }) => {
          const status = args?.where?.status;
          if (status === 'pending')
            return Promise.resolve(opts.existingPending ?? null);
          if (status === 'approved')
            return Promise.resolve(opts.previousApproved ?? null);
          return Promise.resolve(opts.latestVersion ?? null);
        },
      );
    }

    beforeEach(() => {
      device.findUnique.mockResolvedValue(installedDevice);
      task.findFirst.mockResolvedValue(completedTask);
      config.findUnique.mockResolvedValue(approvedConfig);
      mockOverrideQueries({});
    });

    it('ไม่มี override เดิม -> สร้าง versionNumber 1 สถานะ pending, fields = dto.fields ตรงๆ, คืนแถวที่สร้าง', async () => {
      deviceConfigOverride.create.mockResolvedValue({
        id: 'ov-1',
        deviceId: 'DTC-0001',
        configId: approvedConfig.id,
        versionNumber: 1,
        fields: dto.fields,
        reason: dto.reason,
        status: 'pending',
        overriddenBy: 'st-1',
        overriddenAt: new Date('2026-09-16T00:00:00.000Z'),
      });

      const result = await service.overrideDeviceConfig('DTC-0001', dto, st);

      expect(validateOverridableFields).toHaveBeenCalledWith(
        'GT06N',
        'TCP',
        dto.fields,
      );
      expect(deviceConfigOverride.create).toHaveBeenCalledWith({
        data: {
          deviceId: 'DTC-0001',
          configId: approvedConfig.id,
          versionNumber: 1,
          fields: dto.fields,
          reason: dto.reason,
          overriddenBy: 'st-1',
          status: 'pending',
        },
      });
      expect(result.status).toBe('pending');
      expect(result.fields).toEqual({ APN: 'new-apn' });
    });

    it('มีคำขอ pending ของเครื่องนี้อยู่แล้ว -> ConflictException (409), ไม่สร้างแถวใหม่/AuditLog', async () => {
      mockOverrideQueries({
        existingPending: { id: 'ov-pending', status: 'pending' },
      });

      await expect(
        service.overrideDeviceConfig('DTC-0001', dto, st),
      ).rejects.toThrow(ConflictException);
      expect(deviceConfigOverride.create).not.toHaveBeenCalled();
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('มี override approved เดิมของ Config เดียวกัน -> versionNumber +1, fields สะสม (merge approved เดิม+dto ใหม่)', async () => {
      mockOverrideQueries({
        previousApproved: {
          id: 'ov-1',
          versionNumber: 1,
          fields: { REPORT_INTERVAL_MOVING: 60 },
          status: 'approved',
        },
        latestVersion: { id: 'ov-1', versionNumber: 1 },
      });
      deviceConfigOverride.create.mockResolvedValue({
        id: 'ov-2',
        deviceId: 'DTC-0001',
        configId: approvedConfig.id,
        versionNumber: 2,
        fields: { REPORT_INTERVAL_MOVING: 60, APN: 'new-apn' },
        reason: dto.reason,
        status: 'pending',
        overriddenBy: 'st-1',
        overriddenAt: new Date('2026-09-16T00:00:00.000Z'),
      });

      const result = await service.overrideDeviceConfig('DTC-0001', dto, st);

      expect(deviceConfigOverride.create).toHaveBeenCalledWith({
        data: {
          deviceId: 'DTC-0001',
          configId: approvedConfig.id,
          versionNumber: 2,
          fields: { REPORT_INTERVAL_MOVING: 60, APN: 'new-apn' },
          reason: dto.reason,
          overriddenBy: 'st-1',
          status: 'pending',
        },
      });
      // field จาก override approved รอบก่อน (REPORT_INTERVAL_MOVING) ต้องยังอยู่
      // ในคำขอใหม่ ไม่หายไปเงียบๆ แม้ dto รอบนี้จะไม่ได้แตะ field นั้นเลย
      expect(result.fields).toEqual({
        APN: 'new-apn',
        REPORT_INTERVAL_MOVING: 60,
      });
    });

    it('bug fix (comment A บน PR #225): มี override approved ของ Config คนละตัว (เก่า) -> ไม่สะสมค่านั้นเข้าคำขอใหม่', async () => {
      // previousApproved คืน null เพราะ query กรอง configId: approvedConfig.id
      // (Config ปัจจุบัน) — override เก่าผูกกับ Config อื่นจึงไม่ match
      mockOverrideQueries({ previousApproved: null, latestVersion: null });
      deviceConfigOverride.create.mockResolvedValue({
        id: 'ov-1',
        fields: dto.fields,
        versionNumber: 1,
        status: 'pending',
      });

      await service.overrideDeviceConfig('DTC-0001', dto, st);

      expect(deviceConfigOverride.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ fields: dto.fields }) as unknown, // ไม่มี field เก่าติดมา
      });
    });

    it('versionNumber นับจากทุกสถานะ (รวม rejected) ไม่ใช่แค่ approved — กัน @@unique ชนกับแถวที่เคยถูก reject', async () => {
      mockOverrideQueries({
        previousApproved: null, // ไม่มี approved เลย (แถวก่อนหน้าถูก reject ไป)
        latestVersion: { id: 'ov-1', versionNumber: 1, status: 'rejected' },
      });
      deviceConfigOverride.create.mockResolvedValue({
        id: 'ov-2',
        versionNumber: 2,
        fields: dto.fields,
        status: 'pending',
      });

      await service.overrideDeviceConfig('DTC-0001', dto, st);

      expect(deviceConfigOverride.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ versionNumber: 2 }) as unknown,
      });
    });

    it('เขียน AuditLog ในทรานแซกชันเดียวกัน action device-config-override-request พร้อม fieldNames ของรอบนี้เท่านั้น', async () => {
      deviceConfigOverride.create.mockResolvedValue({
        id: 'ov-1',
        fields: dto.fields,
        versionNumber: 1,
        status: 'pending',
      });

      await service.overrideDeviceConfig('DTC-0001', dto, st);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'st-1',
          auditModule: 'device',
          action: 'device-config-override-request',
          metadata: {
            deviceId: 'DTC-0001',
            configId: approvedConfig.id,
            fieldNames: ['APN'],
          },
        },
      });
    });

    it('Prisma P2002 (race condition หลุดผ่าน existingPending check มาได้) -> ConflictException แทนที่จะเป็น 500', async () => {
      deviceConfigOverride.create.mockRejectedValue(
        new PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.overrideDeviceConfig('DTC-0001', dto, st),
      ).rejects.toThrow(ConflictException);
    });

    it('field ไม่ผ่าน validateOverridableFields (stOverridable:false) -> throw, ไม่สร้าง override/AuditLog', async () => {
      validateOverridableFields.mockRejectedValue(
        new Error('field "COMMAND_PASSWORD" ไม่อนุญาตให้ override'),
      );

      await expect(
        service.overrideDeviceConfig('DTC-0001', dto, st),
      ).rejects.toThrow();
      expect(deviceConfigOverride.create).not.toHaveBeenCalled();
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('อุปกรณ์ยังไม่เคย Confirm Install (ไม่มี base config) -> NotFoundException เดียวกับ getCurrentConfig', async () => {
      task.findFirst.mockResolvedValue(null);

      await expect(
        service.overrideDeviceConfig('DTC-0001', dto, st),
      ).rejects.toThrow(NotFoundException);
      expect(validateOverridableFields).not.toHaveBeenCalled();
      expect(deviceConfigOverride.create).not.toHaveBeenCalled();
    });

    it('device ไม่พบ -> NotFoundException ไม่ query อะไรต่อ', async () => {
      device.findUnique.mockResolvedValue(null);

      await expect(
        service.overrideDeviceConfig('NOPE', dto, st),
      ).rejects.toThrow(NotFoundException);
      expect(task.findFirst).not.toHaveBeenCalled();
      expect(validateOverridableFields).not.toHaveBeenCalled();
    });
  });

  describe('approveDeviceConfigOverride / rejectDeviceConfigOverride (Operation, issue #223)', () => {
    const pendingRow = {
      id: 'ov-1',
      deviceId: 'DTC-0001',
      configId: approvedConfig.id,
      versionNumber: 1,
      fields: { APN: 'new-apn' },
      reason: 'ลูกค้าขอเปลี่ยนค่า',
      status: 'pending',
      overriddenBy: 'st-1',
      overriddenAt: new Date('2026-09-16T00:00:00.000Z'),
      decidedBy: null,
      decidedAt: null,
      rejectReason: null,
    };

    describe('approveDeviceConfigOverride', () => {
      /** approve เรียก `getBaseConfigForDevice()` เพิ่ม (comment A รอบ 2 บน
       * PR #225 — เช็ค configId staleness) mock ให้ resolve เป็น Config
       * เดียวกับ `pendingRow.configId` เป็นค่า default ของกลุ่มนี้ */
      function mockBaseConfigMatches(): void {
        device.findUnique.mockResolvedValue(installedDevice);
        task.findFirst.mockResolvedValue({
          id: 'task-1',
          deviceId: 'DTC-0001',
          status: 'completed',
          configId: approvedConfig.id,
          updatedAt: new Date('2026-09-10T00:00:00.000Z'),
        });
        config.findUnique.mockResolvedValue(approvedConfig);
      }

      it('คำขอยัง pending, configId ตรงกับ Config ปัจจุบัน -> อัปเดตเป็น approved พร้อม decidedBy/decidedAt + AuditLog', async () => {
        deviceConfigOverride.findUnique.mockResolvedValue(pendingRow);
        mockBaseConfigMatches();
        deviceConfigOverride.updateMany.mockResolvedValue({ count: 1 });
        deviceConfigOverride.findUniqueOrThrow.mockResolvedValue({
          ...pendingRow,
          status: 'approved',
          decidedBy: 'op-1',
          decidedAt: new Date('2026-09-17T00:00:00.000Z'),
        });

        const result = await service.approveDeviceConfigOverride(
          'ov-1',
          operation,
        );

        expect(result.status).toBe('approved');
        expect(deviceConfigOverride.updateMany).toHaveBeenCalledWith({
          where: { id: 'ov-1', status: 'pending' },
          data: expect.objectContaining({
            status: 'approved',
            decidedBy: 'op-1',
          }) as unknown,
        });
        expect(auditLog.create).toHaveBeenCalledWith({
          data: {
            userId: 'op-1',
            auditModule: 'device',
            action: 'device-config-override-approve',
            metadata: {
              deviceId: 'DTC-0001',
              configId: approvedConfig.id,
            },
          },
        });
      });

      it('ไม่พบคำขอ -> NotFoundException', async () => {
        deviceConfigOverride.findUnique.mockResolvedValue(null);

        await expect(
          service.approveDeviceConfigOverride('nope', operation),
        ).rejects.toThrow(NotFoundException);
        expect(deviceConfigOverride.updateMany).not.toHaveBeenCalled();
      });

      it('คำขอถูกตัดสินใจไปแล้ว (approved/rejected) -> ConflictException กันตัดสินใจซ้ำ', async () => {
        deviceConfigOverride.findUnique.mockResolvedValue({
          ...pendingRow,
          status: 'approved',
        });

        await expect(
          service.approveDeviceConfigOverride('ov-1', operation),
        ).rejects.toThrow(ConflictException);
        expect(deviceConfigOverride.updateMany).not.toHaveBeenCalled();
      });

      it('bug fix (comment A รอบ 2 บน PR #225): configId ของคำขอไม่ตรงกับ Config ปัจจุบันของอุปกรณ์แล้ว (มี Confirm Install ใหม่ทับระหว่างรออนุมัติ) -> ConflictException ไม่ update', async () => {
        deviceConfigOverride.findUnique.mockResolvedValue(pendingRow);
        device.findUnique.mockResolvedValue(installedDevice);
        task.findFirst.mockResolvedValue({
          id: 'task-2',
          deviceId: 'DTC-0001',
          status: 'completed',
          configId: 'cfg-new-different',
          updatedAt: new Date('2026-09-20T00:00:00.000Z'),
        });
        config.findUnique.mockResolvedValue({
          ...approvedConfig,
          id: 'cfg-new-different',
        });

        await expect(
          service.approveDeviceConfigOverride('ov-1', operation),
        ).rejects.toThrow(ConflictException);
        expect(deviceConfigOverride.updateMany).not.toHaveBeenCalled();
      });

      it('race condition (comment A รอบ 2 บน PR #225): มีคนอื่นตัดสินใจคำขอนี้ไปแล้วระหว่างรอ (updateMany count 0) -> ConflictException', async () => {
        deviceConfigOverride.findUnique.mockResolvedValue(pendingRow);
        mockBaseConfigMatches();
        deviceConfigOverride.updateMany.mockResolvedValue({ count: 0 });

        await expect(
          service.approveDeviceConfigOverride('ov-1', operation),
        ).rejects.toThrow(ConflictException);
        expect(auditLog.create).not.toHaveBeenCalled();
      });
    });

    describe('rejectDeviceConfigOverride', () => {
      it('คำขอยัง pending -> อัปเดตเป็น rejected พร้อม rejectReason + AuditLog', async () => {
        deviceConfigOverride.findUnique.mockResolvedValue(pendingRow);
        deviceConfigOverride.updateMany.mockResolvedValue({ count: 1 });
        deviceConfigOverride.findUniqueOrThrow.mockResolvedValue({
          ...pendingRow,
          status: 'rejected',
          decidedBy: 'op-1',
          rejectReason: 'ไม่เหมาะสมกับสถานการณ์หน้างาน',
        });

        const result = await service.rejectDeviceConfigOverride(
          'ov-1',
          { rejectReason: 'ไม่เหมาะสมกับสถานการณ์หน้างาน' },
          operation,
        );

        expect(result.status).toBe('rejected');
        expect(deviceConfigOverride.updateMany).toHaveBeenCalledWith({
          where: { id: 'ov-1', status: 'pending' },
          data: expect.objectContaining({
            status: 'rejected',
            rejectReason: 'ไม่เหมาะสมกับสถานการณ์หน้างาน',
          }) as unknown,
        });
        expect(auditLog.create).toHaveBeenCalledWith({
          data: {
            userId: 'op-1',
            auditModule: 'device',
            action: 'device-config-override-reject',
            metadata: {
              deviceId: 'DTC-0001',
              configId: approvedConfig.id,
            },
          },
        });
      });

      it('ไม่ส่ง rejectReason มา -> เขียนเป็น null (ไม่บังคับ)', async () => {
        deviceConfigOverride.findUnique.mockResolvedValue(pendingRow);
        deviceConfigOverride.updateMany.mockResolvedValue({ count: 1 });
        deviceConfigOverride.findUniqueOrThrow.mockResolvedValue({
          ...pendingRow,
          status: 'rejected',
        });

        await service.rejectDeviceConfigOverride('ov-1', {}, operation);

        expect(deviceConfigOverride.updateMany).toHaveBeenCalledWith({
          where: { id: 'ov-1', status: 'pending' },
          data: expect.objectContaining({ rejectReason: null }) as unknown,
        });
      });

      it('คำขอถูกตัดสินใจไปแล้ว -> ConflictException', async () => {
        deviceConfigOverride.findUnique.mockResolvedValue({
          ...pendingRow,
          status: 'rejected',
        });

        await expect(
          service.rejectDeviceConfigOverride('ov-1', {}, operation),
        ).rejects.toThrow(ConflictException);
        expect(deviceConfigOverride.updateMany).not.toHaveBeenCalled();
      });

      it('race condition (comment A รอบ 2 บน PR #225): มีคนอื่นตัดสินใจคำขอนี้ไปแล้วระหว่างรอ (updateMany count 0) -> ConflictException', async () => {
        deviceConfigOverride.findUnique.mockResolvedValue(pendingRow);
        deviceConfigOverride.updateMany.mockResolvedValue({ count: 0 });

        await expect(
          service.rejectDeviceConfigOverride('ov-1', {}, operation),
        ).rejects.toThrow(ConflictException);
        expect(auditLog.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('listDeviceConfigOverrides (Operation, issue #223)', () => {
    it('ไม่ระบุ status -> ไม่ filter, เรียงตาม overriddenAt desc', async () => {
      deviceConfigOverride.findMany.mockResolvedValue([]);

      await service.listDeviceConfigOverrides();

      expect(deviceConfigOverride.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { overriddenAt: 'desc' },
      });
    });

    it('ระบุ status: pending -> filter ตาม status', async () => {
      deviceConfigOverride.findMany.mockResolvedValue([]);

      await service.listDeviceConfigOverrides('pending');

      expect(deviceConfigOverride.findMany).toHaveBeenCalledWith({
        where: { status: 'pending' },
        orderBy: { overriddenAt: 'desc' },
      });
    });
  });
});
