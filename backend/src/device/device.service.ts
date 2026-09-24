import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Config,
  Device,
  DeviceConfigOverride,
  DeviceConfigOverrideStatus,
  Prisma,
} from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import type { AuditLogMetadata } from '../audit/audit-log-metadata';
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
import { ConfigDefinitionService } from '../config-definition/config-definition.service';
import { DeviceConfigOverrideDto } from './dto/device-config-override.dto';
import { RejectDeviceConfigOverrideDto } from './dto/reject-device-config-override.dto';

/** `GET /devices/{deviceId}/config` response — `Config` (base) + สถานะ
 * override เฉพาะเครื่องนี้ (issue #223, มติ 2026-09-24 ผ่านอนุมัติแล้วเท่านั้น
 * ถึงมีผล) — `hasDeviceOverride` = มีแถว `approved` ที่ merge ทับ `fields`
 * อยู่ไหม, `pendingOverride` = คำขอที่ยังรอ Operation ตัดสินใจของเครื่องนี้
 * (ถ้ามี — เครื่องหนึ่งมีได้ทีละ 1 รายการ) ดู `DeviceService.getCurrentConfig()` */
export type ConfigWithDeviceOverride = Config & {
  hasDeviceOverride: boolean;
  pendingOverride: DeviceConfigOverride | null;
};

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
    private readonly configDefinitionService: ConfigDefinitionService,
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

  /**
   * Config ปัจจุบันของอุปกรณ์ — Config Override Phase 2 (Mobile, issue #211)
   * ต้องรู้ค่านี้ก่อนเปิดหน้า Override ให้ ST แก้ค่าราย field ได้ **ไม่มี FK
   * ตรงจาก Device ไปหา Config เลย** (เหมือนที่ comment เหนือ
   * `GET /devices/:deviceId/status` อธิบายไว้) — derive จาก `Task.configId`
   * ของ Task ล่าสุด (`updatedAt` มากสุด) ที่ `status: 'completed'` และผูกกับ
   * อุปกรณ์เครื่องนี้แทน (Task ประเภทติดตั้ง/เปลี่ยน Config ผูก `configId` ไว้
   * ตั้งแต่สร้าง Task — ดู comment เหนือ `Task.configId` ใน schema.prisma)
   *
   * `Task.deviceId` เทียบตรงกับ `Device.deviceId` (เลขเครื่องจริง) ไม่ใช่
   * `Device.id` — ตรงกับ convention ที่ยืนยันไว้ใน `create-campaign.dto.ts`
   * ว่า `Task.deviceId` เก็บเป็นเลขเครื่องจริงเสมอ (mirror ทุก endpoint อื่นที่
   * อ้างอุปกรณ์) ต่างจาก mobile client ที่ต้อง normalize สอง format เพราะมี
   * seed/migration data เก่าที่หลุด convention นี้ไป — backend ฝั่งนี้ยึดตาม
   * convention ปัจจุบันตรงๆ ไม่ normalize ย้อนกลับให้
   *
   * **ข้อจำกัดของ "Task ล่าสุด" (comment A บน PR #222):** ใช้ `updatedAt`
   * (ไม่ใช่ `completedAt` — ยังไม่มี field นี้ใน schema) ซึ่งขยับทุกครั้งที่มี
   * การ `PATCH` ใดๆ กับ Task นั้น ไม่ใช่แค่ตอนเปลี่ยนเป็น `completed` — ถ้า Task
   * ที่ completed ไปแล้วถูกแก้ field อื่น (เช่น `description`) ทีหลัง จะกลาย
   * เป็น "ล่าสุด" แทน Task ที่ติดตั้งจริงทีหลังกว่าได้ ยอมรับ trade-off นี้ไปก่อน
   * จนกว่าจะมี `completedAt` แยก
   */
  private async getBaseConfigForDevice(deviceId: string): Promise<Config> {
    const task = await this.prisma.task.findFirst({
      where: { deviceId, status: 'completed', configId: { not: null } },
      orderBy: { updatedAt: 'desc' },
    });
    const config = task?.configId
      ? await this.prisma.config.findUnique({ where: { id: task.configId } })
      : null;
    // soft-deleted Config (docs/11 Part A) ถือว่า "ไม่พบ" เช่นกัน — mirror
    // `ConfigService.findOne()` เป๊ะๆ (comment A บน PR #222: ไม่งั้น endpoint
    // นี้จะคืน 200 ให้ Config ที่ถูกลบไปแล้ว แล้วไปเจอ 404 ตอน overrideConfig แทน)
    if (!config || config.deletedAt !== null) {
      throw new NotFoundException(
        'อุปกรณ์นี้ยังไม่มี Config ที่ยืนยันติดตั้งแล้ว',
      );
    }
    return config;
  }

  async getCurrentConfig(deviceId: string): Promise<ConfigWithDeviceOverride> {
    await this.findByDeviceId(deviceId);
    const baseConfig = await this.getBaseConfigForDevice(deviceId);

    // Per-device Config Override (issue #223, มติ 2026-09-24) — merge เฉพาะ
    // แถว status: approved ของ Config **ตัวเดียวกับ base** เท่านั้น (bug fix
    // — comment A บน PR #225: เดิมกรองแค่ deviceId ไม่กรอง configId ถ้า
    // เครื่องนี้ถูก Confirm Install เป็น Config ใหม่ทีหลัง override ที่ทำไว้
    // กับ Config เก่าจะยังถูก merge ทับ Config ใหม่อยู่ — ถ้า Config ใหม่เป็น
    // คนละ deviceModel/protocol ก็จะได้ field ที่ไม่ผ่าน validate ของรุ่นใหม่
    // ติดมาด้วย) แถวล่าสุด (`versionNumber` มากสุด) เก็บสถานะ override สะสม
    // อยู่แล้ว (ดู `overrideDeviceConfig()`) จึง merge แถวเดียวนี้พอ ไม่ต้อง
    // ไล่รวมทุก version ย้อนหลังเอง — pending/rejected ไม่มีผลกับค่าที่คืนกลับ
    // เลย (ต้องผ่าน Operation อนุมัติก่อนถึงมีผล)
    //
    // `pendingOverride` แยกกรองต่างหาก — **ไม่กรอง configId** เพราะคำขอ
    // pending ผูกกับ "เครื่องนี้" ตรงๆ (จำกัดได้ทีละ 1 รายการต่อเครื่องเสมอ
    // ไม่ว่าจะผูกกับ Config ตัวไหน — ดู `overrideDeviceConfig()`) ต้องแสดงให้
    // ST/Operation เห็นเสมอว่ามีคำขอค้างอยู่ไหม แม้ Config จะเพิ่งเปลี่ยนไป
    const [latestApproved, pendingOverride] = await Promise.all([
      this.prisma.deviceConfigOverride.findFirst({
        where: { deviceId, configId: baseConfig.id, status: 'approved' },
        orderBy: { versionNumber: 'desc' },
      }),
      this.prisma.deviceConfigOverride.findFirst({
        where: { deviceId, status: 'pending' },
      }),
    ]);

    if (!latestApproved) {
      return { ...baseConfig, hasDeviceOverride: false, pendingOverride };
    }

    return {
      ...baseConfig,
      fields: {
        ...(baseConfig.fields as Record<string, unknown>),
        ...(latestApproved.fields as Record<string, unknown>),
      } as Prisma.JsonValue,
      hasDeviceOverride: true,
      pendingOverride,
    };
  }

  /**
   * Per-device Config Override (issue #223) — ST **ส่งคำขอ** แก้ค่าบาง field
   * ของ Config ปัจจุบันของ**อุปกรณ์เครื่องนี้เครื่องเดียว** ไม่กระทบอุปกรณ์อื่น
   * ที่ใช้ Config เดียวกัน (ต่างจาก `POST /config/{configId}/override` เดิม,
   * issue #185, ที่แก้ `Config.fields` ทั้งชุด — ดู comment เหนือ
   * `model DeviceConfigOverride` ใน schema.prisma อธิบายที่มา/เหตุผลเต็มๆ)
   * `POST /config/{configId}/override` เดิมจะถูก A deprecate แยก PR หลัง PR
   * #225 merge (มติบันทึกใน issue #223)
   *
   * **มติ 2026-09-24 (request changes บน PR #225 โดย A):** สร้างแถวสถานะ
   * `pending` เท่านั้น — **ไม่มีผลกับ `getCurrentConfig()` ทันที** ต้องรอ
   * Operation อนุมัติผ่าน `approveDeviceConfigOverride()` ก่อน (Separation of
   * Duty เดิม) แล้วช่างต้องกด `apply-config` เข้าเครื่องเองอีกครั้ง (ยังไม่ทำ
   * ใน PR นี้ — แยกเป็น PR ถัดไปตามที่ A เสนอ)
   *
   * base Config มาจาก `getBaseConfigForDevice()` เดียวกับ `getCurrentConfig()`
   * เป๊ะ — ไม่พบ (อุปกรณ์ยังไม่เคย Confirm Install หรือ Config ถูกลบไปแล้ว) →
   * 404 ข้อความเดียวกัน
   *
   * **เครื่องหนึ่งมีคำขอ `pending` พร้อมกันได้แค่ 1 รายการ** (เสนอโดย A —
   * กันการจัดการคำขอซ้อนกัน) → 409 ถ้ามีอยู่แล้ว เช็คในทรานแซกชันเดียวกับ
   * create เสมอ (ไม่เช็คแยกนอก transaction) กัน ST 2 คนส่งพร้อมกันผ่านทั้งคู่
   *
   * **`fields` ที่เขียนลง DB เป็นสถานะ override สะสม ไม่ใช่แค่ `dto.fields`
   * ดิบๆ** — merge `dto.fields` (partial ที่ ST ส่งมารอบนี้) ทับ fields ของแถว
   * **`approved`** ล่าสุดของ Config เดียวกัน (ถ้ามี) ก่อนเขียนแถวใหม่ mirror
   * `ConfigOverrideService.override()` เดิมที่ merge ทับ `Config.fields` เต็ม
   * ก้อนก่อนสร้าง `ConfigVersion` ใหม่ทุกครั้ง — **เหตุผลที่ทำแบบนี้แทนที่จะ
   * เก็บแค่ delta ของรอบนี้ดิบๆ**: `getCurrentConfig()` merge แค่แถว approved
   * ล่าสุดแถวเดียวทับ base (ไม่ไล่รวมทุก version) ถ้าเก็บแค่ delta ดิบๆ การ
   * override field ใหม่ในรอบถัดไปจะ "ลบ" ผล override ของ field อื่นจากรอบก่อน
   * หน้าไปเงียบๆ โดยไม่ตั้งใจ — **กรอง `configId: baseConfig.id` ด้วยเสมอ**
   * (bug fix เดียวกับ `getCurrentConfig()` — comment A บน PR #225: ไม่งั้น
   * field ที่เคย override ไว้กับ Config เก่า (ก่อน Confirm Install ใหม่) จะติด
   * มากับแถวใหม่ที่อ้าง Config คนละตัว)
   *
   * **`versionNumber` อ่านในทรานแซกชันเดียวกับ `create` เสมอ** (แก้ race
   * condition ที่ A ชี้ไว้บน PR #225: เดิมอ่านนอก transaction ทำให้ ST 2 คน
   * ส่งพร้อมกันกับเครื่องเดียวกันอาจได้ `versionNumber` ซ้ำ ชน
   * `@@unique([deviceId, versionNumber])` แล้วได้ Prisma P2002 → 500 แทนที่จะ
   * เป็น error ที่สื่อความหมาย — mirror `ConfigOverrideService` ที่ `count`
   * ในทรานแซกชันเดียวกับ `create` เช่นกัน) นับจาก**ทุกสถานะ** ไม่ใช่แค่
   * approved กัน versionNumber ชนกับแถวที่เคยถูก reject ไปแล้ว · เพิ่ม
   * catch P2002 → 409 เป็น backstop เผื่อหลุดผ่านมาได้จริงภายใต้
   * concurrent load สูงมากๆ (isolation level ปกติของ Postgres ไม่ใช่
   * SERIALIZABLE ก็ยังมี race ทางทฤษฎีเหลืออยู่เล็กน้อย)
   *
   * validate เฉพาะ `dto.fields` ที่ส่งมารอบนี้ (ไม่ validate ซ้ำ field เดิมจาก
   * version ก่อนหน้าที่ผ่านการ validate ไปแล้วตอนนั้น) reuse
   * `ConfigDefinitionService.validateOverridableFields()` ตัวเดียวกับ
   * `config-override` เดิมเป๊ะๆ ไม่เขียนตรรกะซ้ำ
   */
  async overrideDeviceConfig(
    deviceId: string,
    dto: DeviceConfigOverrideDto,
    actor: ActingUser,
  ): Promise<DeviceConfigOverride> {
    await this.findByDeviceId(deviceId);
    const baseConfig = await this.getBaseConfigForDevice(deviceId);

    await this.configDefinitionService.validateOverridableFields(
      baseConfig.deviceModel,
      baseConfig.protocol,
      dto.fields,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingPending = await tx.deviceConfigOverride.findFirst({
          where: { deviceId, status: 'pending' },
        });
        if (existingPending) {
          throw new ConflictException(
            'อุปกรณ์นี้มีคำขอ override ที่รอ Operation อนุมัติอยู่แล้ว — รอผลก่อนส่งคำขอใหม่',
          );
        }

        const previousApproved = await tx.deviceConfigOverride.findFirst({
          where: { deviceId, configId: baseConfig.id, status: 'approved' },
          orderBy: { versionNumber: 'desc' },
        });
        const accumulatedFields = {
          ...((previousApproved?.fields as Record<string, unknown>) ?? {}),
          ...dto.fields,
        };

        const latestVersion = await tx.deviceConfigOverride.findFirst({
          where: { deviceId },
          orderBy: { versionNumber: 'desc' },
        });

        const override = await tx.deviceConfigOverride.create({
          data: {
            deviceId,
            configId: baseConfig.id,
            versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
            fields: accumulatedFields as Prisma.InputJsonValue,
            reason: dto.reason,
            overriddenBy: actor.id,
            status: 'pending',
          },
        });

        // Audit Log บังคับทุกครั้งแบบไม่มีข้อยกเว้น (RBAC_Matrix.md กฎข้อ 3)
        // mirror `ConfigOverrideService.override()` — เขียนในทรานแซกชันเดียวกับ
        // การเปลี่ยนข้อมูลจริง ไม่ใช่ never-throw
        const metadata: AuditLogMetadata = {
          deviceId,
          configId: baseConfig.id,
          fieldNames: Object.keys(dto.fields),
        };
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            auditModule: AUDIT_MODULE,
            action: 'device-config-override-request',
            metadata: metadata as Prisma.InputJsonValue,
          },
        });

        return override;
      });
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'ส่งคำขอ override ไม่สำเร็จเพราะมีคำขออื่นเข้ามาพร้อมกัน — กรุณาลองใหม่อีกครั้ง',
        );
      }
      throw err;
    }
  }

  /** หาแถว `DeviceConfigOverride` ที่ยัง `pending` — ใช้ร่วมกันโดย
   * `approveDeviceConfigOverride()`/`rejectDeviceConfigOverride()` — ไม่พบ →
   * 404, ตัดสินใจไปแล้ว (approved/rejected) → 409 กันตัดสินใจซ้ำ */
  private async getPendingOverrideOrThrow(
    id: string,
  ): Promise<DeviceConfigOverride> {
    const existing = await this.prisma.deviceConfigOverride.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`ไม่พบคำขอ override id ${id}`);
    }
    if (existing.status !== 'pending') {
      throw new ConflictException(
        `คำขอนี้ถูกตัดสินใจไปแล้ว (สถานะปัจจุบัน: ${existing.status})`,
      );
    }
    return existing;
  }

  /**
   * Operation อนุมัติคำขอ override (issue #223, มติ 2026-09-24) — เปลี่ยน
   * สถานะเป็น `approved` เท่านั้น **ไม่ apply เข้าอุปกรณ์ให้อัตโนมัติ** ช่าง
   * ต้องกด `apply-config` เข้าเครื่องเองอีกครั้งหลังจากนี้ (ยังไม่ทำใน PR นี้)
   * resource `device-config-override` action `Approve` — Operation เท่านั้น
   */
  async approveDeviceConfigOverride(
    id: string,
    actor: ActingUser,
  ): Promise<DeviceConfigOverride> {
    const existing = await this.getPendingOverrideOrThrow(id);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.deviceConfigOverride.update({
        where: { id },
        data: {
          status: 'approved',
          decidedBy: actor.id,
          decidedAt: new Date(),
        },
      });
      const metadata: AuditLogMetadata = {
        deviceId: existing.deviceId,
        configId: existing.configId,
      };
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'device-config-override-approve',
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  }

  /** Operation ปฏิเสธคำขอ override — `rejectReason` ไม่บังคับ (Operation
   * อาจไม่ระบุก็ได้) resource เดียวกับ approve (action `Approve`) mirror
   * `config-deletion` (`rejectConfigDeletionRequest` ใช้ action `Approve`
   * เดียวกับ approve — "สิทธิ์ตัดสินใจ" ไม่ได้แยกตามผลตัดสินใจ) */
  async rejectDeviceConfigOverride(
    id: string,
    dto: RejectDeviceConfigOverrideDto,
    actor: ActingUser,
  ): Promise<DeviceConfigOverride> {
    const existing = await this.getPendingOverrideOrThrow(id);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.deviceConfigOverride.update({
        where: { id },
        data: {
          status: 'rejected',
          decidedBy: actor.id,
          decidedAt: new Date(),
          rejectReason: dto.rejectReason ?? null,
        },
      });
      const metadata: AuditLogMetadata = {
        deviceId: existing.deviceId,
        configId: existing.configId,
      };
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          auditModule: AUDIT_MODULE,
          action: 'device-config-override-reject',
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  }

  /** Operation ดูรายการคำขอ override ทั้งหมด — filter ตาม `status` (optional,
   * ไม่ส่ง = ทุกสถานะ) เรียงคำขอใหม่ขึ้นก่อน (`overriddenAt` desc) ให้ดูคิว
   * `pending` ได้ง่าย */
  listDeviceConfigOverrides(
    status?: DeviceConfigOverrideStatus,
  ): Promise<DeviceConfigOverride[]> {
    return this.prisma.deviceConfigOverride.findMany({
      where: status ? { status } : undefined,
      orderBy: { overriddenAt: 'desc' },
    });
  }
}
