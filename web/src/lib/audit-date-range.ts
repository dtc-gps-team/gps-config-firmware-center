/**
 * แปลง "วันที่ที่ผู้ใช้เลือก" (YYYY-MM-DD จาก `<input type="date">`) เป็นช่วงเวลา
 * ISO 8601 ที่รวมทั้งวันตามเวลาไทย (UTC+7 ไม่มี DST) ส่งให้ `GET /audit-logs`
 * (`from`/`to`) — backend ไม่ต้องรู้เขตเวลาของผู้ใช้
 *
 * เลือกด้านเดียวได้ · ว่าง = ไม่กรองด้านนั้น · `from` มากกว่า `to` คืน error
 * ให้หน้าจอแสดงข้อความแทนการยิง request ที่จะได้ 400
 */
export type DayRange = { from?: string; to?: string; error?: string };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toInstant(day: string, time: string): string | null {
  if (!DAY_PATTERN.test(day)) return null;
  const date = new Date(`${day}T${time}+07:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function dayRangeToIso(fromDay: string, toDay: string): DayRange {
  const from = fromDay ? toInstant(fromDay, "00:00:00.000") : null;
  const to = toDay ? toInstant(toDay, "23:59:59.999") : null;
  if ((fromDay && !from) || (toDay && !to)) {
    return { error: "รูปแบบวันที่ไม่ถูกต้อง" };
  }
  if (from && to && from > to) {
    return { error: "วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด" };
  }
  return { from: from ?? undefined, to: to ?? undefined };
}
