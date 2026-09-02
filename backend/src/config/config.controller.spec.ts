import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';

const JWT_SECRET = 'test-secret';

const sampleConfig: Config = {
  id: '11111111-1111-1111-1111-111111111111',
  deviceModel: 'GT06N',
  protocol: 'TCP',
  status: 'draft',
  fields: {},
  createdBy: 'sw-1',
  approvedBy: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function reqAs(payload: JwtPayload): Request & { user: JwtPayload } {
  return { user: payload } as Request & { user: JwtPayload };
}

const swReq = reqAs({ sub: 'sw-1', role: 'SW' });

describe('ConfigController', () => {
  let controller: ConfigController;
  let service: jest.Mocked<
    Pick<
      ConfigService,
      | 'findAll'
      | 'create'
      | 'importFromJson'
      | 'findOne'
      | 'update'
      | 'remove'
      | 'simulate'
    >
  >;

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      create: jest.fn(),
      importFromJson: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      simulate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConfigController],
      providers: [
        { provide: ConfigService, useValue: service },
        // pattern เดียวกับ task.controller.spec.ts — provide JwtService ตรงๆ
        // ให้ JwtAuthGuard inject ได้, และ PrismaService stub ให้ PermissionGuard
        // inject ได้ (ไม่มี method ไหนถูกเรียกจริงในเทสนี้ เพราะเรียก controller
        // method ตรงๆ ไม่ผ่าน HTTP guard chain — ดู config-http.integration-spec.ts
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

    controller = module.get(ConfigController);
  });

  it('GET /config -> service.findAll พร้อม query', async () => {
    service.findAll.mockResolvedValue([sampleConfig]);
    const result = await controller.findAll({ status: 'draft' });
    expect(result).toEqual([sampleConfig]);
    expect(service.findAll).toHaveBeenCalledWith({ status: 'draft' });
  });

  it('POST /config -> service.create พร้อม dto และ actor จาก JWT', async () => {
    service.create.mockResolvedValue(sampleConfig);
    const dto = { deviceModel: 'GT06N', protocol: 'TCP', fields: {} };
    await controller.create(dto, swReq);
    expect(service.create).toHaveBeenCalledWith(dto, {
      id: 'sw-1',
      role: 'SW',
    });
  });

  it('POST /config/import -> service.importFromJson พร้อม file/format/actor จาก JWT', async () => {
    service.importFromJson.mockResolvedValue(sampleConfig);
    const file = { originalname: 'config.json' } as Express.Multer.File;
    await controller.importConfig(file, 'json', swReq);
    expect(service.importFromJson).toHaveBeenCalledWith(file, 'json', {
      id: 'sw-1',
      role: 'SW',
    });
  });

  it('GET /config/:id -> service.findOne', async () => {
    service.findOne.mockResolvedValue(sampleConfig);
    await controller.findOne(sampleConfig.id);
    expect(service.findOne).toHaveBeenCalledWith(sampleConfig.id);
  });

  it('PUT /config/:id -> service.update พร้อม dto', async () => {
    service.update.mockResolvedValue({
      ...sampleConfig,
      deviceModel: 'GT06L',
    });
    const dto = { deviceModel: 'GT06L' };
    await controller.update(sampleConfig.id, dto);
    expect(service.update).toHaveBeenCalledWith(sampleConfig.id, dto);
  });

  it('DELETE /config/:id -> service.remove', async () => {
    service.remove.mockResolvedValue(undefined);
    await controller.remove(sampleConfig.id);
    expect(service.remove).toHaveBeenCalledWith(sampleConfig.id);
  });

  it('POST /config/:id/simulate -> service.simulate', async () => {
    service.simulate.mockResolvedValue({ passed: true, details: ['ผ่านหมด'] });
    const result = await controller.simulate(sampleConfig.id);
    expect(result).toEqual({ passed: true, details: ['ผ่านหมด'] });
    expect(service.simulate).toHaveBeenCalledWith(sampleConfig.id);
  });
});
