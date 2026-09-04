import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  APPLICABLE_CONFIG_STATUSES,
  CONFIG_APPLIER,
  type ConfigApplier,
  type ConfigApplyResult,
} from './config-applier';
import {
  DEVICE_CONNECTION_TESTER,
  type DeviceConnectionTester,
  type DeviceConnectionTestResult,
} from './device-connection-tester';

/** สถานะเดียวที่ทดสอบสัญญาณ / ใส่ Config ได้ — อุปกรณ์ต้องติดตั้งจริงแล้ว
 * อุปกรณ์ที่ยัง `registered` (ยังไม่ติดตั้ง) หรือ `decommissioned` (ปลดระวางแล้ว)
 * ไม่มีความหมาย (ดู docs/06_Device_Connection_Test_Spec.md ข้อ 5) */
const TESTABLE_DEVICE_STATUS = 'installed';

@Injectable()
export class DeviceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DEVICE_CONNECTION_TESTER)
    private readonly connectionTester: DeviceConnectionTester,
    @Inject(CONFIG_APPLIER)
    private readonly configApplier: ConfigApplier,
  ) {}

  /**
   * ค้นด้วย `Device.deviceId` (เลขเครื่องจริงที่ช่างกรอก/สแกน) **ไม่ใช่**
   * `Device.id` (surrogate UUID ภายในของ Prisma) — ตกลงกับ paveekornkwork-dev
   * บน PR #52: endpoint ฝั่งช่างหน้างานอ้างด้วยเลขเครื่องจริงเสมอ
   */
  async findByDeviceId(deviceId: string): Promise<Device> {
    const device = await this.prisma.device.findUnique({ where: { deviceId } });
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

    return this.configApplier.applyConfig({
      deviceId: device.deviceId,
      deviceModel: device.deviceModel,
      protocol: device.protocol,
      fields: config.fields as Record<string, unknown>,
    });
  }
}
