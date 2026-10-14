import { describe, expect, it } from "vitest";

import {
  incidentSourceLabel,
  incidentTechnicalDetails,
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
