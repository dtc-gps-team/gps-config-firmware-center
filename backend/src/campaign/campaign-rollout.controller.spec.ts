import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  CampaignPayloadType,
  CampaignRollout,
  CampaignRolloutTarget,
} from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignRolloutController } from './campaign-rollout.controller';
import { CampaignRolloutService } from './campaign-rollout.service';
import { CreateCampaignRollbackDto } from './dto/create-campaign-rollback.dto';
import { CreateCampaignRolloutDto } from './dto/create-campaign-rollout.dto';

const JWT_SECRET = 'test-secret';

type AuthenticatedRequest = Request & { user: JwtPayload };

function reqAs(user: JwtPayload): AuthenticatedRequest {
  return { user } as AuthenticatedRequest;
}

const opReq = reqAs({ sub: 'op-1', role: 'Operation' });
const campaignId = 'campaign-1';

const sampleRollout: CampaignRollout = {
  id: 'rollout-1',
  campaignId,
  payloadType: CampaignPayloadType.Config,
  configId: 'cfg-1',
  firmwareId: null,
  status: 'pending_approval',
  targetCount: 1,
  successCount: 0,
  failureCount: 0,
  createdBy: 'op-1',
  approvedBy: null,
  approvedAt: null,
  isRollback: false,
  rollbackOfId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const sampleRolloutTarget: CampaignRolloutTarget = {
  id: 'rt-1',
  rolloutId: sampleRollout.id,
  deviceId: 'DEV-0001',
  status: 'pending',
  resultDetail: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('CampaignRolloutController', () => {
  let controller: CampaignRolloutController;
  let service: {
    findAll: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
    findTargets: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
    resume: jest.Mock;
    rollback: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      findTargets: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      resume: jest.fn(),
      rollback: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CampaignRolloutController],
      providers: [
        { provide: CampaignRolloutService, useValue: service },
        {
          provide: JwtService,
          useValue: new JwtService({ secret: JWT_SECRET }),
        },
        { provide: PrismaService, useValue: {} },
        JwtAuthGuard,
        PermissionGuard,
      ],
    }).compile();

    controller = module.get(CampaignRolloutController);
  });

  it('GET /campaigns/:campaignId/rollouts -> service.findAll', async () => {
    service.findAll.mockResolvedValue([sampleRollout]);

    const result = await controller.findAll(campaignId);

    expect(result).toEqual([sampleRollout]);
    expect(service.findAll).toHaveBeenCalledWith(campaignId);
  });

  it('POST /campaigns/:campaignId/rollouts -> service.create พร้อม actor จาก JWT', async () => {
    service.create.mockResolvedValue(sampleRollout);
    const dto: CreateCampaignRolloutDto = {
      payloadType: CampaignPayloadType.Config,
      configId: 'cfg-1',
    };

    const result = await controller.create(campaignId, dto, opReq);

    expect(result).toEqual(sampleRollout);
    expect(service.create).toHaveBeenCalledWith(campaignId, dto, {
      id: 'op-1',
      role: 'Operation',
    });
  });

  it('GET /campaigns/:campaignId/rollouts/:id -> service.findOne', async () => {
    service.findOne.mockResolvedValue(sampleRollout);

    const result = await controller.findOne(sampleRollout.id);

    expect(result).toEqual(sampleRollout);
    expect(service.findOne).toHaveBeenCalledWith(sampleRollout.id);
  });

  it('GET /campaigns/:campaignId/rollouts/:id/targets -> service.findTargets', async () => {
    service.findTargets.mockResolvedValue([sampleRolloutTarget]);

    const result = await controller.findTargets(sampleRollout.id);

    expect(result).toEqual([sampleRolloutTarget]);
    expect(service.findTargets).toHaveBeenCalledWith(sampleRollout.id);
  });

  it('POST .../approve -> service.approve พร้อม actor จาก JWT', async () => {
    const approved = { ...sampleRollout, status: 'active' as const };
    service.approve.mockResolvedValue(approved);

    const result = await controller.approve(sampleRollout.id, opReq);

    expect(result).toEqual(approved);
    expect(service.approve).toHaveBeenCalledWith(sampleRollout.id, {
      id: 'op-1',
      role: 'Operation',
    });
  });

  it('POST .../reject -> service.reject พร้อม actor จาก JWT', async () => {
    const rejected = { ...sampleRollout, status: 'rejected' as const };
    service.reject.mockResolvedValue(rejected);

    const result = await controller.reject(sampleRollout.id, opReq);

    expect(result).toEqual(rejected);
    expect(service.reject).toHaveBeenCalledWith(sampleRollout.id, {
      id: 'op-1',
      role: 'Operation',
    });
  });

  it('POST .../resume -> service.resume พร้อม actor จาก JWT', async () => {
    const resumed = { ...sampleRollout, status: 'active' as const };
    service.resume.mockResolvedValue(resumed);

    const result = await controller.resume(sampleRollout.id, opReq);

    expect(result).toEqual(resumed);
    expect(service.resume).toHaveBeenCalledWith(sampleRollout.id, {
      id: 'op-1',
      role: 'Operation',
    });
  });

  it('POST .../rollback -> service.rollback พร้อม campaignId/id/dto/actor จาก JWT', async () => {
    const rollback = {
      ...sampleRollout,
      id: 'rollout-2',
      isRollback: true,
      rollbackOfId: sampleRollout.id,
    };
    service.rollback.mockResolvedValue(rollback);
    const dto: CreateCampaignRollbackDto = {
      excludeDeviceIds: ['DEV-0002'],
    };

    const result = await controller.rollback(
      campaignId,
      sampleRollout.id,
      dto,
      opReq,
    );

    expect(result).toEqual(rollback);
    expect(service.rollback).toHaveBeenCalledWith(
      campaignId,
      sampleRollout.id,
      dto,
      { id: 'op-1', role: 'Operation' },
    );
  });
});
