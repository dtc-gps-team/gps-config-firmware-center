/**
 * เทียบค่า field ของ Config 2 ชุด (เช่น ฉบับที่รออนุมัติ กับเวอร์ชันที่อนุมัติ
 * ล่าสุด) — ฟังก์ชันล้วน ไม่ผูกกับ UI เพื่อเทสต์ง่าย และให้งานอื่นที่ต้องแสดง
 * "ค่าที่ต่างจากแม่แบบ" (เช่นค่าเฉพาะเครื่องตอนเริ่ม Rollout) เรียกใช้ซ้ำได้
 */
export type FieldChangeKind = "added" | "removed" | "changed";

export type FieldChange = {
  fieldName: string;
  kind: FieldChangeKind;
  /** ค่าเดิม — `undefined` เมื่อ kind = "added" */
  before?: unknown;
  /** ค่าใหม่ — `undefined` เมื่อ kind = "removed" */
  after?: unknown;
};

export type ConfigDiff = {
  changes: FieldChange[];
  counts: Record<FieldChangeKind, number>;
  /** จำนวน field ที่ค่าเท่าเดิม */
  unchangedCount: number;
};

/** เทียบเชิงค่า (deep) — object/array เทียบตามเนื้อหา ไม่ใช่ reference
 *  ลำดับ key ใน object ไม่มีผล แต่ลำดับสมาชิกใน array มีผล */
export function isSameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => isSameValue(v, b[i]));
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  if (keysA.length !== Object.keys(objB).length) return false;
  return keysA.every(
    (k) => Object.hasOwn(objB, k) && isSameValue(objA[k], objB[k]),
  );
}

/**
 * `before` = ค่าเดิมที่ใช้เป็นฐาน (เวอร์ชันที่อนุมัติล่าสุด) · `after` = ค่าใหม่
 * ที่กำลังขออนุมัติ · field ที่อยู่ในทั้งสองฝั่งแต่ค่าเท่ากันไม่ถูกนับเป็นการ
 * เปลี่ยน · ผลเรียงตามชื่อ field
 */
export function diffConfigFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ConfigDiff {
  const changes: FieldChange[] = [];
  let unchangedCount = 0;
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const fieldName of [...names].sort()) {
    const inBefore = Object.hasOwn(before, fieldName);
    const inAfter = Object.hasOwn(after, fieldName);
    if (inBefore && inAfter) {
      if (isSameValue(before[fieldName], after[fieldName])) {
        unchangedCount += 1;
      } else {
        changes.push({
          fieldName,
          kind: "changed",
          before: before[fieldName],
          after: after[fieldName],
        });
      }
    } else if (inAfter) {
      changes.push({ fieldName, kind: "added", after: after[fieldName] });
    } else {
      changes.push({ fieldName, kind: "removed", before: before[fieldName] });
    }
  }

  const counts: Record<FieldChangeKind, number> = {
    added: 0,
    removed: 0,
    changed: 0,
  };
  for (const c of changes) counts[c.kind] += 1;
  return { changes, counts, unchangedCount };
}
