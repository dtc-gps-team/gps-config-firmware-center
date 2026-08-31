import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PERMISSION_KEY,
  RequiredPermission,
} from '../decorators/require-permission.decorator';
import { JwtPayload } from './jwt-auth.guard';

type AuthenticatedRequest = Request & { user?: JwtPayload };

/**
 * ตรวจสิทธิ์ resource+action ตามที่ระบุไว้ผ่าน `@RequirePermission(...)` โดย
 * query ตาราง `RolePermission` จากฐานข้อมูลจริงทุก request (ไม่ผูกกับสิทธิ์ที่
 * embed ไว้ใน JWT payload ตอน login) เพื่อให้การเปลี่ยนสิทธิ์ของ Role โดย Admin
 * (ผ่านหน้า User/Role Management) มีผลทันทีกับทุก session ที่ login ค้างอยู่แล้ว
 * โดยไม่ต้อง re-login ใหม่ — ตัดสินใจร่วมกับทีมไว้แล้ว (เทียบกับทางเลือก embed
 * สิทธิ์ลง JWT ตอน sign ซึ่งจะไม่ sync จนกว่าจะ login ใหม่)
 *
 * ต้องรันต่อจาก `JwtAuthGuard` เสมอ (`JwtAuthGuard` ต้องมาก่อนใน
 * `@UseGuards(...)` เพราะเป็นคนแนบ `req.user` ไว้ให้) — ถ้า handler/controller
 * ไม่มี `@RequirePermission` ติดไว้เลย ปล่อยผ่านไม่เช็คอะไรเพิ่ม (ใช้กับ endpoint
 * ที่แค่ต้อง login ก็พอ ไม่ต้องผูกกับสิทธิ์ resource ใดๆ)
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      RequiredPermission | undefined
    >(PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      // ไม่ควรเกิดขึ้นจริงถ้าต่อ guard ถูกลำดับ (JwtAuthGuard ต้องรันมาก่อนเสมอ
      // แล้วแนบ req.user ไว้แล้ว) — กันไว้เป็น 401 แทนที่จะปล่อยผ่านเฉยๆ หรือ
      // throw error ที่ไม่สื่อความหมาย (เช่น TypeError จาก user.role)
      throw new UnauthorizedException('ต้อง login ก่อนถึงจะเช็คสิทธิ์ได้');
    }

    const grant = await this.prisma.rolePermission.findFirst({
      where: {
        resource: required.resource,
        action: required.action,
        role: { code: user.role },
      },
      select: { id: true },
    });

    if (!grant) {
      throw new ForbiddenException(
        `Role "${user.role}" ไม่มีสิทธิ์ ${required.action} บน resource "${required.resource}"`,
      );
    }

    return true;
  }
}
