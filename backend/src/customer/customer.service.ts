import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Customer, Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { AuditLogMetadata } from '../audit/audit-log-metadata';
import { PrismaService } from '../prisma/prisma.service';
import { lockCustomerForWrite, lockCustomerNames } from './customer-lock';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomerDto } from './dto/query-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/**
 * ข้อมูลลูกค้าแบบย่อ — id + ชื่อบริษัทเท่านั้น (ไม่มี contactName/email/phone/priorityTier) ใช้ pattern
 * เดียวกับ `UserSummary` · ถูก `device.service` ใช้เป็นรูปของ `customer` ที่ฝังใน Device ด้วย
 * จึงห้ามเพิ่ม field (เปลี่ยนรูป response ของ Device)
 */
export interface CustomerSummary {
  id: string;
  companyName: string;
}

/** รายการใน `GET /customers` — แบบย่อ + สถานะ (dropdown ลงทะเบียนอุปกรณ์ตัดที่ปิดใช้งานด้วย
 * `activeOnly`) ทุก role ที่ login เรียกได้ จึงไม่คืนข้อมูลติดต่อที่ละเอียดกว่าที่จำเป็น */
export interface CustomerListItem extends CustomerSummary {
  isActive: boolean;
}

/** ข้อมูลลูกค้าเต็มสำหรับหน้าจัดการลูกค้า (Admin/SuperAdmin) + จำนวนเครื่องที่ผูกอยู่ */
export interface ManagedCustomer extends CustomerListItem {
  contactName: string | null;
  email: string | null;
  phone: string | null;
  priorityTier: string | null;
  /** เครื่องที่ผูกกับลูกค้านี้ทั้งหมด (รวมที่ปลดระวางแล้ว) — ลบได้เมื่อเป็น 0 เท่านั้น */
  deviceCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload เสมอ (แต่ละ module ประกาศเอง) */
export interface ActingUser {
  id: string;
  role: string;
  ipAddress?: string | null;
}

const AUDIT_MODULE = 'customer';
/** จำนวนเครื่องตัวอย่างที่แจ้งใน 409 ตอนลบไม่ได้ */
const EXAMPLE_DEVICES = 5;

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * รายชื่อลูกค้าแบบย่อ เรียงตามชื่อบริษัท — dropdown filter บนหน้า Device Search + dropdown ตอน
   * ลงทะเบียนอุปกรณ์ (`activeOnly=true` ตัดลูกค้าที่ปิดใช้งานออก) · ยังไม่มี paging เพราะจำนวนลูกค้าน้อย
   */
  async findAll(query: QueryCustomerDto = {}): Promise<CustomerListItem[]> {
    return this.prisma.customer.findMany({
      where: query.activeOnly ? { isActive: true } : undefined,
      select: { id: true, companyName: true, isActive: true },
      orderBy: { companyName: 'asc' },
    });
  }

  /** `GET /customers/managed` — ข้อมูลเต็มสำหรับหน้าจัดการลูกค้า (Admin/SuperAdmin) */
  async listManaged(): Promise<ManagedCustomer[]> {
    const rows = await this.prisma.customer.findMany({
      include: { _count: { select: { devices: true } } },
      orderBy: { companyName: 'asc' },
    });
    return rows.map((r) => this.toManaged(r, r._count.devices));
  }

  /**
   * `POST /customers` — เพิ่มลูกค้าใหม่ · ชื่อบริษัทห้ามซ้ำแบบไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างหัวท้าย
   * (รวมลูกค้าที่ปิดใช้งานด้วย กันตั้งซ้ำโดยไม่รู้ตัว) · เขียน AuditLog ใน transaction เดียวกัน
   */
  async create(
    dto: CreateCustomerDto,
    actor: ActingUser,
  ): Promise<ManagedCustomer> {
    return this.prisma.$transaction(async (tx) => {
      await lockCustomerNames(tx);
      await this.assertNameFree(tx, dto.companyName);
      let created: Customer;
      try {
        created = await tx.customer.create({
          data: {
            companyName: dto.companyName,
            contactName: dto.contactName,
            email: dto.email,
            phone: dto.phone,
            priorityTier: dto.priorityTier,
          },
        });
      } catch (err) {
        throw this.mapUniqueViolation(err, dto.companyName);
      }
      await this.audit(tx, 'create', actor, {
        customerId: created.id,
        companyName: created.companyName,
      });
      return this.toManaged(created, 0);
    });
  }

  /**
   * `PATCH /customers/{id}` — แก้ข้อมูล / เปลี่ยนชื่อ / ปิด-เปิดใช้งาน · ล็อกแถว (FOR UPDATE) ให้ต่อคิวกับ
   * การลงทะเบียนอุปกรณ์ที่ผูกลูกค้านี้ (ดู `customer-lock.ts`) · ปิดใช้งานได้เสมอแม้มีเครื่องผูกอยู่
   */
  async update(
    id: string,
    dto: UpdateCustomerDto,
    actor: ActingUser,
  ): Promise<ManagedCustomer> {
    const changedFields = Object.entries(dto)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k);
    if (changedFields.length === 0) {
      throw new BadRequestException('ไม่มี field ที่จะแก้ไข');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.companyName !== undefined) await lockCustomerNames(tx);
      await lockCustomerForWrite(tx, id);
      if (dto.companyName !== undefined) {
        await this.assertNameFree(tx, dto.companyName, id);
      }
      let updated: Customer & { _count: { devices: number } };
      try {
        updated = await tx.customer.update({
          where: { id },
          data: {
            companyName: dto.companyName,
            contactName: dto.contactName,
            email: dto.email,
            phone: dto.phone,
            priorityTier: dto.priorityTier,
            isActive: dto.isActive,
          },
          include: { _count: { select: { devices: true } } },
        });
      } catch (err) {
        throw this.mapUniqueViolation(err, dto.companyName ?? '');
      }
      await this.audit(
        tx,
        dto.isActive === undefined || changedFields.length > 1
          ? 'update'
          : dto.isActive
            ? 'activate'
            : 'deactivate',
        actor,
        {
          customerId: updated.id,
          companyName: updated.companyName,
          changedFields,
        },
      );
      return this.toManaged(updated, updated._count.devices);
    });
  }

  /**
   * `DELETE /customers/{id}` — ลบจริงได้เฉพาะลูกค้าที่ **ไม่มีเครื่องผูกอยู่เลย** (รวมเครื่องที่ปลดระวางแล้ว)
   * ไม่งั้น 409 พร้อมจำนวน/ตัวอย่างเครื่อง และชี้ไปทาง "ปิดใช้งาน" แทน · FK `Device.customerId` เป็น
   * `onDelete: SetNull` ถ้าไม่เช็คจะปลดลูกค้าออกจากเครื่องเงียบๆ · ล็อกแถว FOR UPDATE แล้วตรวจซ้ำหลังได้ล็อก
   * คู่กับ `lockCustomerForReference()` ฝั่งลงทะเบียนอุปกรณ์ กัน TOCTOU (แนวทางเดียวกับ #425/#426)
   * บันทึกชื่อบริษัทลง AuditLog (snapshot) ให้อ่าน log รู้เรื่องหลังลบ
   */
  async remove(id: string, actor: ActingUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockCustomerForWrite(tx, id);
      const customer = await tx.customer.findUniqueOrThrow({ where: { id } });
      const deviceCount = await tx.device.count({ where: { customerId: id } });
      if (deviceCount > 0) {
        const examples = await tx.device.findMany({
          where: { customerId: id },
          select: { deviceId: true },
          orderBy: { deviceId: 'asc' },
          take: EXAMPLE_DEVICES,
        });
        const names = examples.map((d) => d.deviceId).join(', ');
        const more = deviceCount > examples.length ? ' และอื่นๆ' : '';
        throw new ConflictException(
          `ลบลูกค้า "${customer.companyName}" ไม่ได้ เพราะมีอุปกรณ์ผูกอยู่ ${deviceCount} เครื่อง (${names}${more}) - ใช้ "ปิดใช้งาน" แทน (เครื่องเดิมยังแสดงชื่อลูกค้าและกรองได้ตามปกติ)`,
        );
      }
      await tx.customer.delete({ where: { id } });
      await this.audit(tx, 'delete', actor, {
        customerId: customer.id,
        companyName: customer.companyName,
      });
    });
  }

  /** ชื่อบริษัทซ้ำกับลูกค้าอื่น (ไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่างหัวท้าย) → 409 ·
   * เรียกหลังได้ `lockCustomerNames()` เท่านั้น ไม่งั้นสองคำขอพร้อมกันอ่านว่า "ว่าง" ทั้งคู่ */
  private async assertNameFree(
    tx: Prisma.TransactionClient,
    companyName: string,
    exceptId?: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<
      { id: string; companyName: string; isActive: boolean }[]
    >`
      SELECT id, "companyName", "isActive" FROM "Customer"
      WHERE lower(btrim("companyName")) = lower(btrim(${companyName}))
        AND id <> ${exceptId ?? ''}
      LIMIT 1`;
    if (rows.length > 0) {
      const hit = rows[0];
      throw new ConflictException(
        hit.isActive
          ? `มีลูกค้าชื่อ "${hit.companyName}" อยู่แล้ว (ชื่อห้ามซ้ำ ไม่สนตัวพิมพ์เล็ก/ใหญ่)`
          : `มีลูกค้าชื่อ "${hit.companyName}" อยู่แล้วแต่ปิดใช้งานอยู่ - เปิดใช้งานลูกค้าเดิมแทนการสร้างใหม่`,
      );
    }
  }

  /** unique index เดิมของ `companyName` (เทียบตรงตัวอักษร) เป็นชั้นป้องกันสุดท้าย */
  private mapUniqueViolation(err: unknown, companyName: string): unknown {
    if (err instanceof PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return new ConflictException(`มีลูกค้าชื่อ "${companyName}" อยู่แล้ว`);
      }
      if (err.code === 'P2025') {
        return new NotFoundException('ไม่พบลูกค้านี้');
      }
    }
    return err;
  }

  private toManaged(c: Customer, deviceCount: number): ManagedCustomer {
    return {
      id: c.id,
      companyName: c.companyName,
      isActive: c.isActive,
      contactName: c.contactName,
      email: c.email,
      phone: c.phone,
      priorityTier: c.priorityTier,
      deviceCount,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  /** AuditLog ใน transaction เดียวกับการเปลี่ยนแปลง (compliance): บันทึกไม่ได้ = ย้อนกลับทั้งหมด
   * (แนวเดียวกับ config-definition / device registration) · เก็บชื่อบริษัท ไม่เก็บอีเมล/เบอร์ */
  private async audit(
    tx: Prisma.TransactionClient,
    action: string,
    actor: ActingUser,
    metadata: AuditLogMetadata,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        auditModule: AUDIT_MODULE,
        action,
        ipAddress: actor.ipAddress ?? null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
