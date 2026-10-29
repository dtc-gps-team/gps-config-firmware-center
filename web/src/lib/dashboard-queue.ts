/**
 * คิว "งานที่ต้องดำเนินการ" บน Dashboard — รายการงานที่ Role นั้นต้องลงมือ เรียงตามความ
 * เร่งด่วน (ผิดปกติ → ต้องตัดสินใจ → รับทราบ) แล้วค้างนานกว่าขึ้นก่อน
 */
export type QueueTone = "danger" | "warning" | "info";

export type QueueItem = {
  key: string;
  tone: QueueTone;
  title: string;
  /** บรรทัดรองใต้ชื่องาน เช่น "ค้างมา 3 ชั่วโมง" · ไม่มีก็ไม่ต้องใส่ */
  detail?: string;
  count: number;
  /** ไม่ใส่ = แสดงเป็นแถวที่กดไม่ได้ (ยังไม่มีหน้าที่ตรงกับงานนี้) */
  href?: string;
};

const TONE_ORDER: Record<QueueTone, number> = { danger: 0, warning: 1, info: 2 };

/** ตัดงานที่ไม่มี (count = 0) แล้วเรียงตามความเร่งด่วน (เสถียร: ลำดับเดิมคงไว้ในโทนเดียวกัน) */
export function sortQueue(items: QueueItem[]): QueueItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.count > 0)
    .sort(
      (a, b) =>
        TONE_ORDER[a.item.tone] - TONE_ORDER[b.item.tone] || a.index - b.index,
    )
    .map(({ item }) => item);
}

/** "ค้างมา 3 ชั่วโมง" จากเวลาเก่าสุดในกลุ่ม — null ถ้าไม่มีเวลา */
export function waitingLabel(
  oldestIso: string | null | undefined,
  nowMs: number = Date.now(),
): string | undefined {
  if (!oldestIso) return undefined;
  const ms = nowMs - new Date(oldestIso).getTime();
  if (Number.isNaN(ms) || ms < 0) return undefined;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return "ค้างมาไม่ถึงชั่วโมง";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `ค้างมา ${hours} ชั่วโมง`;
  return `ค้างมา ${Math.floor(hours / 24)} วัน`;
}

/** เวลาเก่าสุด (ISO) ในรายการ — undefined ถ้าว่าง */
export function oldestIso(isos: (string | null | undefined)[]): string | undefined {
  const valid = isos.filter((v): v is string => !!v && !Number.isNaN(Date.parse(v)));
  if (valid.length === 0) return undefined;
  return valid.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}
