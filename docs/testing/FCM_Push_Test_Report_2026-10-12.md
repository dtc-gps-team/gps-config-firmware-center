# ผลทดสอบ push จริง — PR #279 (รอบ 2)

วันที่ทดสอบ: 12 ต.ค. 2026

## Environment

| รายการ | ค่า |
|---|---|
| Firebase project | `gps-config-firmware-center-dev` (ตรวจ `project_id` ในไฟล์ service account ก่อนเปิดโหมด fcm) |
| Backend | `NOTIFICATION_MODE=fcm`, port 3001, DB local (Docker postgres 5433) — startup ไม่มี error, log `notification mode = fcm` |
| App | flavor `dev`, package `com.example.mobile.dev` (ยืนยันด้วย `aapt dump badging`), build debug, `PUSH_NOTIFICATIONS_ENABLED=true`, `API_BASE_URL=http://10.0.2.2:3001/api/v1` |
| Emulator | AVD `Pixel_10a` (emulator-5554), Android 17 / API 37, image `google_apis_playstore`, **ไม่มี Google account sign in** (Accounts: 0) |
| Commit ที่ทดสอบ | `b21e3b9` (local `feat/mobile-fcm-push`) + การแก้ flavor ที่ยังไม่ commit — origin head ปัจจุบัน `298f20d` ต่างจากนี้แค่ merge main (#276) |
| Users | `st.test` (ST) = user A, `ot.test` (OT) = user B, สร้างงานด้วย `operation.test` ผ่าน `POST /tasks` |

## สรุป

| ข้อ | ผล |
|---|---|
| a. รับ push จริง (foreground + background) | **ผ่าน** |
| b. เปิดจาก terminated แล้วกด notification | **ผ่าน** (ดูข้อสังเกตเรื่องวิธี kill) |
| c. ไม่รับ push ของ user เดิมหลัง logout/login | **ผ่าน** |

ไม่พบบั๊ก

## a. รับ push จริง

ขั้นตอน:
1. login เป็น `st.test` ค้างอยู่ในแอป, DB มี `DeviceToken` ของ st.test 1 แถว (token ยาว 142 ตัว)
2. foreground: แอปเปิดอยู่หน้า Home → `POST /tasks` ด้วย `operation.test` มอบหมายงาน `PUSH_A_foreground` ให้ st.test
   - `dumpsys notification` พบ notification ของ `com.example.mobile.dev` channel `push_default` title "มอบหมายงานใหม่" text "PUSH_A_foreground"
   - แอปแสดงเป็น system notification ไม่ใช่ banner ในแอป (ตามที่ implement ไว้: foreground ก็แสดง local notification)
3. background: กด Home แล้วสร้างงาน `PUSH_A_background` → ขึ้นใน notification shade (ภาพจากเครื่องยืนยัน: "มอบหมายงานใหม่ PUSH_A_background")
4. ตรวจ token: แถวใน `DeviceToken` ถูกสร้างโดยแอปผ่าน `POST /notifications/device-tokens` และ backend ใช้ token นี้ยิง (`findMany` ตาม userId) — การส่งถึงเครื่องได้จริงเป็นหลักฐานว่าตรงกัน (ไม่ได้ดึง token ฝั่งแอปมาเทียบตัวต่อตัว)
5. backend log ไม่มี warn/error ตลอดการทดสอบ

## b. เปิดจาก terminated แล้วกด notification

ขั้นตอน:
1. กด Home แล้ว `am kill com.example.mobile.dev` → `pidof` ว่าง (process ตาย), package ไม่อยู่ในสถานะ stopped
2. สร้างงาน `PUSH_B_terminated` ให้ st.test ขณะแอปตาย → notification ขึ้น และมี process ใหม่ (pid 12054) ถูกปลุกโดย FCM
3. kill process อีกรอบ (pid ว่าง) แล้วกดที่ notification
4. แอป cold start (pid ใหม่ 12297) → เปิดหน้า "รายละเอียดงาน" ของงาน `PUSH_B_terminated` ถูกต้อง และยัง login อยู่ (session restore ไม่ค้างที่ splash หรือหน้า error) ไม่ชนกับ flush ของ #276

ข้อสังเกต: **ไม่ได้ใช้ `am force-stop`** เพราะ Android ไม่ส่ง FCM ให้แอปที่ถูก force stop จนกว่าผู้ใช้จะเปิดแอปเอง (ไม่ใช่บั๊กของแอป) ใช้ `am kill` ที่จำลอง process ถูกระบบฆ่าแทน และไม่ได้ทดสอบ swipe-kill จาก recents ด้วยมือ ข้อนี้ทดสอบตอน login ค้างอยู่ ไม่ได้ทดสอบเคสที่ยังไม่ login จริง

## c. ไม่รับ push ของ user เดิมหลัง logout/login

ขั้นตอน:
1. บันทึก token ของ st.test (user A) จาก DB เก็บไว้
2. logout บนแอป → `DeviceToken` ใน DB เหลือ 0 แถว (ลบฝั่ง server จริง)
3. login เป็น `ot.test` (user B) บนเครื่องเดิม ไม่ลบแอป → DB มี token ใหม่ 1 แถวของ ot.test และไม่ตรงกับ token เดิมของ A (นับแถวที่ token = ของ A ได้ 0)
4. ผ่าน backend: สร้างงาน `PUSH_C_to_userA_via_backend` ให้ A → backend log: "user … ไม่มี device token ที่ลงทะเบียนไว้ — ข้าม notification" ไม่มี notification ขึ้นในเครื่อง
5. ยิงตรงไปที่ token เดิมของ A ด้วย Firebase Admin SDK (service account dev, สคริปต์ชั่วคราว) → FCM ตอบ `messaging/registration-token-not-registered` (token เดิมถูกยกเลิกที่ FCM แล้วจากการ `deleteToken` ตอน logout) และไม่มี notification ขึ้นในเครื่อง
6. control: สร้างงาน `PUSH_C_control_for_userB` ให้ B → notification ขึ้นในเครื่องปกติ (พิสูจน์ว่าช่องทางส่งยังทำงานระหว่างทดสอบ)

## ที่ไม่ได้ทดสอบ / ข้อจำกัด

- ไม่มี Google account บน emulator แต่ FCM ทำงานได้ตามปกติในทุกข้อข้างบน
- type ที่ทดสอบมีแค่ `task_assigned` (`incident_report_*` ต้องรอ #286)
- ไม่ได้ทดสอบกรณี logout แล้วเครื่องออฟไลน์ (deleteToken ล้มเหลว)
- ข้อ b: kill ด้วย `am kill` ไม่ใช่ swipe จาก recents

## ข้อมูลทดสอบที่เหลือใน DB local

งานใหม่ 5 งาน (`PUSH_A_foreground`, `PUSH_A_background`, `PUSH_B_terminated`, `PUSH_C_to_userA_via_backend`, `PUSH_C_control_for_userB`) และ notification ที่ผูกกัน
