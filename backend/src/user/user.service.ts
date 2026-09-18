import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { EXCLUDED_MANAGED_ROLE_CODES } from './managed-user-roles';

/** ข้อมูล user แบบย่อ — id + ชื่อ + role code เท่านั้น (ไม่มี username/email/สิทธิ์) */
export interface UserSummary {
  id: string;
  fullName: string;
  role: string;
}

/** ข้อมูล user เต็มสำหรับหน้า User / Role Management (Admin เท่านั้น) — ไม่มี
 *  passwordHash หลุดออกมาเด็ดขาด */
export interface ManagedUser {
  id: string;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
}

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload เสมอ (แต่ละ module ประกาศ
 * interface นี้เองซ้ำกัน ไม่ import ข้ามโมดูล — pattern เดียวกับ
 * config.service.ts / campaign.service.ts) */
export interface ActingUser {
  id: string;
  role: string;
}

const AUDIT_MODULE = 'user';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * รายชื่อ user แบบย่อ สำหรับ dropdown "เจาะจงผู้อนุมัติ" ใน Approval Center
   * (Sprint 3 #19) · เฉพาะ user ที่ `isActive` · เรียงตามชื่อ · `role` ที่ไม่มี
   * อยู่จริง → คืน list ว่าง
   *
   * **ไม่ใช่ User / Role Management** (RBAC_Matrix.md §2 = Admin เท่านั้น —
   * จอสร้าง/แก้/ปิดบัญชี, ดู `listManaged`/`create`/`update` ด้านล่าง) ·
   * endpoint นี้คืนแค่ชื่อให้ทุก role ที่ login เรียกได้ (JwtAuthGuard อย่างเดียว)
   */
  async list(query: QueryUserDto): Promise<UserSummary[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        role: query.role ? { code: query.role } : undefined,
      },
      select: { id: true, fullName: true, role: { select: { code: true } } },
      orderBy: { fullName: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      role: u.role.code,
    }));
  }

  /**
   * `GET /users/managed` — รายชื่อบัญชีทั่วไปแบบเต็ม (username/isActive รวมด้วย
   * — ต่างจาก `list()` ด้านบนที่คืนแค่ user active สำหรับ dropdown) ตัดบัญชี
   * Admin/SuperAdmin ออกทั้งหมดเสมอ (RBAC_Matrix.md §2 — ดู `managed-user-roles.ts`)
   * — Admin เท่านั้นที่เรียกได้ (resource `user-management` action `Read`)
   */
  async listManaged(): Promise<ManagedUser[]> {
    const users = await this.prisma.user.findMany({
      where: { role: { code: { notIn: [...EXCLUDED_MANAGED_ROLE_CODES] } } },
      select: {
        id: true,
        username: true,
        fullName: true,
        isActive: true,
        role: { select: { code: true } },
      },
      orderBy: { fullName: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      isActive: u.isActive,
      role: u.role.code,
    }));
  }

  /**
   * `POST /users` — Admin สร้างบัญชีทั่วไปใหม่ (resource `user-management`
   * action `Create`) — ตั้งรหัสผ่านเริ่มต้นเอง (ระบบยังไม่มี flow ลืมรหัสผ่าน
   * — ตกลงกับ paveekornk แล้ว 2026-09-18 ว่าไม่ทำ auto-generate ตอนนี้)
   *
   * `role` ต้องไม่ใช่ Admin/SuperAdmin — เช็คซ้ำที่นี่แม้ web จะไม่โชว์ 2 role
   * นี้ใน dropdown อยู่แล้วก็ตาม (กัน bypass ผ่านเรียก API ตรงๆ)
   */
  async create(dto: CreateUserDto, actor: ActingUser): Promise<ManagedUser> {
    const role = await this.findManageableRoleOrThrow(dto.role);

    const existing = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException(`username "${dto.username}" ถูกใช้แล้ว`);
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const created = await this.prisma.user.create({
      data: {
        username: dto.username,
        fullName: dto.fullName,
        passwordHash,
        roleId: role.id,
      },
      include: { role: true },
    });

    await this.logAudit('create', actor.id);
    return this.toManagedUser(created);
  }

  /**
   * `PATCH /users/{id}` — Admin แก้ role และ/หรือ `isActive` ของบัญชีทั่วไป
   * (resource `user-management` action `Update`) — บัญชีเป้าหมายต้องไม่ใช่
   * Admin/SuperAdmin (มองว่า "ไม่มีอยู่" จากมุมของ resource นี้ — mirror การ
   * filter ออกใน `listManaged()`) เปลี่ยน role ไปเป็น Admin/SuperAdmin ก็ทำ
   * ไม่ได้เช่นกัน (กัน escalation ผ่านหน้านี้)
   */
  async update(
    id: string,
    dto: UpdateUserDto,
    actor: ActingUser,
  ): Promise<ManagedUser> {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!existing || EXCLUDED_MANAGED_ROLE_CODES.includes(existing.role.code)) {
      throw new NotFoundException(`ไม่พบผู้ใช้ id ${id}`);
    }

    const newRole =
      dto.role !== undefined
        ? await this.findManageableRoleOrThrow(dto.role)
        : undefined;

    let updated: {
      id: string;
      username: string;
      fullName: string;
      isActive: boolean;
      role: { code: string };
    };
    try {
      updated = await this.prisma.user.update({
        where: { id },
        data: { roleId: newRole?.id, isActive: dto.isActive },
        include: { role: true },
      });
    } catch (err) {
      // race condition เดียวกับ config.service.ts/firmware.service.ts — row
      // อาจถูกลบไปพอดีระหว่าง findUnique กับ update นี้ (rare)
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`ไม่พบผู้ใช้ id ${id}`);
      }
      throw err;
    }

    await this.logAudit('update', actor.id);
    return this.toManagedUser(updated);
  }

  private async findManageableRoleOrThrow(
    code: string,
  ): Promise<{ id: string; code: string }> {
    const role = await this.prisma.role.findUnique({ where: { code } });
    if (!role) {
      throw new BadRequestException(`ไม่พบ role code "${code}"`);
    }
    if (EXCLUDED_MANAGED_ROLE_CODES.includes(role.code)) {
      throw new BadRequestException(
        `สร้าง/แก้บัญชีเป็น role "${role.code}" ผ่านหน้านี้ไม่ได้ — จัดการบัญชี Admin/SuperAdmin เป็นสิทธิ์แยกต่างหาก (ยังไม่เปิดใช้งาน)`,
      );
    }
    return role;
  }

  private toManagedUser(user: {
    id: string;
    username: string;
    fullName: string;
    isActive: boolean;
    role: { code: string };
  }): ManagedUser {
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      isActive: user.isActive,
      role: user.role.code,
    };
  }

  private async logAudit(action: string, userId: string): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { userId, auditModule: AUDIT_MODULE, action },
      });
    } catch (err) {
      this.logger.warn(
        `เขียน AuditLog ไม่สำเร็จ (module ${AUDIT_MODULE}, action ${action}, user ${userId}): ${(err as Error).message}`,
      );
    }
  }
}
