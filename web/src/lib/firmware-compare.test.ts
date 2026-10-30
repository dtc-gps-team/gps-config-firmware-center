import { describe, expect, it } from "vitest";

import { firmwareRelease } from "./firmware-compare";

describe("firmwareRelease", () => {
  it("prioritises upload problems over review state", () => {
    expect(
      firmwareRelease({ uploadStatus: "failed", approvalStatus: "approved" }),
    ).toBe("upload_failed");
    expect(
      firmwareRelease({ uploadStatus: "pending", approvalStatus: "approved" }),
    ).toBe("uploading");
    expect(
      firmwareRelease({ uploadStatus: "stored", approvalStatus: "rejected" }),
    ).toBe("rejected");
    expect(
      firmwareRelease({
        uploadStatus: "stored",
        approvalStatus: "pending_review",
      }),
    ).toBe("in_review");
    expect(
      firmwareRelease({ uploadStatus: "stored", approvalStatus: "approved" }),
    ).toBe("ready");
  });
});
