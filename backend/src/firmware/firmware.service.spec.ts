import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Firmware } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser, FirmwareService } from './firmware.service';
import { FirmwareStorageService } from './firmware-storage.service';
import { FIRMWARE_SIMULATOR } from './firmware-simulator';

const actor: ActingUser = { id: 'sw-1', role: 'SW' };

const sampleFirmware: Firmware = {
  id: 'fw-1',
  version: 'GT06N-v2.4.1',
  deviceModelCompatibility: ['GT06N'],
  uploadStatus: 'stored',
  deviceUpdateStatus: 'unknown',
  objectKey: 'firmware/fw-1/gt06n.bin',
  originalFilename: 'gt06n.bin',
  fileSizeBytes: 1024,
  uploadedBy: actor.id,
  uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makeFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'gt06n.bin',
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    buffer: Buffer.from('firmware bytes'),
    size: 1024,
    ...overrides,
  } as Express.Multer.File;
}

describe('FirmwareService', () => {
  let service: FirmwareService;
  let firmware: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  let auditLog: { create: jest.Mock };
  let storage: { uploadObject: jest.Mock };
  let simulator: { simulateFirmware: jest.Mock };

  beforeEach(async () => {
    firmware = {
      create: jest.fn().mockResolvedValue(sampleFirmware),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };
    storage = { uploadObject: jest.fn().mockResolvedValue(undefined) };
    simulator = { simulateFirmware: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FirmwareService,
        { provide: PrismaService, useValue: { firmware, auditLog } },
        { provide: FirmwareStorageService, useValue: storage },
        { provide: FIRMWARE_SIMULATOR, useValue: simulator },
      ],
    }).compile();

    service = module.get(FirmwareService);
  });

  describe('upload', () => {
    it('อัปโหลดสำเร็จ -> สร้าง Firmware สถานะ stored พร้อม compatibility เริ่มต้น 1 รุ่น', async () => {
      const result = await service.upload(
        makeFile(),
        'GT06N-v2.4.1',
        'GT06N',
        actor,
      );

      expect(result).toEqual(sampleFirmware);

      expect(storage.uploadObject).toHaveBeenCalledTimes(1);
      const uploadCalls = storage.uploadObject.mock.calls as unknown[][];
      const uploadCall = uploadCalls[0][0] as {
        key: string;
        body: Buffer;
        contentType?: string;
      };
      expect(uploadCall.key).toMatch(/^firmware\/.+\/gt06n\.bin$/);
      expect(uploadCall.body).toBeInstanceOf(Buffer);
      expect(uploadCall.contentType).toBe('application/octet-stream');

      expect(firmware.create).toHaveBeenCalledTimes(1);
      const createCalls = firmware.create.mock.calls as unknown[][];
      const createCall = createCalls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(createCall.data).toMatchObject({
        version: 'GT06N-v2.4.1',
        deviceModelCompatibility: ['GT06N'],
        uploadStatus: 'stored',
        originalFilename: 'gt06n.bin',
        fileSizeBytes: 1024,
        uploadedBy: actor.id,
      });
    });

    it('เขียน AuditLog action create หลังอัปโหลดสำเร็จ', async () => {
      await service.upload(makeFile(), 'v1', 'GT06N', actor);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: actor.id, auditModule: 'firmware', action: 'create' },
      });
    });

    it('Object Storage ล้มเหลว -> สร้าง Firmware สถานะ failed แทนที่จะ throw', async () => {
      storage.uploadObject.mockRejectedValue(new Error('S3 down'));

      const result = await service.upload(makeFile(), 'v1', 'GT06N', actor);

      expect(result).toEqual(sampleFirmware); // mock create ยัง resolve ค่าเดิม
      const createCalls = firmware.create.mock.calls as unknown[][];
      const createCall = createCalls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(createCall.data).toMatchObject({ uploadStatus: 'failed' });
    });

    it('Object Storage ล้มเหลว -> ยังเขียน AuditLog เหมือนเดิม (การสร้าง record คือ mutation จริง)', async () => {
      storage.uploadObject.mockRejectedValue(new Error('S3 down'));

      await service.upload(makeFile(), 'v1', 'GT06N', actor);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: actor.id, auditModule: 'firmware', action: 'create' },
      });
    });

    it('AuditLog เขียนไม่สำเร็จ -> upload() ยังสำเร็จปกติ (never-throw)', async () => {
      auditLog.create.mockRejectedValue(new Error('DB ล่ม'));

      await expect(
        service.upload(makeFile(), 'v1', 'GT06N', actor),
      ).resolves.toEqual(sampleFirmware);
    });

    it('ไม่มีไฟล์ -> BadRequestException', async () => {
      await expect(
        service.upload(undefined, 'v1', 'GT06N', actor),
      ).rejects.toThrow(BadRequestException);
      expect(firmware.create).not.toHaveBeenCalled();
    });

    it('ไม่ระบุ version -> BadRequestException', async () => {
      await expect(
        service.upload(makeFile(), '  ', 'GT06N', actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('ไม่ระบุ deviceModel -> BadRequestException', async () => {
      await expect(
        service.upload(makeFile(), 'v1', undefined, actor),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateCompatibility', () => {
    it('แทนที่ deviceModelCompatibility ทั้ง array', async () => {
      firmware.findUnique.mockResolvedValue(sampleFirmware);
      firmware.update.mockResolvedValue({
        ...sampleFirmware,
        deviceModelCompatibility: ['GT06N', 'GT06L'],
      });

      const result = await service.updateCompatibility(
        sampleFirmware.id,
        { deviceModelCompatibility: ['GT06N', 'GT06L'] },
        actor,
      );

      expect(result.deviceModelCompatibility).toEqual(['GT06N', 'GT06L']);
      expect(firmware.update).toHaveBeenCalledWith({
        where: { id: sampleFirmware.id },
        data: { deviceModelCompatibility: ['GT06N', 'GT06L'] },
      });
    });

    it('เขียน AuditLog action update', async () => {
      firmware.findUnique.mockResolvedValue(sampleFirmware);
      firmware.update.mockResolvedValue(sampleFirmware);

      await service.updateCompatibility(
        sampleFirmware.id,
        { deviceModelCompatibility: ['GT06N'] },
        actor,
      );

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: actor.id, auditModule: 'firmware', action: 'update' },
      });
    });

    it('ไม่พบ Firmware -> NotFoundException', async () => {
      firmware.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCompatibility(
          'missing-id',
          { deviceModelCompatibility: ['GT06N'] },
          actor,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(firmware.update).not.toHaveBeenCalled();
    });
  });

  describe('simulate', () => {
    it('uploadStatus stored -> เรียก simulator แล้วคืนผล', async () => {
      firmware.findUnique.mockResolvedValue(sampleFirmware);
      simulator.simulateFirmware.mockResolvedValue({
        passed: true,
        details: ['ok'],
      });

      const result = await service.simulate(sampleFirmware.id, 'GT06N');

      expect(result).toEqual({ passed: true, details: ['ok'] });
      expect(simulator.simulateFirmware).toHaveBeenCalledWith({
        deviceModel: 'GT06N',
        deviceModelCompatibility: ['GT06N'],
      });
    });

    it('uploadStatus ไม่ใช่ stored (pending) -> ConflictException', async () => {
      firmware.findUnique.mockResolvedValue({
        ...sampleFirmware,
        uploadStatus: 'pending',
      });

      await expect(
        service.simulate(sampleFirmware.id, 'GT06N'),
      ).rejects.toThrow(ConflictException);
      expect(simulator.simulateFirmware).not.toHaveBeenCalled();
    });

    it('ไม่พบ Firmware -> NotFoundException', async () => {
      firmware.findUnique.mockResolvedValue(null);

      await expect(service.simulate('missing-id', 'GT06N')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('คืนรายการเรียงตาม uploadedAt desc', async () => {
      firmware.findMany.mockResolvedValue([sampleFirmware]);

      const result = await service.findAll();

      expect(result).toEqual([sampleFirmware]);
      expect(firmware.findMany).toHaveBeenCalledWith({
        orderBy: { uploadedAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('เจอ -> คืน Firmware', async () => {
      firmware.findUnique.mockResolvedValue(sampleFirmware);

      const result = await service.findOne(sampleFirmware.id);

      expect(result).toEqual(sampleFirmware);
    });

    it('ไม่เจอ -> NotFoundException', async () => {
      firmware.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
