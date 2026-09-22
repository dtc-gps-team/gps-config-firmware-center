import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Config, Prisma } from '@prisma/client';
import { ConfigDefinitionService } from '../config-definition/config-definition.service';
import { OVERRIDABLE_CONFIG_STATUSES } from '../config/config-status';
import { PrismaService } from '../prisma/prisma.service';
import { OverrideConfigDto } from './dto/override-config.dto';

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ */
export interface ActingUser {
  id: string;
  role: string;
}

const AUDIT_MODULE = 'config';

/**
 * Per-Field Config Override (issue #185) — ST แก้ค่าบาง field ของ Config ที่
 * `approved`/`synced` แล้วโดยตรง ไม่ผ่าน Approval Center ปกติ (สำหรับกรณี
 * ลูกค้าขอแก้ค่าหน้างาน หรือช่างต้องแก้เพราะเกิดข้อผิดพลาด) — ผู้มีสิทธิ์เป็น
 * ST เท่านั้น (RBAC resource `config-override`, ดู seed.ts) OT ไม่มีสิทธิ์เลย
 *
 * แยกโมดูลจาก `config` ตามที่เสนอไว้ใน issue #185 §4.2 — คนละ flow กับ
 * create/update/approve ปกติโดยสิ้นเชิง (ข้าม Approval Center ไปเลย)
 */
@Injectable()
export class ConfigOverrideService {
  private readonly logger = new Logger(ConfigOverrideService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configDefinitionService: ConfigDefinitionService,
  ) {}

  /**
   * Override ค่า field บน Config — mirror การสร้าง `ConfigVersion` แบบเดียวกับ
   * `ConfigService.approve()` ทุกประการ (versioning เผื่อ Rollback #28 ใช้ต่อ)
   * ต่างกันแค่ actor ไม่ใช่ Operation ที่อนุมัติจริง (ดู comment ที่
   * `ConfigVersion.reason` ใน schema.prisma อธิบาย semantic ของ `approvedBy`
   * ในบริบทนี้)
   *
   * `dto.fields` เป็น partial — merge เข้ากับ `Config.fields` เดิม ไม่แทนที่
   * ทั้งชุด (ต่างจาก `ConfigService.update()`)
   */
  async override(
    configId: string,
    dto: OverrideConfigDto,
    actor: ActingUser,
  ): Promise<Config> {
    const config = await this.prisma.config.findFirst({
      where: { id: configId, deletedAt: null },
    });
    if (!config) {
      throw new NotFoundException(`ไม่พบ Config id ${configId}`);
    }

    if (!OVERRIDABLE_CONFIG_STATUSES.includes(config.status)) {
      throw new ConflictException(
        `สถานะ Config ปัจจุบัน (${config.status}) ไม่รองรับการ override (ต้องเป็น approved/synced)`,
      );
    }

    await this.configDefinitionService.validateOverridableFields(
      config.deviceModel,
      config.protocol,
      dto.fields,
    );

    const mergedFields = {
      ...(config.fields as Record<string, unknown>),
      ...dto.fields,
    };

    return this.prisma.$transaction(async (tx) => {
      const priorVersions = await tx.configVersion.count({
        where: { configId },
      });
      await tx.configVersion.create({
        data: {
          configId,
          versionNumber: priorVersions + 1,
          fields: mergedFields as Prisma.InputJsonValue,
          deviceModel: config.deviceModel,
          protocol: config.protocol,
          approvedBy: actor.id,
          reason: dto.reason,
        },
      });
      const updated = await tx.config.update({
        where: { id: configId },
        data: { fields: mergedFields as Prisma.InputJsonValue },
      });
      // Audit Log บังคับทุกครั้งแบบไม่มีข้อยกเว้น (RBAC_Matrix.md กฎข้อ 3 —
      // Override ข้าม flow อนุมัติปกติ) เขียนในทรานแซกชันเดียวกับการเปลี่ยน
      // ข้อมูลจริง ต่างจาก logAudit() แบบ never-throws ที่ใช้กับ notification
      // เพราะที่นี่การเขียน AuditLog เป็นส่วนหนึ่งของความถูกต้องของ action นี้
      // เอง ไม่ใช่ side effect รอง
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'override',
        },
      });
      return updated;
    });
  }
}
