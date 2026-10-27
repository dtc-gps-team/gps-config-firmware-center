import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { DeviceConfigOverrideDetailView } from "./device-config-override-detail-view";
import type { DeviceConfigOverride } from "@/lib/device-config-override-api";
import type { ConfigFieldDefinition } from "@/lib/config-definition-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

vi.mock("@/hooks/use-user-names", () => ({
  useUserNames: () => ({ resolveName: (id: string) => `ชื่อของ ${id}` }),
}));

type Q<T> = { data: T | null; isLoading: boolean; error: string | null };
const q = <T,>(data: T | null, over: Partial<Q<T>> = {}): Q<T> => ({
  data,
  isLoading: false,
  error: null,
  ...over,
});

const state = vi.hoisted(() => ({
  override: {} as Q<unknown>,
  definitions: {} as Q<unknown>,
}));

vi.mock("@/hooks/use-device-config-override", () => ({
  useDeviceConfigOverride: () => ({ ...state.override, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-config-definitions", () => ({
  useConfigDefinitions: () => ({ ...state.definitions, refetch: vi.fn() }),
}));

function makeFieldDef(
  overrides: Partial<ConfigFieldDefinition>,
): ConfigFieldDefinition {
  return {
    id: "def-1",
    fieldName: "FIELD",
    dataType: "string",
    allowedValues: [],
    required: false,
    unknownSpec: false,
    description: null,
    unit: null,
    stOverridable: false,
    category: null,
    sensitive: false,
    restartRequired: false,
    defaultValue: null,
    supportedModels: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function item(overrides: Partial<DeviceConfigOverride> = {}): DeviceConfigOverride {
  return {
    id: "ov-1",
    deviceId: "DTC-0001",
    configId: "cfg-1",
    versionNumber: 2,
    fields: { COMMAND_PASSWORD: "s3cr3t", SERVER_PORT: 8080 },
    reason: "ลูกค้าขอเปลี่ยนค่าหน้างาน",
    status: "pending",
    overriddenBy: "user-st-1",
    overriddenAt: "2026-01-01T00:00:00Z",
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    ...overrides,
  };
}

describe("DeviceConfigOverrideDetailView", () => {
  beforeEach(() => {
    state.definitions = q<ConfigFieldDefinition[]>([
      makeFieldDef({ fieldName: "COMMAND_PASSWORD", sensitive: true }),
      makeFieldDef({ fieldName: "SERVER_PORT", sensitive: false }),
    ]);
  });

  it("กำลังโหลด -> แสดงโครงรอ ไม่พัง", () => {
    state.override = q<DeviceConfigOverride>(null, { isLoading: true });
    render(<DeviceConfigOverrideDetailView id="ov-1" />);

    expect(screen.queryByText("DTC-0001")).not.toBeInTheDocument();
  });

  it("โหลดพลาด -> แสดงข้อความ error พร้อมปุ่มลองใหม่", () => {
    state.override = q<DeviceConfigOverride>(null, { error: "โหลดไม่สำเร็จ" });
    render(<DeviceConfigOverrideDetailView id="ov-1" />);

    expect(screen.getByText("โหลดไม่สำเร็จ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
  });

  it("แสดง deviceId, เหตุผล, เวอร์ชัน, ผู้ส่งคำขอ (resolve ชื่อแทน UUID) และสถานะรออนุมัติ", () => {
    state.override = q<DeviceConfigOverride>(item());
    render(<DeviceConfigOverrideDetailView id="ov-1" />);

    expect(screen.getByText("DTC-0001")).toBeInTheDocument();
    expect(screen.getByText("ลูกค้าขอเปลี่ยนค่าหน้างาน")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("ชื่อของ user-st-1")).toBeInTheDocument();
    expect(screen.getByText("รอการอนุมัติ")).toBeInTheDocument();
    // ยังอยู่ในคิว ไม่ควรเห็น Notice ว่า "ไม่อยู่ในคิวแล้ว"
    expect(
      screen.queryByText(/ไม่อยู่ในคิวรออนุมัติแล้ว/),
    ).not.toBeInTheDocument();
  });

  it("แสดงค่าที่ขอแก้ทุกตัวแบบไม่ตัดทอน และ mask field sensitive", () => {
    state.override = q<DeviceConfigOverride>(item());
    render(<DeviceConfigOverrideDetailView id="ov-1" />);

    expect(screen.getByText("COMMAND_PASSWORD")).toBeInTheDocument();
    expect(screen.queryByText("s3cr3t")).not.toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
    expect(screen.getByText("SERVER_PORT")).toBeInTheDocument();
    expect(screen.getByText("8080")).toBeInTheDocument();
  });

  it("สถานะ rejected -> แสดง Notice ว่าไม่อยู่ในคิวแล้ว พร้อมเหตุผลที่ปฏิเสธ ไม่มีปุ่มตัดสินใจ", () => {
    state.override = q<DeviceConfigOverride>(
      item({
        status: "rejected",
        decidedBy: "user-op-1",
        decidedAt: "2026-01-02T00:00:00Z",
        rejectReason: "ค่าที่ขอไม่เหมาะสม",
      }),
    );
    render(<DeviceConfigOverrideDetailView id="ov-1" />);

    expect(screen.getByText("ถูกปฏิเสธ")).toBeInTheDocument();
    expect(screen.getByText(/ไม่อยู่ในคิวรออนุมัติแล้ว/)).toBeInTheDocument();
    expect(
      screen.getByText("เหตุผลที่ปฏิเสธ: ค่าที่ขอไม่เหมาะสม"),
    ).toBeInTheDocument();
    expect(screen.getByText("ชื่อของ user-op-1")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "อนุมัติ" }),
    ).not.toBeInTheDocument();
  });
});
