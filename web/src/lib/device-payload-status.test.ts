import { describe, expect, it } from "vitest";

import { DEVICE_PAYLOAD_STATUSES } from "@/lib/device-api";
import {
  DEVICE_PAYLOAD_STATUS_TONE,
  devicePayloadStatusHint,
  devicePayloadStatusLabel,
} from "./device-payload-status";

describe("device-payload-status", () => {
  it("ทุกสถานะที่ backend คืนมา (up_to_date/pending/failed/unknown) มีสี ป้าย และคำอธิบาย", () => {
    for (const status of DEVICE_PAYLOAD_STATUSES) {
      expect(DEVICE_PAYLOAD_STATUS_TONE[status], status).toBeDefined();
      for (const kind of ["config", "firmware"] as const) {
        expect(devicePayloadStatusLabel(kind, status), status).not.toBe("");
        expect(devicePayloadStatusHint(kind, status), status).not.toBe("");
      }
    }
  });

  it("สีสื่อความหมาย: สำเร็จเขียว, รอผลส้ม, ล้มเหลวแดง, ยังไม่เคยเข้า Rollout เทา", () => {
    expect(DEVICE_PAYLOAD_STATUS_TONE.up_to_date).toBe("success");
    expect(DEVICE_PAYLOAD_STATUS_TONE.pending).toBe("progress");
    expect(DEVICE_PAYLOAD_STATUS_TONE.failed).toBe("danger");
    expect(DEVICE_PAYLOAD_STATUS_TONE.unknown).toBe("neutral");
  });

  it("สถานะ pending แยกป้ายตามชนิด: Config รอรับ, Firmware รอติดตั้ง", () => {
    expect(devicePayloadStatusLabel("config", "pending")).toBe("รอรับ Config");
    expect(devicePayloadStatusLabel("firmware", "pending")).toBe(
      "รอติดตั้ง Firmware",
    );
  });
});
