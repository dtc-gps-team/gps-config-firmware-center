import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_ROLLOUT_STATUS_TONE,
  CAMPAIGN_ROLLOUT_TARGET_STATUS_TONE,
  getRolloutStatusExplanation,
  rolloutStatusLabel,
} from "./status-pill";

describe("rolloutStatusLabel", () => {
  it("ทุกสถานะของ Rollout เป็นภาษาไทย ไม่มีอังกฤษดิบหรือขีดล่างหลุดออกมา", () => {
    for (const status of Object.keys(CAMPAIGN_ROLLOUT_STATUS_TONE)) {
      const label = rolloutStatusLabel(status);
      expect(label).not.toMatch(/[a-z_]/);
    }
    expect(rolloutStatusLabel("active")).toBe("กำลังทำงาน");
    expect(rolloutStatusLabel("paused")).toBe("หยุดชั่วคราว");
    expect(rolloutStatusLabel("completed")).toBe("เสร็จสิ้น");
    expect(rolloutStatusLabel("pending_approval")).toBe("รออนุมัติ");
  });

  it("สถานะที่ไม่รู้จักแสดงตามที่ได้รับ", () => {
    expect(rolloutStatusLabel("something_new")).toBe("something_new");
  });
});

describe("getRolloutStatusExplanation", () => {
  it("คำอธิบายเป็นภาษาธรรมดา ไม่มีศัพท์เทคนิคของระบบจำลอง", () => {
    for (const status of Object.keys(CAMPAIGN_ROLLOUT_STATUS_TONE)) {
      const text = getRolloutStatusExplanation(status);
      expect(text).not.toMatch(/PULL|apply|payload/i);
    }
    expect(getRolloutStatusExplanation("active")).toContain("ตารางด้านล่าง");
    expect(getRolloutStatusExplanation("paused")).toContain("Resume");
    expect(getRolloutStatusExplanation("paused")).toContain("Rollback");
  });
});

describe("สีของสถานะรายเครื่อง", () => {
  it("ข้ามเพราะออฟไลน์ใช้สีเหลืองอำพัน แยกจากรอผล (เทา) และล้มเหลว (แดง)", () => {
    expect(CAMPAIGN_ROLLOUT_TARGET_STATUS_TONE.skipped_offline).toBe("progress");
    expect(CAMPAIGN_ROLLOUT_TARGET_STATUS_TONE.pending).toBe("neutral");
    expect(CAMPAIGN_ROLLOUT_TARGET_STATUS_TONE.failed).toBe("danger");
  });
});
