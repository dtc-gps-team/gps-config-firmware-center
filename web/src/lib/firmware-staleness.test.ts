import { describe, expect, it } from "vitest";

import type { Firmware } from "@/lib/firmware-api";
import {
  compareVersions,
  isFirmwareOutdated,
  latestApprovedByModel,
} from "./firmware-staleness";

function fw(over: Partial<Firmware>): Firmware {
  return {
    id: "f",
    version: "1.0.0",
    deviceModelCompatibility: ["GT-100"],
    uploadStatus: "stored",
    deviceUpdateStatus: "unknown",
    objectKey: "k",
    originalFilename: "a.bin",
    fileSizeBytes: 1,
    checksumSha256: null,
    uploadedBy: "u",
    uploadedAt: "2026-10-01T00:00:00Z",
    approvalStatus: "approved",
    approvedBy: null,
    ...over,
  };
}

describe("compareVersions", () => {
  it("compares numerically per segment", () => {
    expect(compareVersions("1.10.0", "1.9.2")).toBeGreaterThan(0);
    expect(compareVersions("v2.0", "2.0.0")).toBe(0);
    expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0);
  });
});

describe("latestApprovedByModel / isFirmwareOutdated", () => {
  const list = [
    fw({ id: "a", version: "1.2.0" }),
    fw({ id: "b", version: "1.10.0" }),
    fw({ id: "c", version: "9.0.0", approvalStatus: "pending_review" }),
    fw({ id: "d", version: "8.0.0", uploadStatus: "failed" }),
  ];

  it("ignores unapproved or failed uploads", () => {
    expect(latestApprovedByModel(list).get("GT-100")?.id).toBe("b");
  });

  it("flags only lower reported versions", () => {
    const latest = latestApprovedByModel(list).get("GT-100");
    expect(isFirmwareOutdated("1.9.0", latest)).toBe(true);
    expect(isFirmwareOutdated("1.10.0", latest)).toBe(false);
    expect(isFirmwareOutdated(null, latest)).toBe(false);
    expect(isFirmwareOutdated("1.0.0", undefined)).toBe(false);
  });
});
