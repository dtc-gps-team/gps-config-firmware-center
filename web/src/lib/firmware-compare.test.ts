import { describe, expect, it } from "vitest";

import type { Firmware } from "@/lib/firmware-api";
import { compareFirmware, firmwareRelease } from "./firmware-compare";

function fw(over: Partial<Firmware>): Firmware {
  return {
    id: "f",
    version: "1.0.0",
    deviceModelCompatibility: ["A"],
    uploadStatus: "stored",
    deviceUpdateStatus: "unknown",
    objectKey: "k",
    originalFilename: "fw.bin",
    fileSizeBytes: 100,
    checksumSha256: "aa",
    uploadedBy: "u",
    uploadedAt: "2026-10-01T00:00:00Z",
    approvalStatus: "approved",
    approvedBy: null,
    ...over,
  };
}

describe("firmwareRelease", () => {
  it("prioritises upload problems over review state", () => {
    expect(firmwareRelease({ uploadStatus: "failed", approvalStatus: "approved" })).toBe("upload_failed");
    expect(firmwareRelease({ uploadStatus: "pending", approvalStatus: "approved" })).toBe("uploading");
    expect(firmwareRelease({ uploadStatus: "stored", approvalStatus: "rejected" })).toBe("rejected");
    expect(firmwareRelease({ uploadStatus: "stored", approvalStatus: "pending_review" })).toBe("in_review");
    expect(firmwareRelease({ uploadStatus: "stored", approvalStatus: "approved" })).toBe("ready");
  });
});

describe("compareFirmware", () => {
  it("reports only differing attributes", () => {
    const diff = compareFirmware(
      fw({}),
      fw({ deviceModelCompatibility: ["A", "B"], fileSizeBytes: 150, checksumSha256: "bb" }),
    );
    const names = diff.changes.map((c) => c.fieldName).sort();
    expect(names).toEqual(["SHA-256", "ขนาดไฟล์ (ไบต์)", "โมเดลที่รองรับ"].sort());
    expect(diff.unchangedCount).toBe(3);
  });

  it("is empty for identical attributes", () => {
    expect(compareFirmware(fw({}), fw({ version: "1.0.1" })).changes).toEqual([]);
  });
});
