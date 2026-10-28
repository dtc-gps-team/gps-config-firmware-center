import { describe, expect, it } from "vitest";
import { parsePreview } from "./import-config-form";

describe(
  "parsePreview — รองรับไฟล์ 2 format: 'settings' ซ้อนชั้น (ของใหม่, v3.67) และ 'fields' แบน (ของเดิม)",
  () => {
    it('ไฟล์แบบใหม่ "settings" ซ้อนชั้น -> นับจำนวน field จริงจากการ flatten (ไม่ใช่แค่ key ชั้นบนสุด)', () => {
      const result = parsePreview(
        JSON.stringify({
          name: "ทดสอบ",
          deviceModel: "GT06N",
          protocol: "TCP",
          settings: {
            gps: { enabled: true, send_interval_sec: 10 },
            data_server: { protocol: "https" },
          },
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.preview.name).toBe("ทดสอบ");
      // 3 leaf field: gps.enabled, gps.send_interval_sec, data_server.protocol
      expect(result.preview.fieldCount).toBe(3);
      expect(result.preview.missing).toEqual([]);
    });

    it('ไฟล์แบบเดิม "fields" แบน -> ยังทำงานได้ปกติเหมือนก่อนมี settings', () => {
      const result = parsePreview(
        JSON.stringify({
          name: "ไฟล์เก่า",
          deviceModel: "SMARTEYEPLUS",
          protocol: "TCP",
          fields: { APN1: "internet", MTYP: "1" },
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.preview.fieldCount).toBe(2);
      expect(result.preview.missing).toEqual([]);
    });

    it('รุ่นที่ key ไม่มีจุด (เช่น GT06N) ส่งมาเป็น "settings" -> flatten แบบไม่มีผล (no-op) นับได้ถูกต้อง', () => {
      const result = parsePreview(
        JSON.stringify({
          name: "GT06N ผ่าน settings",
          deviceModel: "GT06N",
          protocol: "TCP",
          settings: { APN1: "internet", MTYP: "1", SIM1: "0812345678" },
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.preview.fieldCount).toBe(3);
    });

    it('มีทั้ง "fields" และ "settings" พร้อมกัน -> ok:false (กำกวม ไม่เดาให้ เหมือน backend)', () => {
      const result = parsePreview(
        JSON.stringify({
          name: "กำกวม",
          deviceModel: "GT06N",
          protocol: "TCP",
          fields: { APN1: "internet" },
          settings: { gps: { enabled: true } },
        }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("fields");
      expect(result.error).toContain("settings");
    });

    it('ไม่มีทั้ง "fields" และ "settings" -> preview.missing เตือนก่อนส่งจริง (fieldCount เป็น null)', () => {
      const result = parsePreview(
        JSON.stringify({
          name: "ไม่มี field เลย",
          deviceModel: "GT06N",
          protocol: "TCP",
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.preview.fieldCount).toBeNull();
      expect(result.preview.missing.length).toBeGreaterThan(0);
    });

    it('"settings" ไม่ใช่ object (เช่น string) -> preview.missing มี "settings" เหมือนไม่ส่งมา', () => {
      const result = parsePreview(
        JSON.stringify({
          name: "settings ผิดชนิด",
          deviceModel: "GT06N",
          protocol: "TCP",
          settings: "not-an-object",
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.preview.fieldCount).toBeNull();
      expect(result.preview.missing).toContain("settings");
    });

    it("ขาด name/deviceModel/protocol -> preview.missing บอกครบทุกตัวที่ขาด", () => {
      const result = parsePreview(
        JSON.stringify({ settings: { gps: { enabled: true } } }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.preview.missing).toEqual(
        expect.arrayContaining(["name", "deviceModel", "protocol"]),
      );
    });

    it("JSON parse ไม่ผ่าน -> ok:false", () => {
      const result = parsePreview("{ not valid json");
      expect(result.ok).toBe(false);
    });

    it("JSON เป็น array -> ok:false", () => {
      const result = parsePreview(JSON.stringify([{ name: "x" }]));
      expect(result.ok).toBe(false);
    });
  },
);
