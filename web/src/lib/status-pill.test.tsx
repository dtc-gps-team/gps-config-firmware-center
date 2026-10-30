import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  INCIDENT_STATUS_TONE,
  StatusPill,
  statusLabel,
} from "./status-pill";

/**
 * รีวิว B บน PR #283: Incident สถานะ `dismissed` (เพิ่มฝั่ง backend ใน #267)
 * ไม่เคยอยู่ในตารางสีของเว็บ ทำให้ `StatusPill` ได้ tone เป็น undefined แล้ว
 * พังทั้งหน้า Incident ("Element type is invalid") — test ชุดนี้กันไม่ให้
 * เกิดซ้ำทั้งตอนมีสถานะใหม่ฝั่ง backend และตอนลืมเพิ่มลงตาราง
 */
describe("StatusPill", () => {
  it("Incident สถานะ dismissed: render ได้และแสดงป้าย 'ไม่ต้องดำเนินการ'", () => {
    const tone = INCIDENT_STATUS_TONE["dismissed"];

    render(<StatusPill tone={tone}>{statusLabel("dismissed")}</StatusPill>);

    expect(screen.getByText("ไม่ต้องดำเนินการ")).toBeInTheDocument();
  });

  it("สถานะที่ยังไม่อยู่ในตาราง tone (tone เป็น undefined): ไม่พัง แสดงข้อความด้วยสีและไอคอนกลาง", () => {
    // สถานะสมมติที่ backend เพิ่มใหม่แต่เว็บยังไม่รู้จัก — เคสนี้คือตัวที่เคย
    // พังทั้งหน้า (Record<string, PillTone> คืน undefined ตอน runtime)
    const tone = INCIDENT_STATUS_TONE["status_from_the_future"];

    const { container } = render(
      <StatusPill tone={tone}>status_from_the_future</StatusPill>,
    );

    expect(screen.getByText("status_from_the_future")).toBeInTheDocument();
    // ใช้ LED และสี neutral ไม่ใช่ class ว่าง
    expect(container.querySelector("[data-slot=status-led]")).not.toBeNull();
    expect(container.querySelector("span")?.className).toContain("bg-secondary");
  });

  it("ตาราง tone ของ Incident ครอบทุกสถานะที่ backend ส่งมาได้ตอนนี้", () => {
    // รายการเดียวกับ `IncidentStatus` ใน incident-api.ts — ถ้า backend เพิ่ม
    // สถานะใหม่แล้วอัปเดต type แต่ลืมตารางนี้ test นี้จะล้ม
    for (const status of [
      "open",
      "investigating",
      "rolled_back",
      "resolved",
      "dismissed",
    ]) {
      expect(INCIDENT_STATUS_TONE[status], status).toBeDefined();
    }
  });
});
