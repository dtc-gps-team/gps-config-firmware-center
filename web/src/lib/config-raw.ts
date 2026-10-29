import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

/**
 * โหมด Raw JSON ของ Config Editor: แปลงค่า field ปัจจุบัน ↔ ข้อความ JSON และไฮไลต์
 * สี (ฟังก์ชันล้วน เทสต์ได้ ไม่ผูกกับ UI)
 */

export type RawParse =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; error: string };

/** อ่านข้อความ JSON เป็น field ของ Config · ต้องเป็น object ล้วนและทุก key ต้อง
 * อยู่ในคลัง Parameter (ไม่เดาชื่อ field) */
export function parseRawFields(
  text: string,
  defs: ConfigFieldDefinition[],
): RawParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      error: `JSON ไม่ถูกต้อง: ${err instanceof Error ? err.message : "อ่านไม่ได้"}`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "ต้องเป็น JSON object ของ field และค่า" };
  }
  const known = new Set(defs.map((d) => d.fieldName));
  const unknown = Object.keys(parsed).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `ไม่รู้จัก field: ${unknown.join(", ")} (ต้องมีอยู่ในคลัง Parameter)`,
    };
  }
  return { ok: true, fields: parsed as Record<string, unknown> };
}

export type JsonTokenKind =
  | "key"
  | "string"
  | "number"
  | "literal"
  | "punct"
  | "space";

export type JsonToken = { kind: JsonTokenKind; text: string };

const TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],])|(\s+)|([^\s])/g;

/** แบ่งข้อความ JSON เป็นชิ้นสำหรับระบายสี (ข้อความที่ไม่ใช่ JSON ที่ถูกต้องก็แบ่งได้
 * ไม่ throw) */
export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        tokens.push({ kind: "key", text: m[1] });
        tokens.push({ kind: "punct", text: m[2] });
      } else {
        tokens.push({ kind: "string", text: m[1] });
      }
    } else if (m[3] !== undefined) tokens.push({ kind: "number", text: m[3] });
    else if (m[4] !== undefined) tokens.push({ kind: "literal", text: m[4] });
    else if (m[5] !== undefined) tokens.push({ kind: "punct", text: m[5] });
    else if (m[6] !== undefined) tokens.push({ kind: "space", text: m[6] });
    else tokens.push({ kind: "punct", text: m[7] ?? "" });
  }
  return tokens;
}
