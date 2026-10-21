import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ActionType } from '@prisma/client';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
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

// อ่านสถานะกล่องจาก Server กลาง (อ่านอย่างเดียว) · ทุก Role ที่ login แล้ว
// (resource `devices` action `Read` เดียวกับ Device Detail) · ติดต่อ Server กลางไม่ได้
// ไม่ใช่ error: ตอบ 200 พร้อม `reachable=false`
@Controller()
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CentralDeviceController {
  constructor(private readonly central: CentralDeviceService) {}

  @Get('central/status')
  @RequirePermission('devices', ActionType.Read)
  getStatus(): Promise<CentralStatus> {
    return this.central.getStatus();
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
