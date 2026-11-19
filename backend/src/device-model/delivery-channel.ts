/**
 * ทางส่ง Config/Firmware เข้ากล่องของรุ่นนี้ (docs/33 D1 + §0 ข้อ 3)
 *   `central` = Server กลาง ESP32 (ค่าเดิมของทุกรุ่น — null ในฐานข้อมูลก็คือค่านี้)
 *   `hub`     = device-hub (กล่องที่ไม่ใช่ ESP32 เช่น Meitrack TA255)
 * เก็บเป็น string ไม่ใช่ enum ของ Prisma — เพิ่มค่าใหม่ได้โดยไม่ต้อง migration (แบบเดียวกับ `supportedProtocols`)
 */
export const DELIVERY_CHANNELS = ['central', 'hub'] as const;

export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** ค่าจากฐานข้อมูล -> ทางส่งที่ใช้จริง · null / ค่าที่ไม่รู้จัก = `central` (ไม่ส่งผิดทาง) */
export function resolveDeliveryChannel(
  value: string | null | undefined,
): DeliveryChannel {
  return value === 'hub' ? 'hub' : 'central';
}
