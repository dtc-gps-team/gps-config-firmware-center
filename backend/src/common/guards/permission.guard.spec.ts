import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionGuard } from './permission.guard';

type RolePermissionMock = { findFirst: jest.Mock };

function buildContext(user?: { sub: string; role: string }): ExecutionContext {
  const request = { user };
  // getHandler()/getClass() ต้องคืนค่า reference เดิมทุกครั้งที่เรียก (เหมือน
  // ExecutionContext จริงของ Nest) — ถ้าสร้าง jest.fn() ใหม่ทุกครั้งที่เรียก
  // (เช่น `getHandler: () => jest.fn()`) การเทียบด้วย toHaveBeenCalledWith จะ
  // fail เพราะ [handler, class] ที่ guard ส่งไปเทียบ กับที่ test คาดหวัง เป็นคน
  // ละ object กัน แม้หน้าตาจะเหมือนกันก็ตาม
  const handler = jest.fn();
  const controllerClass = jest.fn();
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => controllerClass,
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let rolePermission: RolePermissionMock;
  let guard: PermissionGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    rolePermission = { findFirst: jest.fn() };
    guard = new PermissionGuard(
      reflector as unknown as Reflector,
      { rolePermission } as unknown as PrismaService,
    );
  });

  it('handler/controller ไม่มี @RequirePermission ติดไว้เลย -> ผ่านทันที ไม่ query DB', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    const result = await guard.canActivate(
      buildContext({ sub: 'u1', role: 'SW' }),
    );

    expect(result).toBe(true);
    expect(rolePermission.findFirst).not.toHaveBeenCalled();
  });

  it('มี @RequirePermission แต่ req.user ไม่มี (แปลว่าต่อ guard ผิดลำดับ ไม่ผ่าน JwtAuthGuard มาก่อน) -> 401', async () => {
    reflector.getAllAndOverride.mockReturnValue({
      resource: 'config',
      action: ActionType.Update,
    });

    await expect(
      guard.canActivate(buildContext(undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rolePermission.findFirst).not.toHaveBeenCalled();
  });

  it('role มีสิทธิ์ตรงกับที่ query RolePermission เจอแถว -> ผ่าน และ query ด้วย where ที่ถูกต้อง', async () => {
    reflector.getAllAndOverride.mockReturnValue({
      resource: 'config',
      action: ActionType.Update,
    });
    rolePermission.findFirst.mockResolvedValue({ id: 'rp-1' });

    const result = await guard.canActivate(
      buildContext({ sub: 'u1', role: 'SW' }),
    );

    expect(result).toBe(true);
    expect(rolePermission.findFirst).toHaveBeenCalledWith({
      where: {
        resource: 'config',
        action: ActionType.Update,
        role: { code: 'SW' },
      },
      select: { id: true },
    });
  });

  it('role ไม่มีสิทธิ์ (query ไม่เจอแถวไหนเลย) -> 403', async () => {
    reflector.getAllAndOverride.mockReturnValue({
      resource: 'config',
      action: ActionType.Update,
    });
    rolePermission.findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(buildContext({ sub: 'u1', role: 'ST' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getAllAndOverride เรียกด้วย [handler, class] เพื่อรองรับทั้ง @RequirePermission บน method และบน controller ทั้งตัว', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = buildContext({ sub: 'u1', role: 'SW' });

    await guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      'require_permission',
      [context.getHandler(), context.getClass()],
    );
  });
});
