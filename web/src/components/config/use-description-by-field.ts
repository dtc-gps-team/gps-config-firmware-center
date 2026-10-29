import { useMemo } from "react";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

/**
 * `fieldName` -> `description` จากคลัง Parameter — ใช้คู่กับ `ConfigFieldLabel`
 * แยกออกมาเพราะ logic นี้ซ้ำกันทุกจุดที่แสดงค่า Config (รีวิว B #407 ข้อ 3)
 */
export function useDescriptionByField(
  definitions: ConfigFieldDefinition[] | null | undefined,
): Map<string, string> {
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const d of definitions ?? []) {
      if (d.description) map.set(d.fieldName, d.description);
    }
    return map;
  }, [definitions]);
}
