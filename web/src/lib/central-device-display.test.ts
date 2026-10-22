import { describe, expect, it } from "vitest";

import {
  centralCommandActionLabel,
  centralCommandStatusLabel,
  centralCommandStatusTone,
  isCentralCommandInFlight,
  matchModelIdByHardwareModel,
} from "./central-device-display";

describe("central-device-display", () => {
  it("ป้ายสถานะคำสั่งเป็นภาษาไทย และสถานะที่ไม่รู้จักแสดงตามที่ได้รับ", () => {
    expect(centralCommandStatusLabel("SUCCESS")).toBe("สำเร็จ");
    expect(centralCommandStatusLabel("ROLLED_BACK")).toBe("ย้อนกลับแล้ว");
    expect(centralCommandStatusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("tone: สำเร็จ=success ล้มเหลว/ย้อนกลับ/หมดอายุ=danger ระหว่างทาง=progress ไม่รู้จัก=neutral", () => {
    expect(centralCommandStatusTone("SUCCESS")).toBe("success");
    expect(centralCommandStatusTone("FAILED")).toBe("danger");
    expect(centralCommandStatusTone("ROLLED_BACK")).toBe("danger");
    expect(centralCommandStatusTone("EXPIRED")).toBe("danger");
    expect(centralCommandStatusTone("INSTALLING")).toBe("progress");
    expect(centralCommandStatusTone("PENDING")).toBe("progress");
    expect(centralCommandStatusTone("SOMETHING_NEW")).toBe("neutral");
  });

  it("action: รู้จัก Config/Firmware ส่วนอื่นแสดงตามที่ได้รับ", () => {
    expect(centralCommandActionLabel("UPDATE_CONFIG")).toBe("อัปเดต Config");
    expect(centralCommandActionLabel("UPDATE_FIRMWARE")).toBe(
      "อัปเดต Firmware",
    );
    expect(centralCommandActionLabel("REBOOT")).toBe("REBOOT");
  });

  it("isCentralCommandInFlight: จบแล้วคือ SUCCESS/FAILED/ROLLED_BACK/EXPIRED", () => {
    for (const s of ["SUCCESS", "FAILED", "ROLLED_BACK", "EXPIRED"]) {
      expect(isCentralCommandInFlight(s)).toBe(false);
    }
    for (const s of ["PENDING", "DELIVERED", "INSTALLING", "REBOOTING"]) {
      expect(isCentralCommandInFlight(s)).toBe(true);
    }
  });

  it("matchModelIdByHardwareModel: ไม่สนตัวพิมพ์/ช่องว่าง ไม่เจอหรือไม่มีค่าได้ null", () => {
    const models = [
      { id: "m1", name: "ESP32-DEVKIT-V1" },
      { id: "m2", name: "GT06N" },
    ];
    expect(matchModelIdByHardwareModel(" esp32-devkit-v1 ", models)).toBe("m1");
    expect(matchModelIdByHardwareModel("OTHER", models)).toBeNull();
    expect(matchModelIdByHardwareModel(null, models)).toBeNull();
  });
});
