// ============================
// ESP32 GPS Box — firmware ที่ต่อกับ Central Device Management
//   - ตั้งค่า WiFi + Server ผ่านหน้าเว็บของกล่อง (Captive Portal)
//   - ต่อ WebSocket Gateway (รับคำสั่ง UPDATE_CONFIG / UPDATE_FIRMWARE)
//   - ดึง Config / Firmware จาก Delivery Server (ตรวจ SHA-256 + ลายเซ็น ECDSA ก่อนติดตั้ง)
//   - ส่ง GPS ไป Data Server ตาม Config โดยตรง
// เลือกเวอร์ชันใน version.h หรือ build ทั้ง 3 เวอร์ชันด้วย firmware/build.js
// Partition Scheme ต้องเป็น "Minimal SPIFFS (1.9MB APP with OTA)"
// ============================

#include <Arduino.h>
#include <stdlib.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <esp_image_format.h>
#include <esp_system.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>
#include <mbedtls/base64.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>

#include "version.h"
#include "bootstrap_defaults.h"
#include "signing_key.h"
#include "globals.h"
#include "device_config.h"
#include "net_util.h"
#include "features.h"
#include "mgmt.h"
#include "web_ui.h"

// ให้ firmware ยืนยันตัวเองหลัง OTA (ต่อ Gateway ได้) ก่อนยกเลิก rollback
extern "C" bool verifyRollbackLater() {
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(RESET_BTN_PIN, INPUT_PULLUP);
  delay(1000);  // ให้ GPS บูตก่อน

  bootId = "boot-" + String(esp_random(), HEX);
  Serial.println("ESP32 GPS Box firmware v" FIRMWARE_VERSION " (schema " FW_STR(SCHEMA_VERSION) ")");
  Serial.println(FW_VERSION_TAG);  // ใช้ป้ายเวอร์ชัน เพื่อไม่ให้ compiler ตัดทิ้งจากไฟล์ .bin
  const esp_reset_reason_t resetReason = esp_reset_reason();
  Serial.printf("[boot] reset_reason=%s (%d)\n", resetReasonName(resetReason), (int)resetReason);
  checkOtaTrialAtBoot();
  Serial.println("[ota] " + otaPartitionInfo());

  loadMgmt();
  loadConfig();
  gpsSerial.begin(cfg.gpsBaud, SERIAL_8N1, GPS_RX_PIN, -1);
  loadWifi();

  if (!savedSsid.isEmpty()) {
    if (otaTrial && otaTrialPhase == OtaTrialPhase::WAIT_CONFIRM) {
      WiFi.mode(WIFI_STA);
      WiFi.setHostname(HOSTNAME);
      WiFi.begin(savedSsid.c_str(), savedPass.c_str());
      otaWifiRetryAtMs = millis();
      Serial.println("[ota] WAIT_CONFIRM: starting nonblocking saved Wi-Fi retry");
    } else {
      Serial.println("กำลังเชื่อมต่อ WiFi ที่บันทึกไว้: " + savedSsid);
      if (connectWifi(savedSsid, savedPass)) {
        // First firmware TCP client (features, report, or WebSocket) is reached from loop().
        // Confirm the bootloader trial now, after Wi-Fi, and before any of those clients start.
        confirmBootloaderAfterWifi();
        startWeb();
        startMdns();
        printConnected();
        return;
      }
      Serial.println("เชื่อมต่อไม่สำเร็จ");
    }
  } else {
    Serial.println("ยังไม่มีการตั้งค่า WiFi -> เข้าโหมดตั้งค่า");
  }
  if (otaTrial && otaTrialPhase == OtaTrialPhase::WAIT_CONFIRM) {
    // Keep station mode during a bootloader trial; do not start the AP portal before timeout.
    WiFi.mode(WIFI_STA);
    if (!savedSsid.isEmpty()) WiFi.begin(savedSsid.c_str(), savedPass.c_str());
    otaWifiRetryAtMs = millis();
    Serial.println("[ota] WAIT_CONFIRM: retry saved Wi-Fi in station mode until trial timeout");
    return;
  }
  startSetupMode();
}

void loop() {
  // This runs before featuresLoop so restored Wi-Fi is confirmed before the first firmware TCP client.
  if (otaTrial && otaTrialPhase == OtaTrialPhase::WAIT_CONFIRM && WiFi.status() != WL_CONNECTED &&
      !savedSsid.isEmpty() && (otaWifiRetryAtMs == 0 || millis() - otaWifiRetryAtMs >= 5000)) {
    WiFi.begin(savedSsid.c_str(), savedPass.c_str());
    otaWifiRetryAtMs = millis();
  }
  if (otaTrial && otaTrialPhase == OtaTrialPhase::WAIT_CONFIRM && WiFi.status() == WL_CONNECTED) {
    confirmBootloaderAfterWifi();
    if (otaTrialPhase == OtaTrialPhase::WAIT_WELCOME) {
      startWeb();
      startMdns();
      printConnected();
    }
  }
  if (otaTrial && (otaTrialPhase == OtaTrialPhase::WAIT_CONFIRM || otaTrialPhase == OtaTrialPhase::TIMED_OUT) &&
      millis() - otaTrialStartedMs >= OTA_TRIAL_TIMEOUT_MS) {
    if (!handleOtaTrialTimeout()) startSetupMode();
  }
  if (otaTrial && otaTrialPhase == OtaTrialPhase::NONE && !otaMarkedValid && !otaTrialTimedOut &&
      millis() - otaTrialStartedMs >= OTA_TRIAL_TIMEOUT_MS) {
    if (!handleOtaTrialTimeout()) startSetupMode();
  }
  // Never let any firmware TCP client run while a managed pending image is unconfirmed.
  if (otaTrial && otaTrialPhase == OtaTrialPhase::WAIT_CONFIRM) return;
  resetButtonLoop();
  featuresLoop();
  if (setupMode) setupModeLoop();
  mgmtLoop();
  server.handleClient();
}
