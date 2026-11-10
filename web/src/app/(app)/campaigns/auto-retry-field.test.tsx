import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AutoRetryField } from "./auto-retry-field";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const settingsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/campaign-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/campaign-api")>(
      "@/lib/campaign-api",
    );
  return { ...actual, getCampaignAutoRetrySettings: settingsMock };
});

function renderField(checked = true) {
  return render(
    <AutoRetryField id="x" checked={checked} onChange={() => {}} />,
  );
}

beforeEach(() => {
  settingsMock.mockReset();
});

describe("AutoRetryField: จำนวนครั้งที่ส่งซ้ำตามค่าจาก backend", () => {
  it("ระหว่างโหลดใช้ค่าเริ่มต้น (รวม 3 ครั้ง = ส่งซ้ำสูงสุด 2 ครั้ง)", () => {
    settingsMock.mockReturnValue(new Promise(() => {}));
    renderField();

    expect(
      screen.getByText(/ระบบจะส่งซ้ำให้เองสูงสุด 2 ครั้ง/),
    ).toBeInTheDocument();
  });

  it("backend ตั้งรวม 5 ครั้ง: ข้อความเปลี่ยนเป็นส่งซ้ำสูงสุด 4 ครั้ง", async () => {
    settingsMock.mockResolvedValue({ maxAttempts: 5 });
    renderField();

    expect(
      await screen.findByText(/ระบบจะส่งซ้ำให้เองสูงสุด 4 ครั้ง/),
    ).toBeInTheDocument();
  });

  it("โหลดค่าไม่สำเร็จ: ใช้ค่าเริ่มต้น ไม่ทำให้ช่องพัง", async () => {
    settingsMock.mockRejectedValue(new Error("boom"));
    renderField();

    expect(
      await screen.findByText(/ระบบจะส่งซ้ำให้เองสูงสุด 2 ครั้ง/),
    ).toBeInTheDocument();
  });

  it("backend ตั้งรวม 1 ครั้ง (ไม่มีส่งซ้ำ): ไม่โกหกว่าจะส่งซ้ำ", async () => {
    settingsMock.mockResolvedValue({ maxAttempts: 1 });
    renderField();

    expect(
      await screen.findByText("ถ้าส่งไม่สำเร็จ จะไม่ส่งซ้ำ"),
    ).toBeInTheDocument();
  });

  it("ปิดสวิตช์: บอกว่าจะไม่ส่งซ้ำเหมือนเดิม", () => {
    settingsMock.mockReturnValue(new Promise(() => {}));
    renderField(false);

    expect(screen.getByText("ถ้าส่งไม่สำเร็จ จะไม่ส่งซ้ำ")).toBeInTheDocument();
  });
});
