import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEVICE_CONNECTION_TESTER,
  DeviceConnectionTester,
} from './device-connection-tester';
import { DeviceService } from './device.service';

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

describe('DeviceService', () => {
  let service: DeviceService;
  let device: { findUnique: jest.Mock };
  let connectionTester: jest.Mocked<DeviceConnectionTester>;

  beforeEach(async () => {
    device = { findUnique: jest.fn() };
    connectionTester = { testConnection: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceService,
        { provide: PrismaService, useValue: { device } },
        { provide: DEVICE_CONNECTION_TESTER, useValue: connectionTester },
      ],
    }).compile();

    service = module.get(DeviceService);
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
});
