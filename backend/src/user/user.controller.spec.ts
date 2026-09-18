import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { JwtAuthGuard, JwtPayload } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { PrismaService } from '../prisma/prisma.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';

type AuthenticatedRequest = Request & { user: JwtPayload };

function reqAs(user: JwtPayload): AuthenticatedRequest {
  return { user } as AuthenticatedRequest;
}

const JWT_SECRET = 'test-secret';
const adminReq = reqAs({ sub: 'admin-1', role: 'Admin' });

describe('UserController', () => {
  let controller: UserController;
  let service: {
    list: jest.Mock;
    listManaged: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      list: jest.fn(),
      listManaged: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: service },
        {
          provide: JwtService,
          useValue: new JwtService({ secret: JWT_SECRET }),
        },
        { provide: PrismaService, useValue: {} },
        JwtAuthGuard,
        PermissionGuard,
      ],
    }).compile();

    controller = module.get(UserController);
  });

  it('GET /users -> service.list', async () => {
    service.list.mockResolvedValue([]);

    const result = await controller.list({});

    expect(result).toEqual([]);
    expect(service.list).toHaveBeenCalledWith({});
  });

  it('GET /users/managed -> service.listManaged', async () => {
    const managed = [
      {
        id: 'u1',
        username: 'config.test',
        fullName: 'Config Tester',
        isActive: true,
        role: 'ConfigEngineer',
      },
    ];
    service.listManaged.mockResolvedValue(managed);

    const result = await controller.listManaged();

    expect(result).toEqual(managed);
  });

  it('POST /users -> service.create พร้อม actor จาก JWT', async () => {
    const dto = {
      username: 'new.test',
      fullName: 'New Tester',
      password: 'password123',
      role: 'Operation',
    };
    const created = { id: 'u-new', ...dto, isActive: true };
    delete (created as { password?: string }).password;
    service.create.mockResolvedValue(created);

    const result = await controller.create(dto, adminReq);

    expect(result).toEqual(created);
    expect(service.create).toHaveBeenCalledWith(dto, {
      id: 'admin-1',
      role: 'Admin',
    });
  });

  it('PATCH /users/:id -> service.update พร้อม actor จาก JWT', async () => {
    const dto = { isActive: false };
    const updated = {
      id: 'u1',
      username: 'op.test',
      fullName: 'Op Tester',
      isActive: false,
      role: 'Operation',
    };
    service.update.mockResolvedValue(updated);

    const result = await controller.update('u1', dto, adminReq);

    expect(result).toEqual(updated);
    expect(service.update).toHaveBeenCalledWith('u1', dto, {
      id: 'admin-1',
      role: 'Admin',
    });
  });
});
