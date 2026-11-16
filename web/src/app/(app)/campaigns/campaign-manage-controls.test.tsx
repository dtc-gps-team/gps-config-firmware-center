import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  AddMembersButton,
  DeleteCampaignButton,
  EditCampaignButton,
  RemoveMemberButton,
} from "./campaign-manage-controls";
import type { Campaign } from "@/lib/campaign-api";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: { accessToken: "tok", role: "Operation" } }),
}));

const updateMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const addMock = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/campaign-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/campaign-api")>(
      "@/lib/campaign-api",
    );
  return {
    ...actual,
    updateCampaign: updateMock,
    deleteCampaign: deleteMock,
    addCampaignTargets: addMock,
    removeCampaignTarget: removeMock,
  };
});

vi.mock("@/hooks/use-devices", () => ({
  useDevices: () => ({
    isLoading: false,
    data: [
      { deviceId: "DEV-0001", modelId: "m-gt06n", deviceModel: "GT06N", status: "installed" },
      { deviceId: "DEV-0002", modelId: "m-gt06n", deviceModel: "GT06N", status: "installed" },
      { deviceId: "DEV-0003", modelId: "m-gt06n", deviceModel: "GT06N", status: "registered" },
      { deviceId: "DEV-0004", modelId: "m-gt06l", deviceModel: "GT06L", status: "installed" },
    ],
  }),
}));

const campaign: Campaign = {
  id: "campaign-1",
  name: "กลุ่มทดสอบ",
  description: null,
  autoRetry: true,
  modelId: null,
  createdBy: "op-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EditCampaignButton", () => {
  it("แก้ชื่อแล้วบันทึก -> เรียก updateCampaign และ onUpdated", async () => {
    updateMock.mockResolvedValue({ ...campaign, name: "ชื่อใหม่" });
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<EditCampaignButton campaign={campaign} onUpdated={onUpdated} />);

    await user.click(screen.getByRole("button", { name: /แก้ไขกลุ่ม/ }));
    const nameInput = screen.getByLabelText("ชื่อกลุ่ม");
    await user.clear(nameInput);
    await user.type(nameInput, "ชื่อใหม่");
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(updateMock).toHaveBeenCalledWith("tok", "campaign-1", {
      name: "ชื่อใหม่",
      description: "",
      autoRetry: true,
    });
  });

  it("ติ๊กปิดลองส่งใหม่อัตโนมัติอย่างเดียว บันทึกได้และส่ง autoRetry=false", async () => {
    updateMock.mockResolvedValue({ ...campaign, autoRetry: false });
    const onUpdated = vi.fn();
    const user = userEvent.setup();
    render(<EditCampaignButton campaign={campaign} onUpdated={onUpdated} />);

    await user.click(screen.getByRole("button", { name: /แก้ไขกลุ่ม/ }));
    const box = screen.getByRole("checkbox", { name: /ลองส่งใหม่อัตโนมัติ/ });
    expect(box).toBeChecked();
    expect(
      screen.getByText(/มีผลทันทีกับ Rollout ที่กำลังรันอยู่/),
    ).toBeInTheDocument();
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(updateMock).toHaveBeenCalledWith("tok", "campaign-1", {
      name: "กลุ่มทดสอบ",
      description: "",
      autoRetry: false,
    });
  });

  it("ยังไม่แก้อะไร -> ปุ่มบันทึกกดไม่ได้", async () => {
    const user = userEvent.setup();
    render(<EditCampaignButton campaign={campaign} onUpdated={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /แก้ไขกลุ่ม/ }));

    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();
  });
});

describe("DeleteCampaignButton", () => {
  it("มี Rollout ค้าง -> ปุ่มกดไม่ได้และไม่เรียก API", async () => {
    const user = userEvent.setup();
    render(
      <DeleteCampaignButton
        campaign={campaign}
        disabledReason="มี Rollout ค้าง"
        onDeleted={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /ลบกลุ่ม/ });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("ยืนยันลบ -> เรียก deleteCampaign แล้ว onDeleted", async () => {
    deleteMock.mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    render(
      <DeleteCampaignButton
        campaign={campaign}
        disabledReason={null}
        onDeleted={onDeleted}
      />,
    );

    await user.click(screen.getByRole("button", { name: /ลบกลุ่ม/ }));
    await user.click(screen.getByRole("button", { name: "ยืนยันลบกลุ่ม" }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(deleteMock).toHaveBeenCalledWith("tok", "campaign-1");
  });
});

describe("AddMembersButton", () => {
  it("แสดงเฉพาะเครื่อง installed ที่ยังไม่อยู่ในกลุ่ม แล้วเพิ่มได้", async () => {
    addMock.mockResolvedValue([]);
    const onAdded = vi.fn();
    const user = userEvent.setup();
    render(
      <AddMembersButton
        campaignId="campaign-1"
        memberDeviceIds={["DEV-0001"]}
        disabledReason={null}
        onAdded={onAdded}
      />,
    );

    await user.click(screen.getByRole("button", { name: /เพิ่มเครื่อง/ }));

    expect(screen.queryByText("DEV-0001")).not.toBeInTheDocument();
    expect(screen.queryByText("DEV-0003")).not.toBeInTheDocument();
    await user.click(screen.getByText("DEV-0002"));
    await user.click(screen.getByRole("button", { name: "เพิ่ม 1 เครื่อง" }));

    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(addMock).toHaveBeenCalledWith("tok", "campaign-1", [
      { deviceId: "DEV-0002" },
    ]);
  });

  it("กลุ่มที่มีรุ่น: แสดงแค่เครื่องรุ่นเดียวกับกลุ่ม", async () => {
    const user = userEvent.setup();
    render(
      <AddMembersButton
        campaignId="campaign-1"
        memberDeviceIds={[]}
        modelId="m-gt06n"
        disabledReason={null}
        onAdded={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /เพิ่มเครื่อง/ }));

    expect(screen.getByText("DEV-0001")).toBeInTheDocument();
    expect(screen.queryByText("DEV-0004")).not.toBeInTheDocument();
  });

  it("กลุ่มเดิมที่ไม่มีรุ่น: เพิ่มเครื่องได้ทุกรุ่นเหมือนเดิม", async () => {
    const user = userEvent.setup();
    render(
      <AddMembersButton
        campaignId="campaign-1"
        memberDeviceIds={[]}
        disabledReason={null}
        onAdded={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /เพิ่มเครื่อง/ }));

    expect(screen.getByText("DEV-0004")).toBeInTheDocument();
  });

  it("มี Rollout ค้าง -> ปุ่มกดไม่ได้", () => {
    render(
      <AddMembersButton
        campaignId="campaign-1"
        memberDeviceIds={[]}
        disabledReason="มี Rollout ค้าง"
        onAdded={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /เพิ่มเครื่อง/ })).toBeDisabled();
  });
});

describe("RemoveMemberButton", () => {
  it("ยืนยันเอาออก -> เรียก removeCampaignTarget แล้ว onRemoved", async () => {
    removeMock.mockResolvedValue(undefined);
    const onRemoved = vi.fn();
    const user = userEvent.setup();
    render(
      <RemoveMemberButton
        campaignId="campaign-1"
        deviceId="DEV-0001"
        disabledReason={null}
        onRemoved={onRemoved}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "เอา DEV-0001 ออกจากกลุ่ม" }),
    );
    await user.click(screen.getByRole("button", { name: "ยืนยันเอาออก" }));

    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(removeMock).toHaveBeenCalledWith("tok", "campaign-1", "DEV-0001");
  });

  it("เหลือเครื่องสุดท้าย (disabledReason) -> ปุ่มกดไม่ได้", () => {
    render(
      <RemoveMemberButton
        campaignId="campaign-1"
        deviceId="DEV-0001"
        disabledReason="กลุ่มต้องเหลืออย่างน้อย 1 เครื่อง"
        onRemoved={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "เอา DEV-0001 ออกจากกลุ่ม" }),
    ).toBeDisabled();
  });
});
