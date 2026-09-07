import { IsIn, IsString, MinLength } from 'class-validator';

/** platform ที่รองรับ — Mobile ก่อน (`web` เผื่อ FCM ผ่าน service worker ทีหลัง) */
export const DEVICE_TOKEN_PLATFORMS = ['android', 'ios', 'web'] as const;

export type DeviceTokenPlatform = (typeof DEVICE_TOKEN_PLATFORMS)[number];

export class RegisterDeviceTokenDto {
  /** FCM registration token ของเครื่อง */
  @IsString()
  @MinLength(1)
  token!: string;

  @IsIn(DEVICE_TOKEN_PLATFORMS)
  platform!: DeviceTokenPlatform;
}

/** query param ของ DELETE /notifications/device-tokens?token=... */
export class DeleteDeviceTokenDto {
  @IsString()
  @MinLength(1)
  token!: string;
}
