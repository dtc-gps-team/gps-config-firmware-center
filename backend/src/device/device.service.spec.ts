import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Config, Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEVICE_SIMULATOR, DeviceSimulator } from '../config/device-simulator';
import { CONFIG_APPLIER, ConfigApplier } from './config-applier';
import {
  DEVICE_CONNECTION_TESTER,
  DeviceConnectionTester,
} from './device-connection-tester';
import { ActingUser, DeviceService } from './device.service';

const installedDevice: Device = {
  id: '11111111-1111-1111-1111-111111111111',
  deviceId: 'DTC-0001',
  simNumber: '0899999999',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'installed',
  registeredAt: new Date('2026-01-01T00:00:00.000Z'),
  installedAt: new Date('2026-01-02T00:00:00.000Z'),
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
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const applyResult = {
  applied: true,
  details: ['ส่ง Config แล้ว (mock)'],
  appliedAt: '2026-09-04T10:00:00.000Z',
};

const st: ActingUser = { id: 'st-1', role: 'ST' };

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
  let auditLog: { create: jest.Mock };
  let connectionTester: jest.Mocked<DeviceConnectionTester>;
  let configApplier: jest.Mocked<ConfigApplier>;
  let deviceSimulator: jest.Mocked<DeviceSimulator>;

  beforeEach(async () => {
    device = { findUnique: jest.fn(), findMany: jest.fn() };
    config = { findUnique: jest.fn() };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };
    connectionTester = { testConnection: jest.fn() };
    configApplier = { applyConfig: jest.fn() };
    deviceSimulator = { simulateConfig: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceService,
        { provide: PrismaService, useValue: { device, config, auditLog } },
        { provide: DEVICE_CONNECTION_TESTER, useValue: connectionTester },
        { provide: CONFIG_APPLIER, useValue: configApplier },
        { provide: DEVICE_SIMULATOR, useValue: deviceSimulator },
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
        },
        orderBy: { deviceId: 'asc' },
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
        },
        orderBy: { deviceId: 'asc' },
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
          OR: [
            { deviceId: { contains: '0001', mode: 'insensitive' } },
            { simNumber: { contains: '0001', mode: 'insensitive' } },
          ],
        },
        orderBy: { deviceId: 'asc' },
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

    it('AuditLog (#27) -> เขียน action apply-config หลัง applier สำเร็จ', async () => {
      device.findUnique.mockResolvedValue(installedDevice);
      config.findUnique.mockResolvedValue(approvedConfig);
      configApplier.applyConfig.mockResolvedValue(applyResult);

      await service.applyConfig('DTC-0001', approvedConfig.id, st);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'st-1',
          auditModule: 'device',
          action: 'apply-config',
        },
      });
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
  });
});
