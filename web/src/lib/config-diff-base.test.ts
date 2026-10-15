import { describe, expect, it } from "vitest";

import {
  resolveDiffBase,
  type DiffBaseInput,
} from "./config-diff-base";
import type { Config, ConfigVersion } from "@/lib/config-api";

function version(n: number, fields: Record<string, unknown>): ConfigVersion {
  return {
    id: `v${n}`,
    configId: "cfg",
    versionNumber: n,
    deviceModel: "GT06N",
    protocol: "TCP",
    fields,
    approvedBy: "op-1",
    approvedAt: "2026-01-01T00:00:00Z",
  };
}

function source(overrides: Partial<Config> = {}): Config {
  return {
    id: "src-1",
    name: "ต้นทาง",
    deviceModel: "GT06N",
    protocol: "TCP",
    description: null,
    status: "approved",
    fields: { APN: "current" },
    createdBy: "u1",
    approvedBy: "op-1",
    suggestedApproverId: null,
    clonedFromId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const idle = { isLoading: false, error: null, data: null };

function input(overrides: Partial<DiffBaseInput> = {}): DiffBaseInput {
  return {
    config: { clonedFromId: null, deviceModel: "GT06N", protocol: "TCP" },
    ownVersions: { isLoading: false, error: null, data: [] },
    source: idle,
    sourceVersions: idle,
    ...overrides,
  };
}

describe("resolveDiffBase", () => {
  it("ยังโหลดเวอร์ชันของตัวเองอยู่: loading", () => {
    expect(
      resolveDiffBase(
        input({ ownVersions: { isLoading: true, error: null, data: null } }),
      ),
    ).toEqual({ kind: "loading" });
  });

  it("โหลดเวอร์ชันของตัวเองล้มเหลว: own-error", () => {
    expect(
      resolveDiffBase(
        input({
          ownVersions: { isLoading: false, error: "พัง", data: null },
        }),
      ),
    ).toEqual({ kind: "own-error", message: "พัง" });
  });

  it("เคยอนุมัติแล้ว: ใช้เวอร์ชันล่าสุดของตัวเอง (ไม่พึ่งลำดับ) แม้เป็นสำเนา", () => {
    const result = resolveDiffBase(
      input({
        config: { clonedFromId: "src-1", deviceModel: "GT06N", protocol: "TCP" },
        ownVersions: {
          isLoading: false,
          error: null,
          data: [version(3, { A: 3 }), version(1, { A: 1 })],
        },
        source: { isLoading: false, error: null, data: source() },
      }),
    );

    expect(result).toEqual({ kind: "own", fields: { A: 3 }, versionNumber: 3 });
  });

  it("ไม่ใช่สำเนาและยังไม่เคยอนุมัติ: none", () => {
    expect(resolveDiffBase(input())).toEqual({ kind: "none" });
  });

  it("สำเนา: เทียบกับเวอร์ชันที่อนุมัติล่าสุดของต้นทาง ไม่ใช่ค่าปัจจุบัน", () => {
    const result = resolveDiffBase(
      input({
        config: { clonedFromId: "src-1", deviceModel: "GT06N", protocol: "TCP" },
        source: {
          isLoading: false,
          error: null,
          data: source({ fields: { APN: "draft-edit" } }),
        },
        sourceVersions: {
          isLoading: false,
          error: null,
          data: [version(1, { APN: "v1" }), version(2, { APN: "v2" })],
        },
      }),
    );

    expect(result).toEqual({
      kind: "source-version",
      fields: { APN: "v2" },
      versionNumber: 2,
      sourceId: "src-1",
      sourceName: "ต้นทาง",
      crossModel: null,
    });
  });

  it("ต้นทางไม่เคยอนุมัติ: ถอยไปเทียบกับค่าปัจจุบันของต้นทาง", () => {
    const result = resolveDiffBase(
      input({
        config: { clonedFromId: "src-1", deviceModel: "GT06N", protocol: "TCP" },
        source: {
          isLoading: false,
          error: null,
          data: source({ status: "draft", fields: { APN: "current" } }),
        },
        sourceVersions: { isLoading: false, error: null, data: [] },
      }),
    );

    expect(result).toMatchObject({
      kind: "source-current",
      fields: { APN: "current" },
      sourceName: "ต้นทาง",
    });
  });

  it("ต้นทางต่างโมเดลหรือโปรโตคอล: ระบุ crossModel", () => {
    const result = resolveDiffBase(
      input({
        config: { clonedFromId: "src-1", deviceModel: "GT06L", protocol: "TCP" },
        source: { isLoading: false, error: null, data: source() },
        sourceVersions: {
          isLoading: false,
          error: null,
          data: [version(1, { APN: "x" })],
        },
      }),
    );

    expect(result).toMatchObject({
      kind: "source-version",
      crossModel: { deviceModel: "GT06N", protocol: "TCP" },
    });
  });

  it("ต้นทางเปิดไม่ได้ (ถูกลบหรือโหลดล้มเหลว): source-unavailable ไม่ throw", () => {
    const result = resolveDiffBase(
      input({
        config: { clonedFromId: "src-1", deviceModel: "GT06N", protocol: "TCP" },
        source: { isLoading: false, error: "ไม่พบ Config", data: null },
      }),
    );

    expect(result.kind).toBe("source-unavailable");
  });

  it("โหลดเวอร์ชันของต้นทางล้มเหลว: source-unavailable", () => {
    const result = resolveDiffBase(
      input({
        config: { clonedFromId: "src-1", deviceModel: "GT06N", protocol: "TCP" },
        source: { isLoading: false, error: null, data: source() },
        sourceVersions: { isLoading: false, error: "พัง", data: null },
      }),
    );

    expect(result.kind).toBe("source-unavailable");
  });

  it("ต้นทางหรือเวอร์ชันของต้นทางยังโหลดอยู่: loading", () => {
    const loadingSource = resolveDiffBase(
      input({
        config: { clonedFromId: "src-1", deviceModel: "GT06N", protocol: "TCP" },
        source: { isLoading: true, error: null, data: null },
      }),
    );
    const loadingVersions = resolveDiffBase(
      input({
        config: { clonedFromId: "src-1", deviceModel: "GT06N", protocol: "TCP" },
        source: { isLoading: false, error: null, data: source() },
        sourceVersions: { isLoading: true, error: null, data: null },
      }),
    );

    expect(loadingSource).toEqual({ kind: "loading" });
    expect(loadingVersions).toEqual({ kind: "loading" });
  });
});
