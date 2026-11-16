#pragma once

// ค่าเริ่มต้นที่แสดงในหน้าตั้งค่า (แก้ทีหลังได้จากหน้าตั้งค่าของกล่อง ไม่ต้องแฟลชใหม่)
// ws://, http:// ใช้ทดสอบในวง LAN เท่านั้น — production ให้ใช้ wss:// และ https://
#define DEFAULT_DEVICE_ID "BOX-0001"
#define DEFAULT_GATEWAY_URL "ws://192.168.1.100:3018/ws/device"
#define DEFAULT_DELIVERY_URL "http://192.168.1.100:3019"

// รหัสกล่องที่ใช้ร่วมกันทุกกล่อง (ไม่ต้องกรอกในหน้าตั้งค่า)
// ต้องตรงกับค่าที่ใช้ลงทะเบียนกล่องที่ Gateway และ Delivery (Postman: device_shared_token)
#define DEFAULT_DEVICE_TOKEN "1234"

// พิกัดเริ่มต้นเมื่อยังจับสัญญาณ GPS ไม่ได้ (แสดงบนหน้าเว็บ + ส่งไป Data Server พร้อม location_source = "default")
#define DEFAULT_LATITUDE "13.68035928547147"
#define DEFAULT_LONGITUDE "100.60300413252199"

// ============================
// ฮาร์ดแวร์
// ============================
#define GPS_RX_PIN 13
#define LED_PIN 2  // LED บนบอร์ด ESP32 DevKit
#define RESET_BTN_PIN 0  // ปุ่ม BOOT: กดค้าง 3 วินาที = ลบ WiFi เข้าโหมดตั้งค่า
