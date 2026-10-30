import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// jsdom ไม่ implement PointerEvent ให้ (#238 review comment ข้อ 3 — เจอตอน
// เขียนเทส CampaignRolloutIncidentPanel ที่ใช้ Checkbox ของ @base-ui/react ซึ่ง
// dispatch PointerEvent จริงตอน click) — polyfill ขั้นต่ำจาก MouseEvent พอให้
// component ที่พึ่ง pointer event (Checkbox/Switch ฯลฯ) ทำงานได้ในเทส ไม่ใช่
// polyfill เต็มสเปก แค่พอให้ field ที่ component พวกนี้อ่านมีค่า
if (typeof window !== "undefined" && !window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

// jsdom ไม่มี matchMedia — ตอบว่าผู้ใช้ตั้ง prefers-reduced-motion ไว้ เพื่อให้
// แอนิเมชันตัวเลข/วงแหวนข้ามไปที่ค่าสุดท้ายทันที เทสอ่านค่าจริงได้ไม่ต้องรอ
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
});
