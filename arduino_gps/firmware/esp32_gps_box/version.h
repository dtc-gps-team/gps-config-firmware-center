#pragma once

// ============================
// เลือกเวอร์ชัน firmware
//   FW_MINOR 0 -> v1.0.0  GPS + ส่งข้อมูลไป Data Server          (schema 1)
//   FW_MINOR 1 -> v1.1.0  + ตรวจจับความเร็วเกิน (OVERSPEED)       (schema 2)
//   FW_MINOR 2 -> v1.2.x  + แจ้งเตือนออกนอกพื้นที่ (GEOFENCE)     (schema 3)
// build.js ใส่ -DFW_MAJOR/-DFW_MINOR/-DFW_PATCH ให้เอง
// ============================
#ifndef FW_MAJOR
#define FW_MAJOR 1
#endif
#ifndef FW_MINOR
#define FW_MINOR 0
#endif
#ifndef FW_PATCH
#define FW_PATCH 0
#endif

#define FW_STR_(x) #x
#define FW_STR(x) FW_STR_(x)

#define FIRMWARE_VERSION FW_STR(FW_MAJOR) "." FW_STR(FW_MINOR) "." FW_STR(FW_PATCH)
// schema เขียนเป็นตัวเลขตรง ๆ (ใช้ทั้งในโค้ดและในป้ายเวอร์ชันของไฟล์ .bin)
#if FW_MINOR == 0
#define SCHEMA_VERSION 1
#elif FW_MINOR == 1
#define SCHEMA_VERSION 2
#elif FW_MINOR == 2
#define SCHEMA_VERSION 3
#else
#error "เพิ่ม SCHEMA_VERSION ของ firmware เวอร์ชันนี้"
#endif
#define HARDWARE_MODEL "ESP32-DEVKIT-V1"

#define FEATURE_SPEED_LIMIT (FW_MINOR >= 1)
#define FEATURE_GEOFENCE (FW_MINOR >= 2)

// ป้ายเวอร์ชันฝังในไฟล์ .bin — delivery-server อ่านจากไฟล์ได้เอง (ไม่ต้องกรอกเวอร์ชันตอนอัปโหลด)
static const char FW_VERSION_TAG[] = "@@FWVER:" FIRMWARE_VERSION ";SCHEMA:" FW_STR(SCHEMA_VERSION) ";MODEL:" HARDWARE_MODEL "@@";
