import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Campaign, CampaignPayloadType } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';

const JWT_SECRET = 'test-secret';

type AuthenticatedRequest = Request & { user: JwtPayload };

function reqAs(user: JwtPayload): AuthenticatedRequest {
  return { user } as AuthenticatedRequest;
}

const opReq = reqAs({ sub: 'op-1', role: 'Operation' });

const sampleCampaign: Campaign = {
  id: 'campaign-1',
  name: 'แคมเปญทดสอบ',
  description: null,
  payloadType: CampaignPayloadType.Config,
  configId: 'cfg-1',
  firmwareId: null,
  status: 'active',
  targetCount: 1,
  successCount: 0,
  failureCount: 0,
  createdBy: 'op-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('CampaignController', () => {
  let controller: CampaignController;
  let service: { findAll: jest.Mock; create: jest.Mock; findOne: jest.Mock };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CampaignController],
      providers: [
        { provide: CampaignService, useValue: service },
        // pattern เดียวกับ config.controller.spec.ts — provide JwtService ตรงๆ
        // ให้ JwtAuthGuard inject ได้, และ PrismaService stub ให้ PermissionGuard
        // inject ได้ (ไม่มี method ไหนถูกเรียกจริงในเทสนี้ เพราะเรียก controller
        // method ตรงๆ ไม่ผ่าน HTTP guard chain — ดู campaign-http.integration-spec.ts
        // สำหรับเทสที่พิสูจน์ guard จริง)
        {
          provide: JwtService,
          useValue: new JwtService({ secret: JWT_SECRET }),
        },
        { provide: PrismaService, useValue: {} },
        JwtAuthGuard,
        PermissionGuard,
      ],
    }).compile();

    controller = module.get(CampaignController);
  });

  it('GET /campaigns -> service.findAll พร้อม query', async () => {
    service.findAll.mockResolvedValue([sampleCampaign]);

    const result = await controller.findAll({ status: 'active' });

    expect(result).toEqual([sampleCampaign]);
    expect(service.findAll).toHaveBeenCalledWith({ status: 'active' });
  });

  it('POST /campaigns -> service.create พร้อม actor จาก JWT', async () => {
    service.create.mockResolvedValue(sampleCampaign);
    const dto: CreateCampaignDto = {
      name: 'แคมเปญทดสอบ',
      payloadType: CampaignPayloadType.Config,
      configId: 'cfg-1',
      targets: [{ deviceId: 'DEV-0001', assignedTo: 'tech-1' }],
    };

    const result = await controller.create(dto, opReq);

    expect(result).toEqual(sampleCampaign);
    expect(service.create).toHaveBeenCalledWith(dto, {
      id: 'op-1',
      role: 'Operation',
    });
  });

  it('GET /campaigns/:id -> service.findOne', async () => {
    service.findOne.mockResolvedValue(sampleCampaign);

    const result = await controller.findOne(sampleCampaign.id);

    expect(result).toEqual(sampleCampaign);
    expect(service.findOne).toHaveBeenCalledWith(sampleCampaign.id);
  });
});
