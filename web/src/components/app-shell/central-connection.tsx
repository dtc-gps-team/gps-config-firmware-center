"use client";

import { ConnectionIndicator } from "@/components/connection-indicator";
import { useCentralDevices } from "@/hooks/use-central-devices";

/** สถานะการเชื่อมต่อ Server กลางบนแถบบน — ใช้ข้อมูลจริงจาก
 *  `GET /central/devices` (`reachable`) ชุดเดียวกับที่ Dashboard ใช้ */
export function CentralConnection() {
  const { data, isLoading } = useCentralDevices();

  if (data === null && isLoading) {
    return (
      <ConnectionIndicator
        state="unknown"
        label="กำลังตรวจสอบ Server กลาง"
        className="hidden lg:inline-flex"
      />
    );
  }
  if (data?.reachable) {
    return (
      <ConnectionIndicator
        state="online"
        label={data.mode === "mock" ? "Server กลาง (จำลอง)" : "Server กลาง"}
        className="hidden lg:inline-flex"
      />
    );
  }
  return (
    <ConnectionIndicator
      state="offline"
      label="ติดต่อ Server กลางไม่ได้"
      className="hidden lg:inline-flex"
    />
  );
}
