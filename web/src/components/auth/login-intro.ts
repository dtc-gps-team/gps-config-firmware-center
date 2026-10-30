"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";

const KEY = "gps.loginIntroPlayedAt";
/** เล่นเต็มอีกครั้งเมื่อผ่านไปเท่านี้ (ms) — ราวหนึ่งวันทำงาน: เปิดเว็บเช้านี้เห็นครั้งเดียว
 *  แท็บใหม่/รีโหลดระหว่างวันไม่ต้องดูซ้ำ */
const REPLAY_AFTER_MS = 8 * 60 * 60 * 1000;
/** ระยะที่ถือว่า intro เล่นจบแล้ว (ms) — ต้องยาวกว่าไทม์ไลน์ของโลโก้/การ์ด */
const INTRO_MS = 1900;
/** อยู่หน้านี้นานเท่านี้ขึ้นไปถึงนับว่าดู intro แล้วเมื่อออกจากหน้า */
const MIN_SEEN_MS = 600;

const subscribe = () => () => {};

function readPlayed(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY));
    return at > 0 && Date.now() - at < REPLAY_AFTER_MS;
  } catch {
    return false;
  }
}

/**
 * ควรเล่นแอนิเมชันเปิดหน้า Login เต็มไหม — เล่นครั้งเดียวต่อวันทำงาน (เก็บเวลา
 * ที่เล่นล่าสุดใน localStorage เกิน 8 ชั่วโมงค่อยเล่นใหม่) ครั้งอื่นแสดงภาพสุดท้ายทันที · ข้ามเมื่อผู้ใช้ตั้ง
 * prefers-reduced-motion · storage ใช้ไม่ได้ก็เล่นตามปกติ ไม่ throw
 *
 * ฝั่งเซิร์ฟเวอร์ตอบ "เล่น" เสมอ (ไม่มี storage) ฝั่งเบราว์เซอร์ที่เคยเล่นแล้วจะสลับ
 * เป็น "ไม่เล่น" หลัง hydrate — ผู้เรียกต้องใช้ค่านี้เป็น `key` เพื่อ remount ให้
 * `initial` ถูกต้อง · ตั้งธงว่าเล่นแล้วเมื่อครบ `INTRO_MS` (หรือเมื่อออกจากหน้าก่อน)
 */
export function useShouldPlayIntro(): boolean {
  const played = useSyncExternalStore(subscribe, readPlayed, () => false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const mark = () => {
      try {
        localStorage.setItem(KEY, String(Date.now()));
      } catch {}
    };
    const startedAt = Date.now();
    const id = window.setTimeout(mark, INTRO_MS);
    return () => {
      window.clearTimeout(id);
      // ออกจากหน้าไปแล้วถือว่าดูแล้ว — แต่ไม่นับการ unmount ทันทีของ React StrictMode
      // ตอน dev (ไม่งั้นแอนิเมชันไม่เคยเล่นเลยตอนพัฒนา)
      if (Date.now() - startedAt > MIN_SEEN_MS) mark();
    };
  }, []);

  return !played && !reduce;
}
