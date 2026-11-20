import type { Provider } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import {
  type CentralDeviceClient,
  HttpCentralDeviceClient,
} from './central-device.client';

/**
 * client ของ device-hub (docs/33 §0 ข้อ 1) — device-hub ตอบ API path/รูป JSON เดียวกับ Server กลาง ESP32
 * จึงใช้ `HttpCentralDeviceClient` ตัวเดิม แค่ชี้ไปอีก URL
 *
 * env `DEVICE_HUB_MODE` (Mock Mode Pattern ใน CLAUDE.md):
 *   ไม่ตั้ง / `mock` (ค่าเริ่มต้น) = ปิด → `null` (รุ่นที่ตั้ง deliveryChannel=hub ส่งไม่ได้ ได้ข้อความบอกเหตุผล)
 *   `real` = ต้องตั้ง DEVICE_HUB_BASE_URL / DEVICE_HUB_ADMIN_USERNAME / DEVICE_HUB_ADMIN_PASSWORD
 *            ไม่ครบ throw ตอน startup (ไม่แอบถอยไป mock)
 */
export const DEVICE_HUB_CLIENT = Symbol('DEVICE_HUB_CLIENT');

const DEFAULT_TIMEOUT_MS = 5000;

export function createDeviceHubClient(
  get: (key: string) => string | undefined,
): CentralDeviceClient | null {
  const mode = (get('DEVICE_HUB_MODE') ?? '').trim().toLowerCase();
  if (mode === '' || mode === 'mock') return null;
  if (mode !== 'real') {
    throw new Error(
      `DEVICE_HUB_MODE ต้องเป็น "mock" หรือ "real" แต่ได้ "${get('DEVICE_HUB_MODE')}"`,
    );
  }
  const baseUrl = get('DEVICE_HUB_BASE_URL');
  const username = get('DEVICE_HUB_ADMIN_USERNAME');
  const password = get('DEVICE_HUB_ADMIN_PASSWORD');
  if (!baseUrl || !username || !password) {
    throw new Error(
      'DEVICE_HUB_MODE=real ต้องตั้ง DEVICE_HUB_BASE_URL, DEVICE_HUB_ADMIN_USERNAME และ DEVICE_HUB_ADMIN_PASSWORD',
    );
  }
  const timeoutMs = Number(get('DEVICE_HUB_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
  return new HttpCentralDeviceClient({
    baseUrl,
    username,
    password,
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_TIMEOUT_MS,
  });
}

export const deviceHubClientProvider: Provider = {
  provide: DEVICE_HUB_CLIENT,
  useFactory: (nestConfig: NestConfigService): CentralDeviceClient | null =>
    createDeviceHubClient((key) => nestConfig.get<string>(key)),
  inject: [NestConfigService],
};
