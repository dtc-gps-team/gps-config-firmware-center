import { z } from "zod";

import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

/**
 * ตรวจค่าที่ผู้ใช้กรอกต่อ field แบบ real-time ก่อนส่ง backend (Zod) — เช็คเท่าที่
 * สัญญากับ backend ชัดเจน: ชนิดตัวเลข, ชนิด json/array, และค่าที่ยอมรับได้
 * (`allowedValues`) ชนิดอื่น (date/uuid ฯลฯ) ปล่อยให้ backend ตรวจรูปแบบเอง
 * ตรงกับที่ `ConfigWizard` เคยทำตอน submit · ค่าว่างไม่ใช่ข้อผิดพลาดที่นี่
 * (บังคับกรอกตรวจแยกที่ผู้เรียก)
 */

export type RawFieldValue = string | boolean | undefined;

function numericSchema(dataType: string) {
  const base = z
    .string()
    .trim()
    .refine((v) => v !== "" && Number.isFinite(Number(v)), {
      message: "ต้องเป็นตัวเลข",
    });
  return dataType === "integer"
    ? base.refine((v) => Number.isInteger(Number(v)), {
        message: "ต้องเป็นจำนวนเต็ม",
      })
    : base;
}

function jsonSchema(dataType: "json" | "array") {
  return z.string().superRefine((raw, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: "custom", message: "ไม่ใช่ JSON ที่ถูกต้อง" });
      return;
    }
    if (dataType === "array") {
      if (!Array.isArray(parsed)) {
        ctx.addIssue({ code: "custom", message: "ต้องเป็น JSON array เช่น [1, 2]" });
      }
    } else if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      ctx.addIssue({
        code: "custom",
        message: 'ต้องเป็น JSON object เช่น {"key": "value"}',
      });
    }
  });
}

export function fieldSchema(def: ConfigFieldDefinition) {
  if (def.allowedValues.length > 0) {
    return z.string().refine((v) => def.allowedValues.includes(v), {
      message: `ต้องเป็นหนึ่งใน ${def.allowedValues.join(", ")}`,
    });
  }
  if (def.dataType === "integer" || def.dataType === "decimal" || def.dataType === "number") {
    return numericSchema(def.dataType);
  }
  if (def.dataType === "json" || def.dataType === "array") {
    return jsonSchema(def.dataType);
  }
  return z.string();
}

/** ข้อความข้อผิดพลาดของค่า 1 ช่อง · `null` = ผ่าน หรือยังว่าง/เป็น boolean */
export function validateFieldValue(
  def: ConfigFieldDefinition,
  value: RawFieldValue,
): string | null {
  if (def.dataType === "boolean") return null;
  if (typeof value !== "string" || value === "") return null;
  const result = fieldSchema(def).safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? "ค่าไม่ถูกต้อง");
}
