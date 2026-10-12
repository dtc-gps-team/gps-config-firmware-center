import type { Config } from "@/lib/config-api";
import type { Device } from "@/lib/device-api";
import type { Firmware } from "@/lib/firmware-api";
import type { CampaignPayloadType } from "@/lib/campaign-api";

/**
 * เหตุผลที่อุปกรณ์เครื่องหนึ่งรับ payload ที่เลือกไม่ได้ (null = รับได้)
 *
 * mirror เงื่อนไขของ backend (`campaign-rollout.service.ts`
 * validateConfigPayload/validateFirmwarePayload): Config ต้องตรงทั้งโมเดลและ
 * โปรโตคอล, Firmware ต้องมีโมเดลของเครื่องอยู่ใน `deviceModelCompatibility`
 * ยังเลือก payload ไม่ได้ (config/firmware เป็น null) = ยังไม่มีอะไรให้
 * เทียบ คืน null
 */
export function describeIncompatibility(args: {
  payloadType: CampaignPayloadType;
  device: Pick<Device, "deviceModel" | "protocol">;
  config: Pick<Config, "deviceModel" | "protocol"> | null;
  firmware: Pick<Firmware, "deviceModelCompatibility"> | null;
}): string | null {
  const { payloadType, device, config, firmware } = args;

  if (payloadType === "Config") {
    if (!config) return null;
    if (device.deviceModel !== config.deviceModel) {
      return `โมเดล ${device.deviceModel} ไม่ตรงกับ Config นี้ (ต้องเป็น ${config.deviceModel})`;
    }
    if (device.protocol !== config.protocol) {
      return `โปรโตคอล ${device.protocol} ไม่ตรงกับ Config นี้ (ต้องเป็น ${config.protocol})`;
    }
    return null;
  }

  if (!firmware) return null;
  if (!firmware.deviceModelCompatibility.includes(device.deviceModel)) {
    return `Firmware นี้ไม่รองรับโมเดล ${device.deviceModel} (รองรับ ${firmware.deviceModelCompatibility.join(", ")})`;
  }
  return null;
}
