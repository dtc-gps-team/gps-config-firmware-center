import { SetMetadata } from '@nestjs/common';
import { ActionType } from '@prisma/client';

/** Metadata key ที่ PermissionGuard อ่านกลับมาผ่าน Reflector */
export const PERMISSION_KEY = 'require_permission';

export interface RequiredPermission {
  resource: string;
  action: ActionType;
}

/**
 * ระบุว่า endpoint นี้ต้องมีสิทธิ์ resource+action อะไรถึงจะเรียกได้ ตรวจจริงผ่าน
 * `PermissionGuard` ที่ query ตาราง `RolePermission` จากฐานข้อมูลทุก request
 * (ไม่ embed สิทธิ์ลง JWT payload) — ตัดสินใจร่วมกับทีมไว้แล้วว่าต้องการให้
 * Admin เปลี่ยนสิทธิ์ของ Role แล้วมีผลทันทีกับ session ที่ login ค้างอยู่แล้ว
 * โดยไม่ต้องบังคับให้ user re-login ใหม่
 *
 * **ต้องใช้คู่กับ `JwtAuthGuard` เสมอ และให้ `JwtAuthGuard` มาก่อน** ใน
 * `@UseGuards(...)` เพราะ `PermissionGuard` อ่าน role จาก `req.user` ที่
 * `JwtAuthGuard` เป็นคนแนบไว้ให้ ถ้าสลับลำดับ `PermissionGuard` จะหา
 * `req.user` ไม่เจอแล้ว throw 401 เอง (ดู permission.guard.ts)
 *
 * @example
 * ```ts
 * @UseGuards(JwtAuthGuard, PermissionGuard)
 * @RequirePermission('config', ActionType.Update)
 * @Patch(':id')
 * update() { ... }
 * ```
 */
export const RequirePermission = (
  resource: string,
  action: ActionType,
): MethodDecorator & ClassDecorator =>
  SetMetadata<string, RequiredPermission>(PERMISSION_KEY, {
    resource,
    action,
  });
