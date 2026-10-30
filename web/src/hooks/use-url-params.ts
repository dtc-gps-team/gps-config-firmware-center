"use client";

import { useCallback, useRef, useState } from "react";

/**
 * เก็บค่าตัวกรอง/มุมมองของหน้าไว้ใน query string (URL เป็น source of truth)
 * เปิดลิงก์ตรงแล้วได้มุมมองเดิม · เปลี่ยนค่าใช้ replaceState (ไม่เพิ่มประวัติ Back)
 * ค่าที่เท่ากับ default ไม่เขียนลง URL · `defaults` ต้องเป็นค่าคงที่ระดับโมดูล
 */
export function useUrlParams<T extends Record<string, string>>(defaults: T) {
  const [values, setValues] = useState<T>(() => readParams(defaults));
  const valuesRef = useRef(values);

  const update = useCallback(
    (patch: Partial<T>) => {
      const next = { ...valuesRef.current, ...patch } as T;
      valuesRef.current = next;
      setValues(next);
      writeParams(next, defaults);
    },
    [defaults],
  );

  const reset = useCallback(() => {
    valuesRef.current = defaults;
    setValues(defaults);
    writeParams(defaults, defaults);
  }, [defaults]);

  return { values, update, reset };
}

function readParams<T extends Record<string, string>>(defaults: T): T {
  if (typeof window === "undefined") return defaults;
  const search = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const key of Object.keys(defaults)) {
    out[key] = search.get(key) ?? defaults[key];
  }
  return out as T;
}

function writeParams<T extends Record<string, string>>(values: T, defaults: T) {
  const search = new URLSearchParams(window.location.search);
  for (const key of Object.keys(defaults)) {
    if (values[key] === defaults[key]) search.delete(key);
    else search.set(key, values[key]);
  }
  const qs = search.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`,
  );
}
