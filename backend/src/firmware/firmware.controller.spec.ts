import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Firmware } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { PrismaService } from '../prisma/prisma.service';
import { FirmwareController } from './firmware.controller';
import { FirmwareService } from './firmware.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

function reqAs(user: JwtPayload): AuthenticatedRequest {
  return { user } as AuthenticatedRequest;
}

const JWT_SECRET = 'test-secret';
const firmwareEngineerReq = reqAs({ sub: 'fe-1', role: 'FirmwareEngineer' });
const qaEngineerReq = reqAs({ sub: 'qa-1', role: 'QAEngineer' });

const sampleFirmware: Firmware = {
  id: 'fw-1',
  version: 'GT06N-v2.4.1',
  deviceModelCompatibility: ['GT06N'],
  uploadStatus: 'stored',
  deviceUpdateStatus: 'unknown',
  objectKey: 'firmware/fw-1/gt06n.bin',
  originalFilename: 'gt06n.bin',
  fileSizeBytes: 1024,
  uploadedBy: 'fe-1',
  uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
  approvalStatus: 'pending_review',
  approvedBy: null,
};

describe('FirmwareController', () => {
  let controller: FirmwareController;
  let service: {
    findAll: jest.Mock;
    upload: jest.Mock;
    findOne: jest.Mock;
    updateCompatibility: jest.Mock;
    simulate: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      upload: jest.fn(),
      findOne: jest.fn(),
      updateCompatibility: jest.fn(),
      simulate: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FirmwareController],
      providers: [
        { provide: FirmwareService, useValue: service },
        {
          provide: JwtService,
          useValue: new JwtService({ secret: JWT_SECRET }),
        },
        { provide: PrismaService, useValue: {} },
        JwtAuthGuard,
        PermissionGuard,
      ],
    }).compile();

    controller = module.get(FirmwareController);
  });

  it('GET /firmware -> service.findAll', async () => {
    service.findAll.mockResolvedValue([sampleFirmware]);

    const result = await controller.findAll();

    expect(result).toEqual([sampleFirmware]);
  });

  it('POST /firmware -> service.upload พร้อม actor จาก JWT', async () => {
    service.upload.mockResolvedValue(sampleFirmware);
    const file = { originalname: 'gt06n.bin' } as Express.Multer.File;

    const result = await controller.upload(
      file,
      'v1',
      'GT06N',
      firmwareEngineerReq,
    );

    expect(result).toEqual(sampleFirmware);
    expect(service.upload).toHaveBeenCalledWith(file, 'v1', 'GT06N', {
      id: 'fe-1',
      role: 'FirmwareEngineer',
    });
  });

  it('GET /firmware/:id -> service.findOne', async () => {
    service.findOne.mockResolvedValue(sampleFirmware);

    const result = await controller.findOne(sampleFirmware.id);

    expect(result).toEqual(sampleFirmware);
  });

  it('PATCH /firmware/:id -> service.updateCompatibility พร้อม actor จาก JWT', async () => {
    service.updateCompatibility.mockResolvedValue(sampleFirmware);
    const dto = { deviceModelCompatibility: ['GT06N', 'GT06L'] };

    const result = await controller.updateCompatibility(
      sampleFirmware.id,
      dto,
      firmwareEngineerReq,
    );

    expect(result).toEqual(sampleFirmware);
    expect(service.updateCompatibility).toHaveBeenCalledWith(
      sampleFirmware.id,
      dto,
      { id: 'fe-1', role: 'FirmwareEngineer' },
    );
  });

  it('POST /firmware/:id/simulate -> service.simulate', async () => {
    service.simulate.mockResolvedValue({ passed: true, details: ['ok'] });

    const result = await controller.simulate(sampleFirmware.id, {
      deviceModel: 'GT06N',
    });

    expect(result).toEqual({ passed: true, details: ['ok'] });
    expect(service.simulate).toHaveBeenCalledWith(sampleFirmware.id, 'GT06N');
  });

  it('POST /firmware/:id/approve -> service.approve พร้อม actor จาก JWT', async () => {
    const approved = { ...sampleFirmware, approvalStatus: 'approved' as const };
    service.approve.mockResolvedValue(approved);

    const result = await controller.approve(sampleFirmware.id, qaEngineerReq);

    expect(result).toEqual(approved);
    expect(service.approve).toHaveBeenCalledWith(sampleFirmware.id, {
      id: 'qa-1',
      role: 'QAEngineer',
    });
  });

  it('POST /firmware/:id/reject -> service.reject พร้อม actor จาก JWT', async () => {
    const rejected = { ...sampleFirmware, approvalStatus: 'rejected' as const };
    service.reject.mockResolvedValue(rejected);

    const result = await controller.reject(sampleFirmware.id, qaEngineerReq);

    expect(result).toEqual(rejected);
    expect(service.reject).toHaveBeenCalledWith(sampleFirmware.id, {
      id: 'qa-1',
      role: 'QAEngineer',
    });
  });
});
