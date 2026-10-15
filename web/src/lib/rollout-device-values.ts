import type {
  RolloutDeviceValue,
  RolloutDeviceValuesItem,
} from "@/lib/campaign-api";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

/**
 * ตรรกะ pure ของ "ค่า Config เฉพาะเครื่องตอนสร้าง Rollout" (docs/17) แยกจาก UI
 * ให้เทสง่าย · backend ตรวจซ้ำทั้งหมด ฝั่งนี้ตรวจแค่ให้ผู้ใช้เห็นข้อผิดพลาดเร็ว
 */

/** เพดานเครื่องที่มีค่าเฉพาะเครื่องต่อ Rollout — ตรงกับ backend */
export const MAX_DEVICE_VALUES = 200;

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

type DefinitionShape = Pick<ConfigFieldDefinition, "dataType" | "allowedValues">;

/** แปลงข้อความที่ผู้ใช้กรอกเป็นค่าตาม `dataType` ของ field */
export function parseFieldInput(
  def: DefinitionShape,
  raw: string,
): ParseResult {
  const text = raw.trim();
  if (text === "") return { ok: false, error: "กรอกค่า" };

  switch (def.dataType) {
    case "integer":
      return /^-?\d+$/.test(text)
        ? { ok: true, value: Number(text) }
        : { ok: false, error: "ต้องเป็นจำนวนเต็ม" };
    case "decimal":
    case "number": {
      const n = Number(text);
      return Number.isFinite(n)
        ? { ok: true, value: n }
        : { ok: false, error: "ต้องเป็นตัวเลข" };
    }
    case "boolean":
      if (text === "true") return { ok: true, value: true };
      if (text === "false") return { ok: true, value: false };
      return { ok: false, error: "ต้องเป็น true หรือ false" };
    case "json":
    case "array": {
      try {
        const parsed: unknown = JSON.parse(text);
        const isArray = Array.isArray(parsed);
        if (def.dataType === "array") {
          return isArray
            ? { ok: true, value: parsed }
            : { ok: false, error: "ต้องเป็น JSON array" };
        }
        return typeof parsed === "object" && parsed !== null && !isArray
          ? { ok: true, value: parsed }
          : { ok: false, error: "ต้องเป็น JSON object" };
      } catch {
        return { ok: false, error: "รูปแบบ JSON ไม่ถูกต้อง" };
      }
    }
    default:
      if (def.allowedValues.length > 0 && !def.allowedValues.includes(text)) {
        return {
          ok: false,
          error: `ต้องเป็นค่าใดค่าหนึ่งใน [${def.allowedValues.join(", ")}]`,
        };
      }
      return { ok: true, value: text };
  }
}

/** แสดงค่าเป็นข้อความสำหรับใส่ในช่องกรอก/ตาราง */
export function valueToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** เครื่องนี้มีค่าพิเศษเดิมจาก Config **ตัวอื่น** ที่ใช้ต่อได้ — ต้องให้ผู้ใช้
 * ยืนยันทีละเครื่อง (ไม่ปล่อยให้หายเงียบๆ) */
export function needsCarryChoice(
  item: RolloutDeviceValuesItem | undefined,
  configId: string,
): boolean {
  return (
    !!item?.previous &&
    item.previous.fromConfigId !== configId &&
    Object.keys(item.previous.fields).length > 0
  );
}

/** ค่าพิเศษเดิมผูกกับ Config ตัวเดียวกับที่จะใช้ — ระบบใช้ต่อให้เองตอนปล่อย
 * (override สะสมต่อ Config) จึงไม่มีทางเลือก "ใช้ตามแม่แบบ" ให้ถอดออก */
export function continuesAutomatically(
  item: RolloutDeviceValuesItem | undefined,
  configId: string,
): boolean {
  return (
    !!item?.previous &&
    item.previous.fromConfigId === configId &&
    Object.keys(item.previous.fields).length > 0
  );
}

export type CarryChoice = "keep" | "template";

export type BuildInput = {
  configId: string;
  includedDeviceIds: string[];
  items: RolloutDeviceValuesItem[];
  /** ค่าที่ผู้ใช้แก้เอง (แปลงชนิดแล้ว) ต่อเครื่อง */
  edits: Record<string, Record<string, unknown>>;
  choices: Record<string, CarryChoice | undefined>;
};

export type BuildResult = {
  /** ค่าสุดท้ายต่อเครื่องที่จะส่งไป backend */
  values: RolloutDeviceValue[];
  /** เครื่องที่ต้องเลือก "ใช้ค่าพิเศษเดิมต่อ / ใช้ตามแม่แบบ" แต่ยังไม่เลือก */
  missingChoices: string[];
  /** เครื่องที่ถูกแก้ค่าแต่มีคำขอของช่างค้าง (backend จะตอบ 409) */
  blocked: string[];
};

/**
 * รวมค่าสุดท้ายต่อเครื่อง: ค่าพิเศษเดิม (ถ้าผู้ใช้เลือกใช้ต่อ) ทับด้วยค่าที่
 * แก้เอง · backend ไม่เติมค่าให้ จึงต้องส่งค่าสุดท้ายที่เลือกแล้วไปทั้งก้อน
 */
export function buildDeviceValues(input: BuildInput): BuildResult {
  const byDevice = new Map(input.items.map((i) => [i.deviceId, i]));
  const values: RolloutDeviceValue[] = [];
  const missingChoices: string[] = [];
  const blocked: string[] = [];

  for (const deviceId of input.includedDeviceIds) {
    const item = byDevice.get(deviceId);
    const edited = input.edits[deviceId] ?? {};
    let base: Record<string, unknown> = {};

    if (needsCarryChoice(item, input.configId)) {
      const choice = input.choices[deviceId];
      if (!choice) {
        missingChoices.push(deviceId);
        continue;
      }
      if (choice === "keep") base = { ...(item?.previous?.fields ?? {}) };
    }

    const fields = { ...base, ...edited };
    if (Object.keys(fields).length === 0) continue;
    if (item?.hasPendingRequest) {
      blocked.push(deviceId);
      continue;
    }
    values.push({ deviceId, fields });
  }
  return { values, missingChoices, blocked };
}
