"use client";

import { useEffect, useState } from "react";

/** คืนค่า `value` ที่หน่วงไว้ `delayMs` — ใช้กับช่องค้นหาที่พิมพ์สด ๆ */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
