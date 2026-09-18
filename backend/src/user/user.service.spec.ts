import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { ActingUser, UserService } from './user.service';

jest.mock('bcrypt', () => ({ hash: jest.fn() }));

const actor: ActingUser = { id: 'admin-1', role: 'Admin' };

describe('UserService', () => {
  let service: UserService;
  let findMany: jest.Mock;
  let user: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let role: { findUnique: jest.Mock };
  let auditLog: { create: jest.Mock };

  beforeEach(async () => {
    findMany = jest.fn().mockResolvedValue([]);
    user = {
      findMany,
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    role = { findUnique: jest.fn() };
    auditLog = { create: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: { user, role, auditLog } },
      ],
    }).compile();

    service = module.get(UserService);
  });

  it('ไม่ส่ง role -> findMany where { isActive: true } เท่านั้น + orderBy fullName', async () => {
    await service.list({});

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true, role: undefined },
      select: { id: true, fullName: true, role: { select: { code: true } } },
      orderBy: { fullName: 'asc' },
    });
  });

  it('ส่ง role -> filter role.code', async () => {
    await service.list({ role: 'Operation' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, role: { code: 'Operation' } },
      }),
    );
  });

  it('map เป็น UserSummary (id + fullName + role code)', async () => {
    findMany.mockResolvedValue([
      { id: 'u1', fullName: 'สมหญิง', role: { code: 'Operation' } },
      { id: 'u2', fullName: 'สมชาย', role: { code: 'Operation' } },
    ]);

    const result = await service.list({ role: 'Operation' });

    expect(result).toEqual([
      { id: 'u1', fullName: 'สมหญิง', role: 'Operation' },
      { id: 'u2', fullName: 'สมชาย', role: 'Operation' },
    ]);
  });

  describe('listManaged', () => {
    it('filter role.code NOT IN (Admin, SuperAdmin) + คืนครบ username/isActive', async () => {
      findMany.mockResolvedValue([
        {
          id: 'u1',
          username: 'config.test',
          fullName: 'Config Tester',
          isActive: true,
          role: { code: 'ConfigEngineer' },
        },
      ]);

      const result = await service.listManaged();

      expect(findMany).toHaveBeenCalledWith({
        where: { role: { code: { notIn: ['Admin', 'SuperAdmin'] } } },
        select: {
          id: true,
          username: true,
          fullName: true,
          isActive: true,
          role: { select: { code: true } },
        },
        orderBy: { fullName: 'asc' },
      });
      expect(result).toEqual([
        {
          id: 'u1',
          username: 'config.test',
          fullName: 'Config Tester',
          isActive: true,
          role: 'ConfigEngineer',
        },
      ]);
    });
  });

  describe('create', () => {
    const dto = {
      username: 'new.test',
      fullName: 'New Tester',
      password: 'password123',
      role: 'Operation',
    };

    it('สร้างสำเร็จ -> hash password + สร้าง user ผูก roleId', async () => {
      role.findUnique.mockResolvedValue({ id: 'role-op', code: 'Operation' });
      user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      user.create.mockResolvedValue({
        id: 'u-new',
        username: dto.username,
        fullName: dto.fullName,
        isActive: true,
        role: { code: 'Operation' },
      });

      const result = await service.create(dto, actor);

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
      expect(user.create).toHaveBeenCalledWith({
        data: {
          username: dto.username,
          fullName: dto.fullName,
          passwordHash: 'hashed-pw',
          roleId: 'role-op',
        },
        include: { role: true },
      });
      expect(result).toEqual({
        id: 'u-new',
        username: dto.username,
        fullName: dto.fullName,
        isActive: true,
        role: 'Operation',
      });
    });

    it('เขียน AuditLog action create', async () => {
      role.findUnique.mockResolvedValue({ id: 'role-op', code: 'Operation' });
      user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      user.create.mockResolvedValue({
        id: 'u-new',
        username: dto.username,
        fullName: dto.fullName,
        isActive: true,
        role: { code: 'Operation' },
      });

      await service.create(dto, actor);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: actor.id, auditModule: 'user', action: 'create' },
      });
    });

    it('username ซ้ำ -> ConflictException ไม่เรียก create', async () => {
      role.findUnique.mockResolvedValue({ id: 'role-op', code: 'Operation' });
      user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(dto, actor)).rejects.toThrow(
        ConflictException,
      );
      expect(user.create).not.toHaveBeenCalled();
    });

    it('role ไม่มีอยู่จริง -> BadRequestException', async () => {
      role.findUnique.mockResolvedValue(null);

      await expect(service.create(dto, actor)).rejects.toThrow(
        BadRequestException,
      );
      expect(user.create).not.toHaveBeenCalled();
    });

    it.each(['Admin', 'SuperAdmin'])(
      'role เป็น %s -> BadRequestException (กันสร้างผ่านหน้านี้)',
      async (roleCode) => {
        role.findUnique.mockResolvedValue({ id: 'role-x', code: roleCode });

        await expect(
          service.create({ ...dto, role: roleCode }, actor),
        ).rejects.toThrow(BadRequestException);
        expect(user.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('update', () => {
    it('แก้ role สำเร็จ', async () => {
      user.findUnique.mockResolvedValue({
        id: 'u1',
        role: { code: 'Operation' },
      });
      role.findUnique.mockResolvedValue({ id: 'role-st', code: 'ST' });
      user.update.mockResolvedValue({
        id: 'u1',
        username: 'op.test',
        fullName: 'Op Tester',
        isActive: true,
        role: { code: 'ST' },
      });

      const result = await service.update('u1', { role: 'ST' }, actor);

      expect(user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { roleId: 'role-st', isActive: undefined },
        include: { role: true },
      });
      expect(result.role).toBe('ST');
    });

    it('แก้แค่ isActive -> ไม่แตะ roleId', async () => {
      user.findUnique.mockResolvedValue({
        id: 'u1',
        role: { code: 'Operation' },
      });
      user.update.mockResolvedValue({
        id: 'u1',
        username: 'op.test',
        fullName: 'Op Tester',
        isActive: false,
        role: { code: 'Operation' },
      });

      await service.update('u1', { isActive: false }, actor);

      expect(user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { roleId: undefined, isActive: false },
        include: { role: true },
      });
      expect(role.findUnique).not.toHaveBeenCalled();
    });

    it('เขียน AuditLog action update', async () => {
      user.findUnique.mockResolvedValue({
        id: 'u1',
        role: { code: 'Operation' },
      });
      user.update.mockResolvedValue({
        id: 'u1',
        username: 'op.test',
        fullName: 'Op Tester',
        isActive: false,
        role: { code: 'Operation' },
      });

      await service.update('u1', { isActive: false }, actor);

      expect(auditLog.create).toHaveBeenCalledWith({
        data: { userId: actor.id, auditModule: 'user', action: 'update' },
      });
    });

    it('ไม่พบผู้ใช้ -> NotFoundException', async () => {
      user.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { isActive: false }, actor),
      ).rejects.toThrow(NotFoundException);
      expect(user.update).not.toHaveBeenCalled();
    });

    it.each(['Admin', 'SuperAdmin'])(
      'เป้าหมายเป็น role %s -> NotFoundException (มองว่าไม่มีอยู่จากมุม resource นี้)',
      async (roleCode) => {
        user.findUnique.mockResolvedValue({
          id: 'u1',
          role: { code: roleCode },
        });

        await expect(
          service.update('u1', { isActive: false }, actor),
        ).rejects.toThrow(NotFoundException);
        expect(user.update).not.toHaveBeenCalled();
      },
    );

    it.each(['Admin', 'SuperAdmin'])(
      'พยายามเปลี่ยน role เป็น %s -> BadRequestException (กัน escalation)',
      async (roleCode) => {
        user.findUnique.mockResolvedValue({
          id: 'u1',
          role: { code: 'Operation' },
        });
        role.findUnique.mockResolvedValue({ id: 'role-x', code: roleCode });

        await expect(
          service.update('u1', { role: roleCode }, actor),
        ).rejects.toThrow(BadRequestException);
        expect(user.update).not.toHaveBeenCalled();
      },
    );
  });
});
