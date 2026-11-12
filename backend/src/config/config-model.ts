import type { Config, Prisma } from '@prisma/client';

/**
 * Config ผูกกับรุ่นอุปกรณ์ด้วย `modelId` (FK ไป `DeviceModel`) และไม่เก็บชื่อรุ่นซ้ำในตาราง
 * (B, 12 พ.ย. 2569) · ทุกจุดที่ต้องใช้ชื่อรุ่น (ส่งออก API, ตรวจกับ Parameter Library,
 * ข้อความ error, snapshot `ConfigVersion`) อ่านจาก relation ผ่าน include นี้
 */
export const CONFIG_MODEL_INCLUDE = {
  model: { select: { name: true } },
} satisfies Prisma.ConfigInclude;

/** Config ที่ส่งออก API — ทุก column + `deviceModel` (ชื่อรุ่นจาก `DeviceModel.name`) */
export type ConfigView = Config & { deviceModel: string };

/**
 * แปลงแถวที่ include {@link CONFIG_MODEL_INCLUDE} แล้วเป็นรูปที่ API ตอบ: เอา object `model`
 * ออก และใส่ `deviceModel` เป็นชื่อรุ่น — client เดิม (Web/Mobile) ที่อ่าน `deviceModel`
 * จึงใช้ได้เหมือนเดิม
 */
export function toConfigView<T extends { model: { name: string } }>(
  row: T,
): Omit<T, 'model'> & { deviceModel: string } {
  const { model, ...rest } = row;
  return { ...rest, deviceModel: model.name };
}
