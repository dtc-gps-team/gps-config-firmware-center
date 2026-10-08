import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { usePollInterval } from "./use-poll-interval";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("usePollInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("เรียก refetch ทุก intervalMs ตอนแท็บ visible", () => {
    const refetch = vi.fn();
    renderHook(() => usePollInterval(refetch, 20_000));

    expect(refetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20_000);
    expect(refetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(40_000);
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it("แท็บถูกซ่อน (hidden) -> ข้ามรอบนั้น ไม่เรียก refetch", () => {
    const refetch = vi.fn();
    renderHook(() => usePollInterval(refetch, 20_000));

    setVisibility("hidden");
    vi.advanceTimersByTime(20_000);
    expect(refetch).not.toHaveBeenCalled();

    setVisibility("visible");
    vi.advanceTimersByTime(20_000);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("unmount แล้วเลิก poll ทันที", () => {
    const refetch = vi.fn();
    const { unmount } = renderHook(() => usePollInterval(refetch, 20_000));

    unmount();
    vi.advanceTimersByTime(60_000);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("เรียก refetch เวอร์ชันล่าสุดเสมอ แม้ identity เปลี่ยนระหว่างทาง (ไม่ reset interval)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ fn }: { fn: () => void }) => usePollInterval(fn, 20_000),
      { initialProps: { fn: first } },
    );

    rerender({ fn: second });
    vi.advanceTimersByTime(20_000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
