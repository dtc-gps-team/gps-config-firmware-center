import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { ActionType } from '@prisma/client';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import {
  CONFIG_APPLY_MODE,
  type ConfigApplyMode,
} from '../device/config-applier';
import { CentralDeviceService } from './central-device.service';
import type {
  CentralDevice,
  CentralDeviceList,
  CentralMode,
  CentralStatus,
} from './central-device.types';

/** ผลของ `GET /devices/{deviceId}/central` — `device=null` เมื่อ Server กลางไม่รู้จักเครื่องนี้ */
export interface DeviceCentralView {
  mode: CentralMode;
  reachable: boolean;
  error: string | null;
  fetchedAt: string;
  device: CentralDevice | null;
}

/** ผลของ `GET /central/status` — `applyMode` (docs/27 §5.6) = ค่า env
 * `DEVICE_CONFIG_APPLY_MODE` ของระบบ ให้ client รู้ว่าส่งเข้ากล่องผ่านทางไหน
 * (Mobile ซ่อนปุ่มยืนยันติดตั้ง/Override Firmware ในโหมด `central`) */
export type CentralStatusView = CentralStatus & { applyMode: ConfigApplyMode };

// อ่านสถานะกล่องจาก Server กลาง (อ่านอย่างเดียว) · ทุก Role ที่ login แล้ว
// (resource `devices` action `Read` เดียวกับ Device Detail) · ติดต่อ Server กลางไม่ได้
// ไม่ใช่ error: ตอบ 200 พร้อม `reachable=false`
@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CentralDeviceController {
  constructor(
    private readonly central: CentralDeviceService,
    @Inject(CONFIG_APPLY_MODE) private readonly applyMode: ConfigApplyMode,
  ) {}

  @Get('central/status')
  @RequirePermission('devices', ActionType.Read)
  async getStatus(): Promise<CentralStatusView> {
    const status = await this.central.getStatus();
    return { ...status, applyMode: this.applyMode };
  }

  @Get('central/devices')
  @RequirePermission('devices', ActionType.Read)
  listDevices(): Promise<CentralDeviceList> {
    return this.central.listDevices();
  }

  @Get('devices/:deviceId/central')
  @RequirePermission('devices', ActionType.Read)
  async getDeviceCentral(
    @Param('deviceId') deviceId: string,
  ): Promise<DeviceCentralView> {
    const { list, device } = await this.central.findDevice(deviceId);
    return {
      mode: list.mode,
      reachable: list.reachable,
      error: list.error,
      fetchedAt: list.fetchedAt,
      device,
    };
  }
}
