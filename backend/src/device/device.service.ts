import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Device } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEVICE_CONNECTION_TESTER,
  type DeviceConnectionTester,
  type DeviceConnectionTestResult,
} from './device-connection-tester';

/** สถานะเดียวที่ทดสอบสัญญาณได้ — อุปกรณ์ต้องติดตั้งจริงแล้ว ทดสอบสัญญาณ
 * อุปกรณ์ที่ยัง `registered` (ยังไม่ติดตั้ง) หรือ `decommissioned` (ปลดระวางแล้ว)
 * ไม่มีความหมาย (ดู docs/06_Device_Connection_Test_Spec.md ข้อ 5) */
const TESTABLE_DEVICE_STATUS = 'installed';

@Injectable()
export class DeviceService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DEVICE_CONNECTION_TESTER)
    private readonly connectionTester: DeviceConnectionTester,
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
}
