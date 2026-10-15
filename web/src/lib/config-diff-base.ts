import type { Config, ConfigVersion } from "@/lib/config-api";

/**
 * เลือก "ฐานเทียบ" ของหน้าอนุมัติ Config (ฟังก์ชัน pure ไม่ผูกกับ UI) —
 * ผู้อนุมัติอยากรู้ว่า Config ที่รออนุมัติ "ต่างจากอะไร"
 *
 * ลำดับ:
 *  1. Config นี้เคยอนุมัติแล้ว: เทียบกับเวอร์ชันล่าสุดของตัวเอง (รอบอนุมัติ
 *     ถัดไปคือการเปลี่ยนจากเวอร์ชันของตัวเอง ไม่ใช่จากต้นฉบับ)
 *  2. ยังไม่เคยอนุมัติและเป็นสำเนา (`clonedFromId`): เทียบกับเวอร์ชันที่อนุมัติ
 *     ล่าสุดของต้นฉบับ — เลือกเวอร์ชันที่อนุมัติแล้วเพราะเป็นสิ่งที่ผ่านการ
 *     ตัดสินใจจริง และไม่เปลี่ยนตามร่างที่ยังถูกแก้อยู่
 *  3. ต้นฉบับไม่เคยอนุมัติ: ถอยไปเทียบกับค่าปัจจุบันของต้นฉบับ (บอกในหน้าจอ)
 *  4. ต้นฉบับเปิดไม่ได้ (ถูกลบ/โหลดล้มเหลว): ไม่เทียบ
 *  5. ไม่ใช่สำเนา: ไม่มีฐานเทียบ
 */

type LoadState<T> = {
  isLoading: boolean;
  error: string | null;
  data: T | null;
};

export type DiffBaseInput = {
  config: Pick<Config, "clonedFromId" | "deviceModel" | "protocol">;
  ownVersions: LoadState<ConfigVersion[]>;
  /** ใช้เมื่อ `config.clonedFromId` ไม่ใช่ null เท่านั้น */
  source: LoadState<Config>;
  sourceVersions: LoadState<ConfigVersion[]>;
};

/** โมเดล/โปรโตคอลของต้นฉบับ เมื่อต่างจาก Config นี้ (wizard อนุญาตให้เปลี่ยน
 * ตอนโคลน) — ใช้แสดงคำเตือนว่าค่าที่ไม่มีในโมเดลใหม่จะขึ้นเป็น "ลบ" */
export type CrossModel = { deviceModel: string; protocol: string } | null;

export type DiffBase =
  | { kind: "loading" }
  | { kind: "own-error"; message: string }
  | { kind: "none" }
  | { kind: "own"; fields: Record<string, unknown>; versionNumber: number }
  | {
      kind: "source-version";
      fields: Record<string, unknown>;
      versionNumber: number;
      sourceId: string;
      sourceName: string;
      crossModel: CrossModel;
    }
  | {
      kind: "source-current";
      fields: Record<string, unknown>;
      sourceId: string;
      sourceName: string;
      crossModel: CrossModel;
    }
  | { kind: "source-unavailable"; message: string };

/** เวอร์ชันที่อนุมัติล่าสุด — ไม่พึ่งลำดับที่ backend ส่งมา */
export function latestVersion(versions: ConfigVersion[]): ConfigVersion | null {
  return versions.reduce<ConfigVersion | null>(
    (best, v) => (best && best.versionNumber >= v.versionNumber ? best : v),
    null,
  );
}

export function resolveDiffBase(input: DiffBaseInput): DiffBase {
  const { config, ownVersions, source, sourceVersions } = input;

  if (ownVersions.error && ownVersions.data === null) {
    return { kind: "own-error", message: ownVersions.error };
  }
  if (ownVersions.isLoading || ownVersions.data === null) {
    return { kind: "loading" };
  }

  const own = latestVersion(ownVersions.data);
  if (own) {
    return { kind: "own", fields: own.fields, versionNumber: own.versionNumber };
  }

  if (config.clonedFromId === null) return { kind: "none" };

  if (source.error && source.data === null) {
    return {
      kind: "source-unavailable",
      message: "ไม่พบ Config ต้นฉบับหรือโหลดไม่สำเร็จ จึงเทียบไม่ได้",
    };
  }
  if (source.isLoading || source.data === null) return { kind: "loading" };

  const src = source.data;
  const crossModel: CrossModel =
    src.deviceModel !== config.deviceModel || src.protocol !== config.protocol
      ? { deviceModel: src.deviceModel, protocol: src.protocol }
      : null;

  if (sourceVersions.error && sourceVersions.data === null) {
    return {
      kind: "source-unavailable",
      message: "โหลดเวอร์ชันของ Config ต้นฉบับไม่สำเร็จ จึงเทียบไม่ได้",
    };
  }
  if (sourceVersions.isLoading || sourceVersions.data === null) {
    return { kind: "loading" };
  }

  const approved = latestVersion(sourceVersions.data);
  if (approved) {
    return {
      kind: "source-version",
      fields: approved.fields,
      versionNumber: approved.versionNumber,
      sourceId: src.id,
      sourceName: src.name,
      crossModel,
    };
  }
  return {
    kind: "source-current",
    fields: src.fields,
    sourceId: src.id,
    sourceName: src.name,
    crossModel,
  };
}
