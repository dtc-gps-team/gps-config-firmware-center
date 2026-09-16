"use client";

import { useEffect, useRef } from "react";

/**
 * Refetch อัตโนมัติตอนแท็บ/หน้าต่างนี้กลับมาโฟกัส (ไม่ทำ polling ต่อเนื่อง) —
 * แก้ปัญหาข้อมูลค้างระหว่าง role เช่น sw สร้าง Config แล้ว auditor ที่เปิดหน้า
 * Audit Log ค้างไว้ในอีกแท็บ ต้องกด browser refresh ถึงจะเห็นของใหม่
 *
 * ใช้ ref เก็บ `refetch` ล่าสุดแทนใส่ใน dependency array ของ effect ตรงๆ
 * กัน remove/add listener ใหม่ทุกครั้งที่ตัว `refetch` เปลี่ยน (เช่นตอน filter
 * เปลี่ยนใน useAuditLogs) — subscribe แค่ครั้งเดียวตอน mount
 *
 * ปลอดภัยกับฟอร์มที่ prefill จาก hook เดียวกัน (เช่น ConfigWizard จาก
 * useConfig/useConfigDefinitions) เพราะ state ของฟอร์มเป็น `useState`
 * ตั้งต้นครั้งเดียวตอน mount ไม่มี effect sync ตาม data ที่เปลี่ยนทีหลัง —
 * refetch พื้นหลังจะอัปเดตแค่ข้อมูลอ้างอิง (เช่น deviceModelOptions) ไม่แตะ
 * ค่าที่ผู้ใช้กำลังกรอกอยู่
 */
export function useRefetchOnFocus(refetch: () => void): void {
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  });

  useEffect(() => {
    function handleFocusOrVisible() {
      if (document.visibilityState === "hidden") return;
      refetchRef.current();
    }
    window.addEventListener("focus", handleFocusOrVisible);
    document.addEventListener("visibilitychange", handleFocusOrVisible);
    return () => {
      window.removeEventListener("focus", handleFocusOrVisible);
      document.removeEventListener("visibilitychange", handleFocusOrVisible);
    };
  }, []);
}
