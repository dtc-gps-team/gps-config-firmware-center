import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ParameterCreateForm } from "./parameter-create-form";
import type { DeviceModel } from "@/lib/device-model-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "ConfigEngineer" } }),
}));

const createConfigDefinition = vi.fn();
vi.mock("@/lib/config-definition-api", () => ({
  createConfigDefinition: (...args: unknown[]) =>
    createConfigDefinition(...args),
}));

const models: DeviceModel[] = [
  {
    id: "m1",
    name: "GT06N",
    manufacturer: null,
    supportedProtocols: ["TCP"],
    status: "active",
    warrantyMonths: null,
    endOfSupportDate: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

function setup() {
  return render(
    <ParameterCreateForm
      deviceModels={models}
      existingNames={new Set()}
      onCreated={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("ชื่อ field"), "max_speed_alert");
  await user.click(screen.getByRole("checkbox", { name: /GT06N/ }));
}

/** เปิด dropdown "ชนิดข้อมูล" แล้วเลือกตัวเลือกที่ขึ้นต้นด้วยข้อความนี้ —
 * ใช้ findByRole (รอ/retry) กัน flaky จาก animation ปิด/เปิด listbox ของ
 * base-ui ตอนเปิดซ้ำหลายรอบในเทสเดียว */
async function selectDataType(
  user: ReturnType<typeof userEvent.setup>,
  startsWith: string,
) {
  await user.click(screen.getByLabelText("ชนิดข้อมูล"));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByText(new RegExp(`^${startsWith}:`)));
}

describe(
  "ParameterCreateForm — ช่วงค่า Min/Max (docs/30 §2 ข้อ 2, เฉพาะชนิดตัวเลข)",
  () => {
    it("ชนิดข้อมูลเริ่มต้น (string) -> ไม่เห็นช่อง Min/Max", () => {
      setup();
      expect(screen.queryByLabelText(/ค่าต่ำสุด/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/ค่าสูงสุด/)).not.toBeInTheDocument();
    });

    it("เลือกชนิดข้อมูล integer -> เห็นช่อง Min/Max", async () => {
      const user = userEvent.setup();
      setup();

      await selectDataType(user, "integer");

      expect(screen.getByLabelText(/ค่าต่ำสุด/)).toBeInTheDocument();
      expect(screen.getByLabelText(/ค่าสูงสุด/)).toBeInTheDocument();
    });

    it("กรอก Min/Max แล้วสลับชนิดข้อมูลออกจากตัวเลข -> ช่องหาย และค่าถูกล้าง", async () => {
      const user = userEvent.setup();
      setup();

      await selectDataType(user, "integer");
      await user.type(screen.getByLabelText(/ค่าต่ำสุด/), "1");
      await user.type(screen.getByLabelText(/ค่าสูงสุด/), "200");

      await selectDataType(user, "string");
      expect(screen.queryByLabelText(/ค่าต่ำสุด/)).not.toBeInTheDocument();

      // สลับกลับไป integer ค่าต้องถูกล้างแล้ว ไม่ใช่ค่าเดิมที่กรอกไว้ก่อนหน้า
      await selectDataType(user, "integer");
      expect(screen.getByLabelText(/ค่าต่ำสุด/)).toHaveValue(null);
    });

    it("min มากกว่า max -> แจ้ง error ไม่ส่ง request", async () => {
      const user = userEvent.setup();
      setup();
      await fillRequired(user);

      await selectDataType(user, "integer");
      await user.type(screen.getByLabelText(/ค่าต่ำสุด/), "100");
      await user.type(screen.getByLabelText(/ค่าสูงสุด/), "1");
      await user.click(screen.getByRole("button", { name: "บันทึก Parameter" }));

      expect(
        await screen.findByText("ค่าต่ำสุดต้องไม่มากกว่าค่าสูงสุด"),
      ).toBeInTheDocument();
      expect(createConfigDefinition).not.toHaveBeenCalled();
    });

    it("กรอก Min/Max ถูกต้อง -> ส่ง minValue/maxValue เป็นตัวเลขไปกับ request", async () => {
      createConfigDefinition.mockResolvedValue({ id: "new" });
      const user = userEvent.setup();
      setup();
      await fillRequired(user);

      await selectDataType(user, "integer");
      await user.type(screen.getByLabelText(/ค่าต่ำสุด/), "1");
      await user.type(screen.getByLabelText(/ค่าสูงสุด/), "200");
      await user.click(screen.getByRole("button", { name: "บันทึก Parameter" }));

      expect(createConfigDefinition).toHaveBeenCalledWith(
        "tok",
        expect.objectContaining({ minValue: 1, maxValue: 200 }),
      );
    });

    it("ไม่กรอก Min/Max เลย -> ไม่ส่ง minValue/maxValue ไปใน request", async () => {
      createConfigDefinition.mockResolvedValue({ id: "new" });
      const user = userEvent.setup();
      setup();
      await fillRequired(user);

      await selectDataType(user, "integer");
      await user.click(screen.getByRole("button", { name: "บันทึก Parameter" }));

      const sent = createConfigDefinition.mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(sent).not.toHaveProperty("minValue");
      expect(sent).not.toHaveProperty("maxValue");
    });
  },
);
