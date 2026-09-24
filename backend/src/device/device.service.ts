import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Device, Prisma } from '@prisma/client';
import type { AuditLogMetadata } from '../audit/audit-log-metadata';
import { CampaignRolloutService } from '../campaign/campaign-rollout.service';
import { CustomerSummary } from '../customer/customer.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryDeviceDto } from './dto/query-device.dto';

/** Device + ลูกค้าแบบย่อ (ถ้าผูกไว้) — docs/12_CustomerScope_Proposal.md เฟส B
 * (PR #127) · ใช้ `CustomerSummary` เดียวกับ `GET /customers` (id +
 * companyName เท่านั้น ไม่ embed contactName/email/phone) เพราะ Device Search
 * เปิดให้ทุก role อ่านได้ ไม่ควรพ่วงข้อมูลติดต่อลูกค้าที่ละเอียดกว่านั้นมาด้วย
 * — mirror pattern `ConfigFieldDefinitionWithSupport` ใน config-definition */
export type DeviceWithCustomer = Device & { customer: CustomerSummary | null };
import {
  APPLICABLE_CONFIG_STATUSES,
  CONFIG_APPLIER,
  type ConfigApplier,
  type ConfigApplyResult,
} from './config-applier';
import {
  DEVICE_SIMULATOR,
  type DeviceSimulator,
} from '../config/device-simulator';
import {
  DEVICE_CONNECTION_TESTER,
  type DeviceConnectionTester,
  type DeviceConnectionTestResult,
} from './device-connection-tester';
import type {
  CompatibilityCheckResult,
  DeviceSimulateConfigResult,
} from './simulate-config-result';
import { ConfirmFirmwareInstallDto } from './dto/confirm-firmware-install.dto';
import {
  CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS,
  SIMULATABLE_FIRMWARE_STATUS,
} from '../firmware/firmware-status';

/** สถานะเดียวที่ทดสอบสัญญาณ / ใส่ Config ได้ — อุปกรณ์ต้องติดตั้งจริงแล้ว
 * อุปกรณ์ที่ยัง `registered` (ยังไม่ติดตั้ง) หรือ `decommissioned` (ปลดระวางแล้ว)
 * ไม่มีความหมาย (ดู docs/06_Device_Connection_Test_Spec.md ข้อ 5) */
const TESTABLE_DEVICE_STATUS = 'installed';

/** AuditLog.auditModule ของแถวที่โมดูลนี้เขียน (#27) — `applyConfig`
 * (CLAUDE.md Audit Pattern ระบุ "นำ Config ไปใช้" ไว้ชัด) และ
 * `confirmFirmwareInstall` (#181) — test-connection/simulate-config เป็น
 * dry-run ไม่ persist จึงไม่ log */
const AUDIT_MODULE = 'device';

/** ผลลัพธ์ของ `confirmFirmwareInstall` — ตรงกับ `ConfirmFirmwareInstallResult`
 * ใน docs/api/openapi.yaml */
export interface ConfirmFirmwareInstallResult {
  deviceId: string;
  firmwareId: string;
  /** ISO 8601 — เวลาที่ backend บันทึกการยืนยัน (ไม่ใช่เวลาที่ช่างติดตั้งจริง
   * หน้างาน — endpoint นี้ไม่รู้เวลานั้น) */
  confirmedAt: string;
}

/** ผู้ที่กำลังเรียก endpoint — มาจาก JWT payload ({ sub, role }) เสมอ */
export interface ActingUser {
  id: string;
  role: string;
}

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DEVICE_CONNECTION_TESTER)
    private readonly connectionTester: DeviceConnectionTester,
    @Inject(CONFIG_APPLIER)
    private readonly configApplier: ConfigApplier,
    @Inject(DEVICE_SIMULATOR)
    private readonly deviceSimulator: DeviceSimulator,
    private readonly campaignRolloutService: CampaignRolloutService,
  ) {}

  /**
   * Device Search (Sprint 2 #11) — คืนรายการอุปกรณ์ทั้งหมด กรองตาม query
   * (ทุกตัว optional) เรียงตาม `deviceId` · ทุก Role อ่านได้ (RBAC_Matrix.md
   * §2 แถว "Device Search / Device Detail" = R ทุก Role · resource `devices`
   * action `Read` ที่ seed ให้ทุก role อยู่แล้ว)
   *
   * ยังไม่มี paging — จำนวน Device ใน MVP น้อย + UI ทำ filter/search ฝั่ง
   * client (UI standard ../planning/01_GPS_Build_Reference.md §3) · ออกแบบให้
   * เพิ่ม cursor paging ทีหลังได้ถ้าข้อมูลโต
   *
   * เพิ่ม `customer` แบบย่อเข้ามาด้วย (docs/12 เฟส B) ให้ Device Search แสดง/
   * กรองตามลูกค้าได้ · **filter `customerId` ที่ backend เพิ่มแล้ว (issue #204)**
   * — Mobile ใช้ดึง "รายการอุปกรณ์ของบริษัทที่เลือก" มา group ตาม deviceModel
   * เอง (เดิมมีแค่แสดงผลฝั่ง client อย่างเดียว)
   */
  findAll(query: QueryDeviceDto): Promise<DeviceWithCustomer[]> {
    const { search, deviceModel, protocol, status, customerId } = query;

    const where: Prisma.DeviceWhereInput = {
      deviceModel: deviceModel || undefined,
      protocol: protocol || undefined,
      status: status || undefined,
      customerId: customerId || undefined,
    };
    if (search) {
      where.OR = [
        { deviceId: { contains: search, mode: 'insensitive' } },
        { simNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.device.findMany({
      where,
      orderBy: { deviceId: 'asc' },
      include: { customer: { select: { id: true, companyName: true } } },
    });
  }

  /**
   * ค้นด้วย `Device.deviceId` (เลขเครื่องจริงที่ช่างกรอก/สแกน) **ไม่ใช่**
   * `Device.id` (surrogate UUID ภายในของ Prisma) — ตกลงกับ paveekornkwork-dev
   * บน PR #52: endpoint ฝั่งช่างหน้างานอ้างด้วยเลขเครื่องจริงเสมอ · ใช้ทั้ง
   * `GET /devices/{deviceId}` (Device Detail) และ endpoint ช่างหน้างาน (ที่ไม่
   * ได้ใช้ `customer` เลย แต่ join ทิ้งไว้เฉยๆ ไม่คุ้มแยก query ใหม่ ข้อมูล
   * น้อยมากใน MVP)
   */
  async findByDeviceId(deviceId: string): Promise<DeviceWithCustomer> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      include: { customer: { select: { id: true, companyName: true } } },
    });
    if (!device) {
      throw new NotFoundException(`ไม่พบ Device deviceId ${deviceId}`);
    }
    return device;
  }

  /**
   * ทดสอบการเชื่อมต่อ/สัญญาณของอุปกรณ์ที่ติดตั้งจริง — **ไม่แตะ status ของ
   * Device** คืนแค่ผลทดสอบ ณ ขณะนั้น
   *
   * รับ `deviceId` จาก path เท่านั้น (ไม่มี request body) — ดึง
   * `deviceModel`/`protocol` จาก record ใน DB เสมอ เพื่อไม่ให้ client ส่งค่า
   * ปลอมมา (แนวเดียวกับ `ConfigService.simulate`)
   */
  async testConnection(deviceId: string): Promise<DeviceConnectionTestResult> {
    const device = await this.findByDeviceId(deviceId);

    if (device.status !== TESTABLE_DEVICE_STATUS) {
      throw new ConflictException(
        `Device สถานะปัจจุบัน (${device.status}) ยังทดสอบสัญญาณไม่ได้ — ต้องเป็น ${TESTABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
      );
    }

    return this.connectionTester.testConnection({
      deviceId: device.deviceId,
      deviceModel: device.deviceModel,
      protocol: device.protocol,
    });
  }

  /**
   * ใส่ Config ที่อนุมัติแล้วให้อุปกรณ์ที่ติดตั้งจริง (ช่างหน้างาน ST/OT ผ่าน
   * Mobile — เลือกจาก Task ที่กำลังทำ) — **ไม่ persist / ไม่แตะ state ใดๆ**
   * (fire-and-forget) กล่องจะรับค่าเมื่อเปิดเครื่องครั้งถัดไป (Build Reference
   * §4.2) ยืนยัน scope นี้กับ kittiphong (B) 2026-09 — ถ้าต้องเก็บประวัติ
   * "Config ล่าสุดของกล่อง" ค่อยเปิด scope ใหม่ (ต้องเพิ่ม model/field)
   *
   * เงื่อนไข (ตรงกับ 4xx ใน docs/api/openapi.yaml `applyConfigToDevice`):
   * - ไม่พบ Device / Config → 404
   * - Device ยังไม่ `installed` → 409
   * - Config ยังไม่ `approved`/`synced` → 409
   * - Config คนละ deviceModel/protocol กับ Device → 409
   */
  async applyConfig(
    deviceId: string,
    configId: string,
    actor: ActingUser,
  ): Promise<ConfigApplyResult> {
    const device = await this.findByDeviceId(deviceId);

    if (device.status !== TESTABLE_DEVICE_STATUS) {
      throw new ConflictException(
        `Device สถานะปัจจุบัน (${device.status}) ยังใส่ Config ไม่ได้ — ต้องเป็น ${TESTABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
      );
    }

    const config = await this.prisma.config.findUnique({
      where: { id: configId },
    });
    if (!config) {
      throw new NotFoundException(`ไม่พบ Config id ${configId}`);
    }
    if (!APPLICABLE_CONFIG_STATUSES.includes(config.status)) {
      throw new ConflictException(
        `Config สถานะปัจจุบัน (${config.status}) ยังใส่เข้าอุปกรณ์ไม่ได้ — ต้องผ่านการอนุมัติ (${APPLICABLE_CONFIG_STATUSES.join('/')}) ก่อน`,
      );
    }
    if (
      config.deviceModel !== device.deviceModel ||
      config.protocol !== device.protocol
    ) {
      throw new ConflictException(
        `Config นี้เป็นของ ${config.deviceModel}/${config.protocol} ไม่ตรงกับอุปกรณ์ ${device.deviceModel}/${device.protocol}`,
      );
    }

    const fields = config.fields as Record<string, unknown>;
    const result = await this.configApplier.applyConfig({
      deviceId: device.deviceId,
      deviceModel: device.deviceModel,
      protocol: device.protocol,
      fields,
    });

    // AuditLog (#27, CLAUDE.md Audit Pattern — "นำ Config ไปใช้") — log ทุกครั้ง
    // ที่ช่างกดใส่ Config เข้าอุปกรณ์ ไม่ว่าผล `applied` จะ true/false เพราะเป็น
    // การกระทำจริงที่ต้องมีร่องรอย compliance (endpoint นี้เอง fire-and-forget
    // ไม่ persist อะไรใน DB ของเรา — AuditLog แถวนี้จึงเป็นร่องรอยเดียวที่มี)
    //
    // metadata (issue #205, feedback พี่เลี้ยง) — deviceId/configId/fieldNames
    // ให้ระบุได้ว่า "ใส่ Config ไหนเข้าอุปกรณ์เครื่องไหน มี field อะไรบ้าง"
    // ตั้งใจเก็บแค่**ชื่อ**ของ field ไม่ใช่ค่าจริง (ดู comment เหนือ
    // AuditLog.metadata ใน schema.prisma — กัน field ที่มีค่าอ่อนไหว เช่น
    // COMMAND_PASSWORD/SOS_NUMBER_1 รั่วผ่าน GET /audit-logs)
    //
    // **never throws** (แก้ตาม review comment ของ B บน PR #146) — ตอนนี้กล่อง
    // ได้รับคำสั่ง apply ไปแล้วจริง (fire-and-forget) audit ล้มเหลวไม่ควรทำให้
    // client เห็น 500 ทั้งที่ผล `result` ข้างบนสำเร็จจริง
    try {
      const metadata: AuditLogMetadata = {
        deviceId: device.deviceId,
        configId: config.id,
        fieldNames: Object.keys(fields),
      };
      await this.prisma.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'apply-config',
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `เขียน AuditLog ไม่สำเร็จ (module ${AUDIT_MODULE}, action apply-config, user ${actor.id}): ${(err as Error).message}`,
      );
    }

    // Campaign Monitor (#22, แก้ไข 2026-09-24) — รายงานผลให้ Rollout ที่ active
    // อยู่ (ถ้ามี) รู้ว่าเครื่องนี้สำเร็จ/ล้มเหลว — never-throw อยู่แล้วใน
    // ตัว recordTargetResult เอง (ดู comment ที่นั่น)
    await this.campaignRolloutService.recordTargetResult(
      device.deviceId,
      { configId: config.id },
      result.applied,
      result.details.join(' · '),
    );

    return result;
  }

  /**
   * "Confirm Firmware Install" (issue #181) — ช่างหน้างาน (ST/OT) ยืนยันเองว่า
   * ติดตั้ง Firmware เข้าอุปกรณ์เครื่องนี้เสร็จจริงแล้ว **ไม่ใช่คำสั่งส่งอะไร
   * ไปอุปกรณ์เลย** ต่างจาก `applyConfig` ที่ยังมี mock fire-and-forget อยู่
   * เบื้องหลัง — endpoint นี้เป็นแค่การบันทึก "มีการยืนยันเกิดขึ้น" (attestation)
   * เท่านั้น ไม่มี mock ฝั่ง push firmware ให้ fire-and-forget ด้วยซ้ำ
   *
   * **Deviation จาก GPS_Config_Firmware_Center_Design.pdf §10.2-10.3 โดยตั้งใจ**
   * — PDF ออกแบบ Workflow Firmware เป็น state machine อัตโนมัติเต็มรูปแบบ
   * (Pending→Pre-checking→Downloading→Verifying→Installing→Rebooting→Health
   * Checking→Success/Rollback) ที่ backend สื่อสารกับอุปกรณ์เองทุกขั้นตอน —
   * ทำไม่ได้เลยเพราะระบบนี้เป็น PULL model (อุปกรณ์ดึงข้อมูลเองตอนบูต backend
   * ไม่เคยคุยกับอุปกรณ์ตรงๆ) endpoint นี้จึงเป็น placeholder ระดับที่ทำได้ใน
   * ขอบเขตฝึกงานเท่านั้น (มติ A/B ในเธรด issue #181) — **ไม่คำนวณ**
   * `Firmware.deviceUpdateStatus` จริง (ยังคงเป็น `unknown` ต่อไป) รอออกแบบ
   * แยกเป็นงานถัดไปตามมติข้อ 3
   *
   * เงื่อนไข 4xx (mirror `applyConfig`):
   * - ไม่พบ Device / Firmware → 404
   * - Device ยังไม่ `installed` → 409
   * - Firmware ยังไม่ `stored` (upload) หรือยังไม่ `approved` (คุณภาพ) → 409
   * - Firmware ไม่รองรับ `device.deviceModel` (`deviceModelCompatibility`) → 409
   *
   * **ไม่ wrap try/catch เหมือน `applyConfig`** — ที่นั่น AuditLog เป็นแค่
   * ร่องรอยของการกระทำจริงที่สำเร็จไปแล้ว (fire-and-forget) แต่ที่นี่การเขียน
   * AuditLog **คือ** การกระทำทั้งหมด ไม่มีอย่างอื่นเกิดขึ้นเลยนอกจากแถวนี้ —
   * ถ้าเขียนไม่สำเร็จต้อง throw 500 ให้ช่างรู้ว่าต้องกดยืนยันใหม่ ไม่ใช่คืน
   * 200 ทั้งที่ไม่มีอะไรถูกบันทึกจริง
   */
  async confirmFirmwareInstall(
    deviceId: string,
    dto: ConfirmFirmwareInstallDto,
    actor: ActingUser,
  ): Promise<ConfirmFirmwareInstallResult> {
    const device = await this.findByDeviceId(deviceId);

    if (device.status !== TESTABLE_DEVICE_STATUS) {
      throw new ConflictException(
        `Device สถานะปัจจุบัน (${device.status}) ยังยืนยันติดตั้ง Firmware ไม่ได้ — ต้องเป็น ${TESTABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
      );
    }

    const firmware = await this.prisma.firmware.findUnique({
      where: { id: dto.firmwareId },
    });
    if (!firmware) {
      throw new NotFoundException(`ไม่พบ Firmware id ${dto.firmwareId}`);
    }
    if (firmware.uploadStatus !== SIMULATABLE_FIRMWARE_STATUS) {
      throw new ConflictException(
        `Firmware สถานะอัปโหลดปัจจุบัน (${firmware.uploadStatus}) ยังยืนยันติดตั้งไม่ได้ — ต้องเป็น "${SIMULATABLE_FIRMWARE_STATUS}" (จัดเก็บสำเร็จแล้ว) เท่านั้น`,
      );
    }
    if (
      firmware.approvalStatus !== CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS
    ) {
      throw new ConflictException(
        `Firmware สถานะอนุมัติคุณภาพปัจจุบัน (${firmware.approvalStatus}) ยังยืนยันติดตั้งไม่ได้ — ต้องเป็น "${CAMPAIGN_ELIGIBLE_FIRMWARE_APPROVAL_STATUS}" (QAEngineer อนุมัติคุณภาพแล้ว) เท่านั้น`,
      );
    }
    if (!firmware.deviceModelCompatibility.includes(device.deviceModel)) {
      throw new ConflictException(
        `Firmware นี้ไม่รองรับรุ่นอุปกรณ์ ${device.deviceModel} (รองรับ: ${firmware.deviceModelCompatibility.join(', ')})`,
      );
    }

    const confirmedAt = new Date();
    const metadata: AuditLogMetadata = {
      deviceId: device.deviceId,
      firmwareId: firmware.id,
      firmwareVersion: firmware.version,
    };
    await this.prisma.auditLog.create({
      data: {
        userId: actor.id,
        auditModule: AUDIT_MODULE,
        action: 'confirm-firmware-install',
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    // Campaign Monitor (#22, แก้ไข 2026-09-24) — ช่างยืนยันติดตั้งสำเร็จ = success
    // เสมอ (endpoint นี้เป็นแค่ attestation ไม่มีทาง fail อยู่แล้ว — ดู comment
    // หัวเมธอดนี้) never-throw อยู่แล้วในตัว recordTargetResult เอง จึงไม่กระทบ
    // ความหมาย "audit เขียนไม่สำเร็จต้อง throw 500" ข้างบน (เกิดขึ้นก่อนหน้านี้
    // ไปแล้ว)
    await this.campaignRolloutService.recordTargetResult(
      device.deviceId,
      { firmwareId: firmware.id },
      true,
      `ยืนยันติดตั้ง Firmware ${firmware.version} สำเร็จ (confirm-firmware-install)`,
    );

    return {
      deviceId: device.deviceId,
      firmwareId: firmware.id,
      confirmedAt: confirmedAt.toISOString(),
    };
  }

  /**
   * เช็คว่า Config ที่อนุมัติแล้ว "พร้อมอัพโหลดเข้าอุปกรณ์เครื่องนี้" ไหม —
   * dry-run ก่อน `applyConfig` จริง สำหรับช่างหน้างาน (ST/OT ผ่าน Mobile)
   * **ไม่ persist / ไม่แตะ state ใดๆ** ทั้ง Device และ Config
   *
   * รวม 3 ส่วนเป็นผลเดียว:
   * 1. `configCheck` — ตัว Config เองพร้อมไหม (reuse `DeviceSimulator` ตัวเดียว
   *    กับ `POST /config/{id}/simulate`)
   * 2. `compatibilityCheck` — deviceModel/protocol ของ Config ตรงกับอุปกรณ์ไหม
   * 3. `connectionCheck` — สัญญาณกล่องเครื่องนั้น (reuse `DeviceConnectionTester`
   *    ตัวเดียวกับ `POST /devices/{id}/test-connection`)
   *
   * เงื่อนไข 4xx (mirror `applyConfig` เฉพาะส่วนที่เช็คไม่ได้เลย):
   * - ไม่พบ Device / Config → 404
   * - Device ยังไม่ `installed` → 409
   * - Config ยังไม่ `approved`/`synced` → 409
   *
   * **ต่างจาก `applyConfig`:** deviceModel/protocol mismatch **ไม่ใช่ 409** —
   * endpoint นี้เป็น readiness check จึง report เป็น `compatibilityCheck.passed:
   * false` ใน 200 ให้ช่างเห็นว่าอะไรไม่ตรง (ดู PR description — รอ B ยืนยัน)
   */
  async simulateConfig(
    deviceId: string,
    configId: string,
  ): Promise<DeviceSimulateConfigResult> {
    const device = await this.findByDeviceId(deviceId);

    if (device.status !== TESTABLE_DEVICE_STATUS) {
      throw new ConflictException(
        `Device สถานะปัจจุบัน (${device.status}) ยังเช็คความพร้อมไม่ได้ — ต้องเป็น ${TESTABLE_DEVICE_STATUS} (ติดตั้งจริงแล้ว) เท่านั้น`,
      );
    }

    const config = await this.prisma.config.findUnique({
      where: { id: configId },
    });
    if (!config) {
      throw new NotFoundException(`ไม่พบ Config id ${configId}`);
    }
    if (!APPLICABLE_CONFIG_STATUSES.includes(config.status)) {
      throw new ConflictException(
        `Config สถานะปัจจุบัน (${config.status}) ยังเช็คความพร้อมเพื่ออัพโหลดหน้างานไม่ได้ — ต้องผ่านการอนุมัติ (${APPLICABLE_CONFIG_STATUSES.join('/')}) ก่อน`,
      );
    }

    const compatible =
      config.deviceModel === device.deviceModel &&
      config.protocol === device.protocol;
    const compatibilityCheck: CompatibilityCheckResult = compatible
      ? {
          passed: true,
          details: [
            `Config (${config.deviceModel}/${config.protocol}) ตรงกับอุปกรณ์ ${device.deviceId}`,
          ],
        }
      : {
          passed: false,
          details: [
            `Config นี้เป็นของ ${config.deviceModel}/${config.protocol} ไม่ตรงกับอุปกรณ์ ${device.deviceModel}/${device.protocol}`,
          ],
        };

    // configCheck + connectionCheck รันเสมอ แม้ compatibilityCheck ไม่ผ่าน —
    // ช่างจะได้เห็นภาพรวมครบในครั้งเดียว (configCheck ตรวจตัว Config เอง,
    // connectionCheck ตรวจสัญญาณกล่อง ทั้งคู่ไม่ขึ้นกับผล compat)
    const [configCheck, connectionCheck] = await Promise.all([
      this.deviceSimulator.simulateConfig({
        deviceModel: config.deviceModel,
        protocol: config.protocol,
        fields: config.fields as Record<string, unknown>,
      }),
      this.connectionTester.testConnection({
        deviceId: device.deviceId,
        deviceModel: device.deviceModel,
        protocol: device.protocol,
      }),
    ]);

    return {
      passed:
        configCheck.passed &&
        compatibilityCheck.passed &&
        connectionCheck.passed,
      configCheck,
      compatibilityCheck,
      connectionCheck,
    };
  }
}
