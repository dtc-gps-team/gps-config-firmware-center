import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { RolloutDeviceValuesSummary } from "./rollout-device-values-summary";
import type { CampaignRolloutTarget } from "@/lib/campaign-api";

function target(
  deviceId: string,
  proposedFields: Record<string, unknown> | null,
): CampaignRolloutTarget {
  return {
    id: `t-${deviceId}`,
    rolloutId: "r-1",
    deviceId,
    status: "pending",
    resultDetail: null,
    proposedFields,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const noSensitive = new Set<string>();

describe("RolloutDeviceValuesSummary", () => {
  it("ไม่มีเครื่องไหนมีค่าเฉพาะเครื่อง: ไม่แสดงอะไร", () => {
    const { container } = render(
      <RolloutDeviceValuesSummary
        targets={[target("DEV-1", null), target("DEV-2", {})]}
        templateFields={{ SPEED_LIMIT: 120 }}
        sensitiveFieldNames={noSensitive}
        reason={null}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("แสดงเครื่อง ฟิลด์ ค่าแม่แบบ ค่าใหม่ และเหตุผล", () => {
    render(
      <RolloutDeviceValuesSummary
        targets={[
          target("DEV-1", { SPEED_LIMIT: 180 }),
          target("DEV-2", null),
        ]}
        templateFields={{ SPEED_LIMIT: 120 }}
        sensitiveFieldNames={noSensitive}
        reason="ลูกค้าขอเพดานความเร็วสูงกว่าปกติ"
      />,
    );

    expect(screen.getByText("ค่าเฉพาะเครื่อง")).toBeInTheDocument();
    expect(screen.getByText("(1 เครื่อง)")).toBeInTheDocument();
    expect(screen.getByText("DEV-1")).toBeInTheDocument();
    expect(screen.getByText("SPEED_LIMIT")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("180")).toBeInTheDocument();
    expect(
      screen.getByText("ลูกค้าขอเพดานความเร็วสูงกว่าปกติ"),
    ).toBeInTheDocument();
    expect(screen.queryByText("DEV-2")).not.toBeInTheDocument();
  });

  it("ค่า sensitive ถูกซ่อนทั้งค่าแม่แบบและค่าใหม่", () => {
    render(
      <RolloutDeviceValuesSummary
        targets={[target("DEV-1", { COMMAND_PASSWORD: "new-secret" })]}
        templateFields={{ COMMAND_PASSWORD: "old-secret" }}
        sensitiveFieldNames={new Set(["COMMAND_PASSWORD"])}
        reason="เปลี่ยนรหัส"
      />,
    );

    expect(screen.queryByText("new-secret")).not.toBeInTheDocument();
    expect(screen.queryByText("old-secret")).not.toBeInTheDocument();
    expect(screen.getAllByText("••••••••")).toHaveLength(2);
  });

  it("ค่าที่ backend mask มาแล้ว (role ที่ไม่ใช่ Operation) ไม่ถูกแสดงเป็นค่าจริง", () => {
    render(
      <RolloutDeviceValuesSummary
        targets={[target("DEV-1", { COMMAND_PASSWORD: "********" })]}
        templateFields={null}
        sensitiveFieldNames={new Set(["COMMAND_PASSWORD"])}
        reason={null}
      />,
    );

    expect(screen.queryByText("********")).not.toBeInTheDocument();
    expect(screen.getAllByText("••••••••").length).toBeGreaterThan(0);
  });

  it("ยังโหลด Config แม่แบบไม่ได้: ค่าแม่แบบเป็น - ไม่พัง", () => {
    render(
      <RolloutDeviceValuesSummary
        targets={[target("DEV-1", { SPEED_LIMIT: 180 })]}
        templateFields={null}
        sensitiveFieldNames={noSensitive}
        reason={null}
      />,
    );

    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByText("180")).toBeInTheDocument();
  });
});
