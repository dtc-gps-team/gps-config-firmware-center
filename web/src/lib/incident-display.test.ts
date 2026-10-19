import { describe, expect, it } from "vitest";

import {
  canRetryConfigSync,
  failedDeviceSample,
  formatPercent,
  incidentImpact,
  incidentRolloutHref,
  incidentSampleErrors,
  incidentSourceLabel,
  incidentTechnicalDetails,
  incidentType,
  incidentTypeLabel,
  isIncidentActive,
  isIncidentClosed,
  rolloutImpactBar,
  rolloutKindLabel,
} from "./incident-display";

describe("incidentSourceLabel", () => {
  it("แปลง source ที่รู้จัก", () => {
    expect(incidentSourceLabel("field-report")).toBe("แจ้งจากหน้างาน");
    expect(incidentSourceLabel("config-sync-writer")).toBe("ตรวจพบอัตโนมัติ");
  });

  it("ค่าไม่รู้จักหรือ null คืน null", () => {
    expect(incidentSourceLabel("whatever")).toBeNull();
    expect(incidentSourceLabel(null)).toBeNull();
  });
});

describe("incidentTechnicalDetails", () => {
  it("อ่านเฉพาะ key ที่รู้จักและชนิดถูกต้อง", () => {
    expect(
      incidentTechnicalDetails({
        versionNumber: 2,
        attempts: 3,
        lastError: "  timeout ",
        other: "ignored",
      }),
    ).toEqual({ versionNumber: 2, attempts: 3, lastError: "timeout" });
  });

  it("metadata เป็น null หรือชนิดผิด คืน null ทุกค่า", () => {
    const empty = { versionNumber: null, attempts: null, lastError: null };
    expect(incidentTechnicalDetails(null)).toEqual(empty);
    expect(
      incidentTechnicalDetails({ attempts: "3", lastError: "  " }),
    ).toEqual(empty);
  });
});

describe("incidentType / incidentTypeLabel (ประเภทในหน้ารายการ)", () => {
  it("แยกประเภทตาม source ที่ระบบรู้จัก", () => {
    expect(incidentType({ source: "rollout-failure" })).toBe("rollout-failure");
    expect(incidentType({ source: "config-sync-writer" })).toBe(
      "config-sync-writer",
    );
    expect(incidentType({ source: "field-report" })).toBe("field-report");
  });

  it("source ที่ไม่รู้จัก หรือ null เป็น 'other' ไม่หายจากรายการ", () => {
    expect(incidentType({ source: "mobile-simulator-test" })).toBe("other");
    expect(incidentType({ source: "whatever" })).toBe("other");
    expect(incidentType({ source: null })).toBe("other");
  });

  it("ป้ายภาษาคนของแต่ละประเภท", () => {
    expect(incidentTypeLabel("rollout-failure")).toBe("Rollout ล้มเหลว");
    expect(incidentTypeLabel("config-sync-writer")).toBe(
      "เขียน Config ไม่สำเร็จ",
    );
    expect(incidentTypeLabel("field-report")).toBe("แจ้งจากหน้างาน");
    expect(incidentTypeLabel("other")).toBe("อื่นๆ");
  });
});

describe("rolloutKindLabel", () => {
  const base = { source: "rollout-failure" };

  it("แปลงชนิดย่อยของ Incident จาก Rollout", () => {
    expect(rolloutKindLabel({ ...base, metadata: { kind: "auto-pause" } })).toBe(
      "หยุดอัตโนมัติ",
    );
    expect(
      rolloutKindLabel({ ...base, metadata: { kind: "completed-with-failures" } }),
    ).toBe("จบแต่มีเครื่องล้มเหลว");
    expect(
      rolloutKindLabel({ ...base, metadata: { kind: "completed-with-skipped" } }),
    ).toBe("จบแต่มีเครื่องถูกข้าม");
  });

  it("ไม่ใช่ Rollout, ไม่มี kind หรือ kind ไม่รู้จัก: null", () => {
    expect(
      rolloutKindLabel({
        source: "field-report",
        metadata: { kind: "auto-pause" },
      }),
    ).toBeNull();
    expect(rolloutKindLabel({ ...base, metadata: null })).toBeNull();
    expect(rolloutKindLabel({ ...base, metadata: { kind: "x" } })).toBeNull();
  });
});

describe("formatPercent", () => {
  it("ทศนิยมไม่เกิน 1 ตำแหน่ง และไม่มี .0 ถ้าเป็นจำนวนเต็ม", () => {
    expect(formatPercent(20, 100)).toBe("20%");
    expect(formatPercent(1, 3)).toBe("33.3%");
    expect(formatPercent(1, 8)).toBe("12.5%");
  });

  it("จำนวนรวมเป็น 0 ไม่หารด้วยศูนย์", () => {
    expect(formatPercent(0, 0)).toBe("0%");
  });
});

describe("incidentImpact (จำนวนเครื่องที่ได้รับผลกระทบ)", () => {
  const rollout = (metadata: Record<string, unknown> | null) => ({
    source: "rollout-failure",
    deviceId: null,
    metadata,
  });

  it("Rollout: ล้มเหลว X จาก Y เครื่อง พร้อมเปอร์เซ็นต์และจำนวนที่ถูกข้าม", () => {
    expect(
      incidentImpact(
        rollout({ failureCount: 20, targetCount: 100, skippedCount: 5 }),
      ),
    ).toEqual({
      summary: "ล้มเหลว 20 จาก 100 เครื่อง (20%)",
      detail: "ข้ามเพราะออฟไลน์ 5 เครื่อง",
    });
  });

  it("Rollout ที่ไม่มีเครื่องข้าม: ไม่มีบรรทัดรอง", () => {
    expect(
      incidentImpact(
        rollout({ failureCount: 3, targetCount: 30, skippedCount: 0 }),
      )?.detail,
    ).toBeNull();
  });

  it("Rollout ที่ไม่มีเครื่องล้มแต่มีเครื่องถูกข้าม", () => {
    expect(
      incidentImpact(
        rollout({ failureCount: 0, targetCount: 50, skippedCount: 4 }),
      ),
    ).toEqual({
      summary: "ไม่มีเครื่องล้มเหลว จาก 50 เครื่อง",
      detail: "ข้ามเพราะออฟไลน์ 4 เครื่อง",
    });
  });

  it("Rollout ที่ metadata ไม่ครบ: null ไม่เดาตัวเลข", () => {
    expect(incidentImpact(rollout({ failureCount: 2 }))).toBeNull();
    expect(incidentImpact(rollout(null))).toBeNull();
  });

  it("แจ้งจากหน้างาน: แสดงอุปกรณ์ที่ช่างรายงาน", () => {
    expect(
      incidentImpact({
        source: "field-report",
        deviceId: "DEV-0103",
        metadata: null,
      }),
    ).toEqual({ summary: "อุปกรณ์ DEV-0103", detail: null });
  });

  it("ประเภทอื่นที่ไม่มีข้อมูลจำนวนเครื่อง: null", () => {
    expect(
      incidentImpact({
        source: "config-sync-writer",
        deviceId: null,
        metadata: { attempts: 3 },
      }),
    ).toBeNull();
  });
});

describe("isIncidentClosed", () => {
  it("resolved, dismissed, rolled_back ถือว่าปิดแล้ว", () => {
    expect(isIncidentClosed("resolved")).toBe(true);
    expect(isIncidentClosed("dismissed")).toBe(true);
    expect(isIncidentClosed("rolled_back")).toBe(true);
  });

  it("open และ investigating ยังไม่ปิด", () => {
    expect(isIncidentClosed("open")).toBe(false);
    expect(isIncidentClosed("investigating")).toBe(false);
  });
});

describe("failedDeviceSample (ตัวอย่างเครื่องที่ล้มเหลว)", () => {
  const ids = Array.from({ length: 20 }, (_, i) => `DEV-${String(i + 1).padStart(4, "0")}`);
  const rollout = (metadata: Record<string, unknown> | null) => ({
    source: "rollout-failure",
    metadata,
  });

  it("จำกัดจำนวนที่แสดง และนับที่เหลือจาก failureCount ไม่ใช่จำนวนรหัสที่เก็บไว้", () => {
    const sample = failedDeviceSample(
      rollout({ failedDeviceIds: ids, failureCount: 25 }),
      3,
    );
    expect(sample).toEqual({
      shown: ["DEV-0001", "DEV-0002", "DEV-0003"],
      remaining: 22,
    });
  });

  it("ไม่จำกัด: แสดงทุกรหัสที่เก็บไว้ และบอกจำนวนที่เกิน 20 เครื่อง", () => {
    const sample = failedDeviceSample(
      rollout({ failedDeviceIds: ids, failureCount: 25 }),
    );
    expect(sample?.shown).toHaveLength(20);
    expect(sample?.remaining).toBe(5);
  });

  it("ล้มเหลวไม่เกินที่แสดง: ไม่มี 'และอีก'", () => {
    expect(
      failedDeviceSample(
        rollout({ failedDeviceIds: ["DEV-1", "DEV-2"], failureCount: 2 }),
        3,
      ),
    ).toEqual({ shown: ["DEV-1", "DEV-2"], remaining: 0 });
  });

  it("ไม่มี failureCount: นับจากรหัสที่เก็บไว้ ไม่ติดลบ", () => {
    expect(
      failedDeviceSample(rollout({ failedDeviceIds: ["DEV-1", "DEV-2"] }), 1),
    ).toEqual({ shown: ["DEV-1"], remaining: 1 });
  });

  it("ไม่ใช่ Rollout หรือไม่มีรหัสเครื่องเก็บไว้: null", () => {
    expect(
      failedDeviceSample({
        source: "field-report",
        metadata: { failedDeviceIds: ["DEV-1"] },
      }),
    ).toBeNull();
    expect(failedDeviceSample(rollout({ failedDeviceIds: [] }))).toBeNull();
    expect(failedDeviceSample(rollout(null))).toBeNull();
  });

  it("ข้ามค่าที่ไม่ใช่ข้อความหรือว่าง", () => {
    expect(
      failedDeviceSample(
        rollout({ failedDeviceIds: ["DEV-1", 5, "", null], failureCount: 1 }),
      ),
    ).toEqual({ shown: ["DEV-1"], remaining: 0 });
  });
});

describe("incidentSampleErrors", () => {
  it("คืนข้อผิดพลาดตัวอย่างของ Rollout", () => {
    expect(
      incidentSampleErrors({
        source: "rollout-failure",
        metadata: { sampleErrors: ["timeout", "checksum ไม่ตรง"] },
      }),
    ).toEqual(["timeout", "checksum ไม่ตรง"]);
  });

  it("ไม่ใช่ Rollout หรือไม่มีข้อมูล: อาร์เรย์ว่าง", () => {
    expect(
      incidentSampleErrors({
        source: "field-report",
        metadata: { sampleErrors: ["x"] },
      }),
    ).toEqual([]);
    expect(
      incidentSampleErrors({ source: "rollout-failure", metadata: null }),
    ).toEqual([]);
  });
});

describe("incidentRolloutHref", () => {
  it("ลิงก์ไปหน้า Rollout ต้นทางเมื่อมี campaignId และ rolloutId", () => {
    expect(
      incidentRolloutHref({
        source: "rollout-failure",
        metadata: { campaignId: "c-1", rolloutId: "r-9" },
      }),
    ).toBe("/campaigns/c-1/rollouts/r-9");
  });

  it("ข้อมูลไม่ครบ หรือไม่ใช่ Rollout: null", () => {
    expect(
      incidentRolloutHref({
        source: "rollout-failure",
        metadata: { campaignId: "c-1" },
      }),
    ).toBeNull();
    expect(
      incidentRolloutHref({
        source: "config-sync-writer",
        metadata: { campaignId: "c-1", rolloutId: "r-9" },
      }),
    ).toBeNull();
  });
});

describe("rolloutImpactBar (แถบสัดส่วนในการ์ด)", () => {
  const rollout = (metadata: Record<string, unknown> | null) => ({
    source: "rollout-failure",
    metadata,
  });

  it("คำนวณสัดส่วนล้มเหลวและถูกข้ามจากจำนวนเครื่องเป้าหมาย", () => {
    expect(
      rolloutImpactBar(
        rollout({ failureCount: 5, skippedCount: 2, targetCount: 20 }),
      ),
    ).toEqual({ failedPct: 25, skippedPct: 10 });
  });

  it("ไม่มีเครื่องถูกข้าม: skippedPct เป็น 0", () => {
    expect(
      rolloutImpactBar(rollout({ failureCount: 1, targetCount: 4 })),
    ).toEqual({ failedPct: 25, skippedPct: 0 });
  });

  it("รวมกันไม่เกิน 100", () => {
    const bar = rolloutImpactBar(
      rollout({ failureCount: 9, skippedCount: 9, targetCount: 10 }),
    );
    expect(bar).not.toBeNull();
    expect((bar?.failedPct ?? 0) + (bar?.skippedPct ?? 0)).toBeLessThanOrEqual(
      100,
    );
  });

  it("ไม่ใช่ Rollout, metadata ไม่ครบ หรือเป้าหมายเป็น 0: null", () => {
    expect(
      rolloutImpactBar({
        source: "field-report",
        metadata: { failureCount: 1, targetCount: 2 },
      }),
    ).toBeNull();
    expect(rolloutImpactBar(rollout({ failureCount: 1 }))).toBeNull();
    expect(
      rolloutImpactBar(rollout({ failureCount: 0, targetCount: 0 })),
    ).toBeNull();
    expect(rolloutImpactBar(rollout(null))).toBeNull();
  });
});

describe("isIncidentActive / canRetryConfigSync", () => {
  const syncIncident = {
    source: "config-sync-writer",
    status: "open" as const,
    relatedConfigId: "cfg-1",
    metadata: { versionNumber: 2 },
  };

  it("open และ investigating ยังต้องตาม ที่เหลือปิดแล้ว", () => {
    expect(isIncidentActive("open")).toBe(true);
    expect(isIncidentActive("investigating")).toBe(true);
    expect(isIncidentActive("resolved")).toBe(false);
    expect(isIncidentActive("dismissed")).toBe(false);
    expect(isIncidentActive("rolled_back")).toBe(false);
  });

  it("เขียน Config ที่ยังไม่ปิดและมี Config กับเวอร์ชันครบ: ลองเขียนใหม่ได้", () => {
    expect(canRetryConfigSync(syncIncident)).toBe(true);
    expect(canRetryConfigSync({ ...syncIncident, status: "investigating" })).toBe(
      true,
    );
  });

  it("ปิดแล้ว, ไม่ใช่ Incident เขียน Config หรือข้อมูลไม่พอ: ลองเขียนใหม่ไม่ได้", () => {
    expect(canRetryConfigSync({ ...syncIncident, status: "resolved" })).toBe(
      false,
    );
    expect(
      canRetryConfigSync({ ...syncIncident, source: "rollout-failure" }),
    ).toBe(false);
    expect(canRetryConfigSync({ ...syncIncident, relatedConfigId: null })).toBe(
      false,
    );
    expect(canRetryConfigSync({ ...syncIncident, metadata: null })).toBe(false);
    expect(
      canRetryConfigSync({ ...syncIncident, metadata: { versionNumber: "2" } }),
    ).toBe(false);
  });
});
