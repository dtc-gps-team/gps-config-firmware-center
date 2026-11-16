#pragma once

#include "ota_trial_policy.h"

// ============================
// Management: WebSocket ไป Gateway + ทำคำสั่ง UPDATE_CONFIG / UPDATE_FIRMWARE
// ============================

const uint32_t OTA_TRIAL_TIMEOUT_MS = 180000;  // firmware ใหม่ต้องต่อ Gateway ได้ภายใน 3 นาที ไม่งั้น rollback

OtaTrialPhase otaTrialPhase = OtaTrialPhase::NONE;
uint8_t otaTrialBoots = 0;
uint32_t otaTrialStartedMs = 0;
String otaPreviousPartitionLabel;
bool otaTrialStateReady = true;
bool otaRollbackImageVerified = false;
bool otaTrialTimedOut = false;
uint32_t otaWifiRetryAtMs = 0;

// ============================
// ข้อมูลสำหรับหน้าเว็บมอนิเตอร์การอัปเดต
// ============================
struct UpdateMonitor {
  bool active = false;
  String commandId;
  String action;
  String target;
  String status;
  String error;
  int progress = -1;
  uint32_t changedMs = 0;
};
UpdateMonitor upd;

const uint8_t UPDATE_LOG_SIZE = 15;
String updateLog[UPDATE_LOG_SIZE];
uint8_t updateLogNext = 0;

void logUpdate(const String &text) {
  uint32_t s = millis() / 1000;
  char ts[12];
  snprintf(ts, sizeof(ts), "%02lu:%02lu:%02lu", (unsigned long)(s / 3600), (unsigned long)(s / 60 % 60), (unsigned long)(s % 60));
  updateLog[updateLogNext] = String(ts) + "  " + text;
  updateLogNext = (updateLogNext + 1) % UPDATE_LOG_SIZE;
}

// รายการค่าที่เปลี่ยน เช่น "led.enabled: true → false"
void logConfigDiff(const DeviceConfig &before, const DeviceConfig &after) {
  JsonDocument a, b;
  configToJson(before, a.to<JsonObject>());
  configToJson(after, b.to<JsonObject>());
  int changes = 0;
  for (JsonPair g : b.as<JsonObject>()) {
    for (JsonPair kv : g.value().as<JsonObject>()) {
      String oldV = a[g.key()][kv.key()].as<String>();
      String newV = kv.value().as<String>();
      if (oldV != newV) {
        logUpdate(String("   ") + g.key().c_str() + "." + kv.key().c_str() + ": " + oldV + " → " + newV);
        changes++;
      }
    }
  }
  if (!changes) logUpdate("   (ค่าไม่เปลี่ยน)");
}

// เก็บผลคำสั่งที่จบแล้วไว้ตอบซ้ำ (idempotent) เมื่อ Gateway ส่งคำสั่งเดิมมาอีก
struct DoneCmd {
  String id;
  String action;
  String status;
  String error;
};
DoneCmd doneCmds[8];
uint8_t doneNext = 0;

void wsSend(JsonDocument &doc) {
  String s;
  serializeJson(doc, s);
  ws.sendTXT(s);
}

void sendStatus(const Command &c, const char *status, int progress = -1, const char *error = nullptr, const String &detail = String()) {
  JsonDocument d;
  d["type"] = "COMMAND_STATUS";
  d["device_id"] = mgmt.deviceId;
  d["command_id"] = c.id;
  d["status"] = status;
  if (progress >= 0) d["progress_percent"] = progress;
  if (c.action == "UPDATE_FIRMWARE") d["reported_firmware_version"] = FIRMWARE_VERSION;
  if (c.action == "UPDATE_CONFIG") d["reported_config_version"] = cfg.version;
  if (error) d["error_code"] = error;
  if (detail.length()) d["error_detail"] = detail.substring(0, 200);  // เช่น ข้อความ error จาก server
  wsSend(d);
  lastCommandText = c.id + " " + c.action + " " + c.target + " -> " + status + (error ? String(" (") + error + ")" : "");
  Serial.println("[cmd] " + lastCommandText);

  String st = status;
  bool newStep = upd.commandId != c.id || upd.status != st;
  upd.commandId = c.id;
  upd.action = c.action;
  upd.target = c.target;
  upd.status = st;
  upd.error = error ? error : "";
  upd.progress = progress;
  upd.changedMs = millis();
  upd.active = st != "SUCCESS" && st != "FAILED" && st != "ROLLED_BACK";
  if (newStep) {
    String what = c.action == "UPDATE_FIRMWARE" ? "Firmware → v" + c.target : "Config → version " + c.target;
    logUpdate(what + " : " + st + (error ? String(" (") + error + ")" : ""));
  }
}

void finishCommand(const Command &c, const char *status, const char *error = nullptr, const String &detail = String()) {
  sendStatus(c, status, -1, error, detail);
  doneCmds[doneNext] = { c.id, c.action, status, error ? error : "" };
  doneNext = (doneNext + 1) % 8;
}

const DoneCmd *findDone(const String &id) {
  for (const DoneCmd &d : doneCmds) {
    if (d.id == id) return &d;
  }
  return nullptr;
}

// ============================
// UPDATE_CONFIG
// ============================
void applyConfig(const DeviceConfig &next) {
  bool baudChanged = next.gpsBaud != cfg.gpsBaud;
  cfg = next;
  saveConfig(cfg);
  if (baudChanged) {
    gpsSerial.end();
    gpsSerial.begin(cfg.gpsBaud, SERIAL_8N1, GPS_RX_PIN, -1);
  }
}

void doConfigUpdate(const Command &c) {
  uint32_t target = c.target.toInt();
  if (cfg.version == target) {
    finishCommand(c, "SUCCESS");
    return;
  }
  sendStatus(c, "ACKNOWLEDGED");

  HttpResult r = httpJson("GET", mgmt.deliveryUrl + "/api/device/me/config", "", true);
  if (r.code != 200) {
    finishCommand(c, "FAILED", ("CONFIG_HTTP_" + String(r.code)).c_str(), r.body);
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, r.body)) {
    finishCommand(c, "FAILED", "CONFIG_INVALID_JSON");
    return;
  }
  if (doc["config_version"].as<uint32_t>() != target) {
    finishCommand(c, "FAILED", "CONFIG_VERSION_MISMATCH");
    return;
  }
  // schema เพิ่ม parameter อย่างเดียว จึงรับ config ของ schema เดิมหรือเก่ากว่าได้
  int sv = doc["schema_version"] | 0;
  if (sv < 1 || sv > SCHEMA_VERSION) {
    finishCommand(c, "FAILED", "SCHEMA_NOT_SUPPORTED");
    return;
  }

  DeviceConfig next = cfg;
  String err;
  if (!parseSettings(doc["settings"].as<JsonObjectConst>(), next, err)) {
    finishCommand(c, "FAILED", err.c_str());
    return;
  }
  next.version = target;
  logUpdate("ได้รับ config_version " + String(target) + " จาก Server");
  logConfigDiff(cfg, next);
  applyConfig(next);
  reportPending = !sendReport();
  finishCommand(c, "SUCCESS");
}

// ============================
// UPDATE_FIRMWARE (OTA + ตรวจ SHA-256 + ลายเซ็น ECDSA)
// ============================
bool verifyFirmwareSignature(const uint8_t hash[32], const String &sigB64) {
  uint8_t sig[128];
  size_t sigLen = 0;
  if (mbedtls_base64_decode(sig, sizeof(sig), &sigLen, (const unsigned char *)sigB64.c_str(), sigB64.length()) != 0) return false;
  mbedtls_pk_context pk;
  mbedtls_pk_init(&pk);
  int rc = mbedtls_pk_parse_public_key(&pk, (const unsigned char *)FIRMWARE_SIGNING_PUBLIC_KEY, strlen(FIRMWARE_SIGNING_PUBLIC_KEY) + 1);
  if (rc == 0) rc = mbedtls_pk_verify(&pk, MBEDTLS_MD_SHA256, hash, 32, sig, sigLen);
  mbedtls_pk_free(&pk);
  return rc == 0;
}

String toHex(const uint8_t *b, size_t n) {
  static const char *hex = "0123456789abcdef";
  String s;
  s.reserve(n * 2);
  for (size_t i = 0; i < n; i++) {
    s += hex[b[i] >> 4];
    s += hex[b[i] & 15];
  }
  return s;
}

// ข้อมูล partition ปัจจุบัน (ใช้วินิจฉัยเมื่อ OTA ไม่ได้)
String otaPartitionInfo() {
  const esp_partition_t *run = esp_ota_get_running_partition();
  const esp_partition_t *next = esp_ota_get_next_update_partition(nullptr);
  char buf[160];
  snprintf(buf, sizeof(buf), "running=%s@0x%lx next=%s size=%lu heap=%lu",
           run ? run->label : "none", run ? (unsigned long)run->address : 0UL,
           next ? next->label : "none", next ? (unsigned long)next->size : 0UL,
           (unsigned long)ESP.getMaxAllocHeap());
  return buf;
}

void saveOtaRecord(const String &cmdId, const String &target) {
  prefs.begin("ota", false);
  prefs.putString("cmd", cmdId);
  prefs.putString("target", target);
  prefs.putString("from", FIRMWARE_VERSION);
  prefs.end();
}

void clearOtaRecord() {
  prefs.begin("ota", false);
  prefs.clear();
  prefs.end();
}

String otaRecordCmd() {
  prefs.begin("ota", true);
  String id = prefs.getString("cmd", "");
  prefs.end();
  return id;
}

String otaRecordTarget() {
  prefs.begin("ota", true);
  String target = prefs.getString("target", "");
  prefs.end();
  return target;
}

bool saveOtaTrialRecord(OtaTrialPhase phase, uint8_t boots, const String &previousLabel, const String &target) {
  if (previousLabel.isEmpty() || target.isEmpty()) return false;
  if (!prefs.begin("ota_trial", false)) return false;
  bool ok = prefs.putUChar("phase", (uint8_t)phase) > 0;
  ok = (prefs.putUChar("boots", boots) > 0) && ok;
  ok = (prefs.putString("previous", previousLabel) > 0) && ok;
  ok = (prefs.putString("target", target) > 0) && ok;
  prefs.end();
  return ok;
}

bool loadOtaTrialRecord(OtaTrialPhase &phase, uint8_t &boots, String &previousLabel, String &target) {
  if (!prefs.begin("ota_trial", true)) return false;
  uint8_t rawPhase = prefs.getUChar("phase", 0);
  boots = prefs.getUChar("boots", 0);
  previousLabel = prefs.getString("previous", "");
  target = prefs.getString("target", "");
  prefs.end();
  if (rawPhase != (uint8_t)OtaTrialPhase::WAIT_CONFIRM &&
      rawPhase != (uint8_t)OtaTrialPhase::WAIT_WELCOME &&
      rawPhase != (uint8_t)OtaTrialPhase::TIMED_OUT) return false;
  phase = (OtaTrialPhase)rawPhase;
  return boots > 0 && !previousLabel.isEmpty() && !target.isEmpty();
}

void clearOtaTrialRecord() {
  if (!prefs.begin("ota_trial", false)) return;
  prefs.clear();
  prefs.end();
  otaTrialPhase = OtaTrialPhase::NONE;
  otaTrialBoots = 0;
  otaPreviousPartitionLabel = "";
  otaTrialStateReady = true;
  otaRollbackImageVerified = false;
  otaTrialTimedOut = false;
}

const esp_partition_t *findBootablePreviousPartition(const String &label) {
  if (label.isEmpty()) return nullptr;
  const esp_partition_t *partition = esp_partition_find_first(
      ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_ANY, label.c_str());
  if (!partition) return nullptr;

  esp_partition_pos_t position;
  position.offset = partition->address;
  position.size = partition->size;
  esp_image_metadata_t metadata = {};
  if (esp_image_verify(ESP_IMAGE_VERIFY, &position, &metadata) != ESP_OK) return nullptr;
  return partition;
}

bool confirmBootloaderAfterWifi() {
  if (WiFi.status() != WL_CONNECTED) return false;
#if defined(OTA_TEST_CRASH_AFTER_CONFIRM_EVERY_BOOT) && OTA_TEST_CRASH_AFTER_CONFIRM_EVERY_BOOT
  if (otaTrial && otaTrialPhase == OtaTrialPhase::WAIT_WELCOME && otaMarkedValid &&
      otaTrialBoots <= OTA_TRIAL_MAX_BOOT_COUNT) {
    Serial.println("[ota-test] intentional crash after prior bootloader confirm on every trial boot");
    delay(100);
    abort();
  }
#endif
  if (otaTrialTimedOut || !otaTrialStateReady || !otaRollbackImageVerified ||
      otaTrialPhase != OtaTrialPhase::WAIT_CONFIRM) return false;

  const OtaTrialAction action = decideOtaTrial(
      otaTrialPhase, OtaTrialEvent::WIFI_READY, otaTrialBoots, otaRollbackImageVerified);
  if (action != OtaTrialAction::MARK_BOOTLOADER_VALID) return false;

  // Persist app rollback state before clearing bootloader rollback protection.
  if (!saveOtaTrialRecord(OtaTrialPhase::WAIT_WELCOME, otaTrialBoots,
                          otaPreviousPartitionLabel, otaRecordTarget())) {
    otaTrialStateReady = false;
    Serial.println("[ota] บันทึก app trial ลง NVS ไม่สำเร็จ; คง bootloader rollback ไว้");
    return false;
  }

  esp_err_t err = esp_ota_mark_app_valid_cancel_rollback();
  if (err != ESP_OK) {
    saveOtaTrialRecord(OtaTrialPhase::WAIT_CONFIRM, otaTrialBoots,
                       otaPreviousPartitionLabel, otaRecordTarget());
    Serial.printf("[ota] mark app valid หลัง Wi-Fi ไม่สำเร็จ: %s (%d)\n", esp_err_to_name(err), (int)err);
    return false;
  }

  otaTrialPhase = OtaTrialPhase::WAIT_WELCOME;
  otaMarkedValid = true;
  Serial.println("[ota] Wi-Fi พร้อม; bootloader ยืนยันแล้ว กำลังรอ WELCOME สำหรับ app trial");
  logUpdate("Wi-Fi พร้อม; รอ Gateway WELCOME เพื่อผ่าน app trial");

#if defined(OTA_TEST_CRASH_AFTER_CONFIRM_EVERY_BOOT) && OTA_TEST_CRASH_AFTER_CONFIRM_EVERY_BOOT
  Serial.println("[ota-test] intentional crash after bootloader confirm on every trial boot");
  delay(100);
  abort();
#endif
  return true;
}

void rollbackToPreviousPartition(const char *reason) {
  const esp_partition_t *previous = findBootablePreviousPartition(otaPreviousPartitionLabel);
  const OtaTrialAction action = decideOtaTrial(
      OtaTrialPhase::WAIT_WELCOME, OtaTrialEvent::TIMEOUT,
      otaTrialBoots, previous != nullptr);
  if (action != OtaTrialAction::APP_ROLLBACK) {
    Serial.printf("[ota] %s แต่ rollback target %s บูตไม่ได้; อยู่ต่อโดยไม่รีบูตวน\n",
                  reason, otaPreviousPartitionLabel.c_str());
    logUpdate("rollback target ใช้ไม่ได้; firmware ทำงานต่อและไม่ reboot วน");
    otaTrialStartedMs = millis();
    return;
  }

  Serial.printf("[ota] %s -> ตรวจพบ rollback target %s บูตได้\n", reason, previous->label);
  esp_err_t err = esp_ota_set_boot_partition(previous);
  if (err != ESP_OK) {
    Serial.printf("[ota] ตั้ง boot partition กลับไม่สำเร็จ: %s (%d); อยู่ต่อ\n", esp_err_to_name(err), (int)err);
    logUpdate("ตั้ง boot partition กลับไม่สำเร็จ; firmware ทำงานต่อ");
    otaTrialStartedMs = millis();
    return;
  }
  Serial.printf("[ota] ตั้ง boot partition กลับเป็น %s แล้ว กำลังรีบูต\n", previous->label);
  delay(100);
  ESP.restart();
}

bool handleOtaTrialTimeout() {
  if (otaTrialPhase == OtaTrialPhase::WAIT_CONFIRM || otaTrialPhase == OtaTrialPhase::TIMED_OUT) {
    if (otaTrialPhase == OtaTrialPhase::WAIT_CONFIRM) {
      Serial.println("[ota] ยังยืนยัน bootloader ไม่ได้ก่อน timeout; ขอให้ bootloader rollback");
      otaTrialTimedOut = true;
      otaTrialPhase = OtaTrialPhase::TIMED_OUT;
    }
    esp_err_t err = esp_ota_mark_app_invalid_rollback_and_reboot();
    if (err != ESP_OK) {
      Serial.printf("[ota] bootloader rollback request ไม่สำเร็จ: %s (%d); ทำงานต่อและรอ Gateway\n",
                    esp_err_to_name(err), (int)err);
      logUpdate("bootloader rollback request ไม่สำเร็จ; firmware ทำงานต่อและเชื่อม Gateway");
    }
    otaTrialStartedMs = millis();
    return err == ESP_OK;
  }
  if (otaTrialPhase == OtaTrialPhase::NONE) {
    Serial.println("[ota] pending-verify image ไม่ได้รับ WELCOME ก่อน timeout; ขอให้ bootloader rollback");
    otaTrialTimedOut = true;
    otaTrialPhase = OtaTrialPhase::TIMED_OUT;
    otaTrialBoots = 1;
    const esp_partition_t *previous = esp_ota_get_next_update_partition(nullptr);
    otaPreviousPartitionLabel = previous ? String(previous->label) : "";
    esp_err_t err = esp_ota_mark_app_invalid_rollback_and_reboot();
    if (err != ESP_OK) {
      Serial.printf("[ota] bootloader rollback request ไม่สำเร็จ: %s (%d); ทำงานต่อและรอ Gateway\n",
                    esp_err_to_name(err), (int)err);
      logUpdate("bootloader rollback request ไม่สำเร็จ; firmware ทำงานต่อและเชื่อม Gateway");
    }
    otaTrialStartedMs = millis();
    return err == ESP_OK;
  }
  if (otaTrialPhase == OtaTrialPhase::WAIT_WELCOME) {
    rollbackToPreviousPartition("ไม่พบ WELCOME ภายใน OTA_TRIAL_TIMEOUT_MS");
  }
  return false;
}

void doFirmwareUpdate(const Command &c) {
  if (c.target == FIRMWARE_VERSION) {
    const esp_partition_t *running = esp_ota_get_running_partition();
    esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
    if (!running || esp_ota_get_state_partition(running, &state) != ESP_OK ||
        state == ESP_OTA_IMG_PENDING_VERIFY) {
      Serial.println("[ota] firmware ตรง target แต่ running image ยังไม่ยืนยัน; ไม่ส่ง SUCCESS");
      logUpdate("running image ยังไม่ยืนยัน; งดรายงาน SUCCESS");
      return;
    }
    finishCommand(c, "SUCCESS");
    return;
  }
  sendStatus(c, "ACKNOWLEDGED");

  HttpResult r = httpJson("GET", mgmt.deliveryUrl + "/api/device/me/firmware-manifest?target=" + c.target + "&current=" FIRMWARE_VERSION, "", true);
  if (r.code != 200) {
    finishCommand(c, "FAILED", ("MANIFEST_HTTP_" + String(r.code)).c_str(), r.body);
    return;
  }
  JsonDocument m;
  if (deserializeJson(m, r.body)) {
    finishCommand(c, "FAILED", "MANIFEST_INVALID_JSON");
    return;
  }
  String url = m["url"] | "";
  String sha = m["sha256"] | "";
  String sig = m["signature"] | "";
  size_t size = m["size_bytes"] | 0;
  if (String(m["hardware_model"] | "") != HARDWARE_MODEL) return finishCommand(c, "FAILED", "HARDWARE_MISMATCH");
  if (String(m["version"] | "") != c.target) return finishCommand(c, "FAILED", "VERSION_MISMATCH");
  if (sig.isEmpty()) return finishCommand(c, "FAILED", "UNSIGNED_FIRMWARE");
  const esp_partition_t *next = esp_ota_get_next_update_partition(nullptr);
  // ไม่มี partition สำรองให้ติดตั้ง (แฟลชครั้งแรกเลือก Partition Scheme ที่ไม่มี OTA เช่น Huge APP)
  if (!next || next == esp_ota_get_running_partition()) return finishCommand(c, "FAILED", "NO_OTA_PARTITION", otaPartitionInfo());
  if (!next || size == 0 || size > next->size) return finishCommand(c, "FAILED", "SIZE_NOT_SUPPORTED", String("size=") + size + " " + otaPartitionInfo());

  HttpConn dl;
  if (!dl.begin(url)) return finishCommand(c, "FAILED", "DOWNLOAD_URL_INVALID");
  dl.http.setTimeout(15000);
  int code = dl.http.GET();
  if (code != 200) {
    dl.http.end();
    return finishCommand(c, "FAILED", ("DOWNLOAD_HTTP_" + String(code)).c_str());
  }
  if ((size_t)dl.http.getSize() != size) {
    dl.http.end();
    return finishCommand(c, "FAILED", "SIZE_MISMATCH");
  }
  if (Update.isRunning()) Update.abort();  // งาน OTA เก่าที่ค้างอยู่ (ถ้ามี)
  if (!Update.begin(size)) {
    String why = String("Update error ") + Update.getError() + " (" + Update.errorString() + ") size=" + size + " " + otaPartitionInfo();
    Serial.println("[ota] " + why);
    dl.http.end();
    return finishCommand(c, "FAILED", "UPDATE_BEGIN_FAILED", why);
  }

  mbedtls_sha256_context sha256;
  mbedtls_sha256_init(&sha256);
  mbedtls_sha256_starts(&sha256, 0);
  NetworkClient *stream = dl.http.getStreamPtr();
  static uint8_t buf[2048];
  size_t got = 0;
  int lastStep = -1;
  uint32_t lastData = millis();
  const char *error = nullptr;

  sendStatus(c, "DOWNLOADING", 0);
  while (got < size) {
    size_t avail = stream->available();
    if (avail) {
      size_t want = min(min(avail, sizeof(buf)), size - got);
      int n = stream->readBytes(buf, want);
      if (n > 0) {
        mbedtls_sha256_update(&sha256, buf, n);
        if (Update.write(buf, n) != (size_t)n) {
          error = "FLASH_WRITE_FAILED";
          break;
        }
        got += n;
        lastData = millis();
        int pct = got * 100 / size;
        if (pct / 10 != lastStep) {
          lastStep = pct / 10;
          sendStatus(c, "DOWNLOADING", pct);
        }
      }
    } else if (millis() - lastData > 20000) {
      error = "DOWNLOAD_TIMEOUT";
      break;
    } else {
      delay(2);
    }
    ws.loop();             // รักษา connection กับ Gateway ระหว่างดาวน์โหลด
    server.handleClient();  // ให้หน้าเว็บมอนิเตอร์ดู % ได้
  }
  dl.http.end();

  uint8_t hash[32];
  mbedtls_sha256_finish(&sha256, hash);
  mbedtls_sha256_free(&sha256);
  if (error) {
    Update.abort();
    return finishCommand(c, "FAILED", error);
  }

  sendStatus(c, "VALIDATING");
  if (toHex(hash, 32) != sha) {
    Update.abort();
    return finishCommand(c, "FAILED", "SHA256_MISMATCH");
  }
  if (!verifyFirmwareSignature(hash, sig)) {
    Update.abort();
    return finishCommand(c, "FAILED", "SIGNATURE_INVALID");
  }

  sendStatus(c, "INSTALLING");
  if (!Update.end(true)) return finishCommand(c, "FAILED", "UPDATE_END_FAILED");

  saveOtaRecord(c.id, c.target);
  sendStatus(c, "REBOOTING");
  uint32_t t = millis();
  while (millis() - t < 2500) {  // ให้หน้าเว็บได้เห็นสถานะ REBOOTING ก่อนรีบูต
    ws.loop();
    server.handleClient();
  }
  ws.disconnect();
  delay(200);
  ESP.restart();
}

// หลังรีบูต Gateway จะส่งคำสั่ง OTA เดิมมาอีกครั้ง: ตอบผลตามเวอร์ชันที่รันอยู่จริง
void finishOtaAfterReboot(const Command &c) {
  if (c.target == FIRMWARE_VERSION) {
    const esp_partition_t *running = esp_ota_get_running_partition();
    esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
    const bool stateKnown = running && esp_ota_get_state_partition(running, &state) == ESP_OK;
    if (!stateKnown || state == ESP_OTA_IMG_PENDING_VERIFY) {
      Serial.println("[ota] ยังยืนยันสถานะ running image ไม่ได้หรือยังเป็น PENDING_VERIFY; ไม่ส่ง SUCCESS");
      logUpdate("ยังยืนยัน running image ไม่ได้; งดรายงาน SUCCESS");
      return;
    }
    finishCommand(c, "SUCCESS");
  } else {
    finishCommand(c, "ROLLED_BACK", "NEW_FIRMWARE_FAILED_HEALTH_CHECK");
  }
  clearOtaTrialRecord();
  clearOtaRecord();
}

// ============================
// WebSocket
// ============================
void sendHello() {
  JsonDocument d;
  d["type"] = "HELLO";
  d["device_id"] = mgmt.deviceId;
  d["hardware_model"] = HARDWARE_MODEL;
  d["firmware_version"] = FIRMWARE_VERSION;
  d["schema_version"] = SCHEMA_VERSION;
  d["config_version"] = cfg.version;
  d["boot_id"] = bootId;
  wsSend(d);
}

void sendHeartbeat() {
  JsonDocument d;
  d["type"] = "HEARTBEAT";
  healthJsonFields(d["status"].to<JsonObject>());
  wsSend(d);
}

void onCommand(JsonDocument &doc) {
  Command c;
  c.active = true;
  c.id = doc["command_id"] | "";
  c.action = doc["action"] | "";
  if (c.action == "UPDATE_CONFIG") c.target = String(doc["target_config_version"] | 0);
  else if (c.action == "UPDATE_FIRMWARE") c.target = doc["target_firmware_version"] | "";
  if (c.id.isEmpty()) return;

  // คำสั่งเดิมที่กำลังทำ/รอทำอยู่ -> ไม่ต้องรับซ้ำ
  if ((currentCmd.active && currentCmd.id == c.id) || (queuedCmd.active && queuedCmd.id == c.id)) return;

  // คำสั่งที่จบแล้ว -> ตอบสถานะเดิม
  if (const DoneCmd *d = findDone(c.id)) {
    sendStatus(c, d->status.c_str(), -1, d->error.length() ? d->error.c_str() : nullptr);
    return;
  }

  if (c.action == "UPDATE_FIRMWARE" && c.id == otaRecordCmd()) {
    finishOtaAfterReboot(c);
    return;
  }

  if (c.action != "UPDATE_CONFIG" && c.action != "UPDATE_FIRMWARE") {
    finishCommand(c, "FAILED", "UNSUPPORTED_ACTION");
    return;
  }
  if (!queuedCmd.active) queuedCmd = c;  // ถ้าคิวเต็ม Gateway จะส่งมาใหม่ตอน reconnect
}

void onWsText(uint8_t *payload, size_t length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  String type = doc["type"] | "";

  if (type == "WELCOME") {
    mgmtConnected = true;
    wsBackoffMs = 2000;
    heartbeatIntervalMs = (doc["heartbeat_interval_sec"] | 30) * 1000UL;
    lastServerError = "";
    Serial.printf("[ws] WELCOME pending=%d\n", doc["pending_commands"] | 0);
    logUpdate("เชื่อมต่อ Server ส่วนกลางแล้ว (คำสั่งค้าง " + String(doc["pending_commands"] | 0) + ")");
    // ผ่าน app trial เมื่อได้รับ WELCOME หลัง bootloader ถูกยืนยันแล้ว
    if (otaTrial && otaTrialPhase == OtaTrialPhase::WAIT_WELCOME && otaMarkedValid) {
      const OtaTrialAction action = decideOtaTrial(
          otaTrialPhase, OtaTrialEvent::WELCOME, otaTrialBoots, otaRollbackImageVerified);
      if (action == OtaTrialAction::ACCEPT_TRIAL) {
        clearOtaTrialRecord();
        otaTrial = false;
        Serial.println("[ota] firmware ใหม่ผ่าน app trial (ได้รับ WELCOME)");
        logUpdate("firmware v" FIRMWARE_VERSION " ผ่าน health check (ต่อ Server ได้)");
      }
    }
    if (otaTrial && otaTrialPhase == OtaTrialPhase::NONE && !otaMarkedValid && !otaTrialTimedOut) {
      const OtaTrialAction action = decideOtaTrial(
          OtaTrialPhase::NONE, OtaTrialEvent::WELCOME, otaTrialBoots, false);
      if (action == OtaTrialAction::MARK_BOOTLOADER_VALID) {
        esp_err_t err = esp_ota_mark_app_valid_cancel_rollback();
        if (err == ESP_OK) {
          otaMarkedValid = true;
          otaTrial = false;
          Serial.println("[ota] pending-verify image ผ่าน WELCOME health check");
          logUpdate("firmware v" FIRMWARE_VERSION " ผ่าน WELCOME health check");
        } else {
          Serial.printf("[ota] mark app valid เมื่อ WELCOME ไม่สำเร็จ: %s (%d)\n", esp_err_to_name(err), (int)err);
        }
      }
    }
  } else if (type == "COMMAND") {
    onCommand(doc);
  } else if (type == "ERROR") {
    lastServerError = String(doc["error"] | "") + " " + String(doc["message"] | "");
    Serial.println("[ws] ERROR " + lastServerError);
  }
}

void onWsEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[ws] connected -> HELLO");
      sendHello();
      break;
    case WStype_DISCONNECTED:
      if (mgmtConnected) {
        Serial.println("[ws] disconnected");
        logUpdate("ขาดการเชื่อมต่อ Server ส่วนกลาง กำลังเชื่อมต่อใหม่");
      }
      mgmtConnected = false;
      // exponential backoff + jitter
      wsBackoffMs = min<uint32_t>(wsBackoffMs * 2, 60000);
      ws.setReconnectInterval(wsBackoffMs + random(0, 1000));
      break;
    case WStype_TEXT:
      onWsText(payload, length);
      break;
    default:
      break;
  }
}

void startWs() {
#if defined(OTA_TEST_GATEWAY_UNAVAILABLE) && OTA_TEST_GATEWAY_UNAVAILABLE
  ws.onEvent(onWsEvent);
  ws.setReconnectInterval(wsBackoffMs);
  ws.begin("192.0.2.1", 9, "/", "");
  lastServerError = "OTA_TEST_GATEWAY_UNAVAILABLE";
  wsStarted = true;
  Serial.println("[ota-test] connecting to reserved TEST-NET address; Gateway intentionally unavailable");
#else
  ParsedUrl u;
  if (!parseUrl(mgmt.gatewayUrl, u)) {
    lastServerError = "GATEWAY_URL_INVALID";
    return;
  }
  static String authHeader;
  authHeader = "Authorization: Bearer " + mgmt.token + "\r\nX-Device-Id: " + mgmt.deviceId;
  ws.setExtraHeaders(authHeader.c_str());
  ws.onEvent(onWsEvent);
  ws.setReconnectInterval(wsBackoffMs);
  ws.enableHeartbeat(15000, 5000, 2);
  if (u.secure) {
    ws.beginSslWithBundle(u.host.c_str(), u.port, u.path.c_str(), x509_crt_bundle_start,
                          x509_crt_bundle_end - x509_crt_bundle_start, "");
  } else {
    ws.begin(u.host.c_str(), u.port, u.path.c_str(), "");
  }
  wsStarted = true;
  Serial.printf("[ws] connecting %s://%s:%u%s as %s\n", u.secure ? "wss" : "ws", u.host.c_str(), u.port, u.path.c_str(),
                mgmt.deviceId.c_str());
#endif
}

void checkOtaTrialAtBoot() {
  otaTrialStartedMs = millis();
  esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
  const esp_partition_t *running = esp_ota_get_running_partition();
  const bool pendingVerify = running &&
      esp_ota_get_state_partition(running, &state) == ESP_OK &&
      state == ESP_OTA_IMG_PENDING_VERIFY;

  prefs.begin("ota", true);
  String cmd = prefs.getString("cmd", "");
  String target = prefs.getString("target", "");
  String from = prefs.getString("from", "");
  prefs.end();
  const bool hasOtaRecord = !cmd.isEmpty() && !target.isEmpty();

  OtaTrialPhase savedPhase = OtaTrialPhase::NONE;
  uint8_t savedBoots = 0;
  String previousLabel, savedTarget;
  const bool hasSavedTrial = loadOtaTrialRecord(savedPhase, savedBoots, previousLabel, savedTarget);
  const OtaBootAction bootAction = decideOtaBoot(
      pendingVerify, hasSavedTrial ? savedPhase : OtaTrialPhase::NONE,
      hasOtaRecord, hasOtaRecord && target == FIRMWARE_VERSION &&
          (pendingVerify || savedTarget == target));

  if (bootAction == OtaBootAction::START_PENDING_CONFIRM) {
    otaTrial = true;
    otaMarkedValid = false;
    otaTrialPhase = OtaTrialPhase::WAIT_CONFIRM;
    otaTrialBoots = 1;
    otaTrialTimedOut = false;
    const esp_partition_t *previous = esp_ota_get_next_update_partition(nullptr);
    otaPreviousPartitionLabel = previous ? String(previous->label) : "";
    otaRollbackImageVerified = findBootablePreviousPartition(otaPreviousPartitionLabel) != nullptr;
    // PENDING_VERIFY is necessarily the first boot of this image. Replace any legacy NVS state.
    otaTrialStateReady = otaRollbackImageVerified && saveOtaTrialRecord(
        OtaTrialPhase::WAIT_CONFIRM, otaTrialBoots, otaPreviousPartitionLabel, target);
    if (!otaRollbackImageVerified) {
      Serial.printf("[ota] rollback target %s image verify failed; bootloader confirmation withheld\n",
                    previous ? previous->label : "(missing)");
    }
    if (!otaTrialStateReady) {
      Serial.println("[ota] image/NVS not ready; remain WAIT_CONFIRM until timeout rollback");
    }
    Serial.println("[ota] pending OTA trial starts fresh; confirm after Wi-Fi before first TCP");
  } else if (bootAction == OtaBootAction::PENDING_WITHOUT_OTA_RECORD) {
    clearOtaTrialRecord();
    otaTrial = true;
    otaMarkedValid = false;
    otaTrialPhase = OtaTrialPhase::NONE;
    otaTrialBoots = 1;
    otaTrialTimedOut = false;
    otaTrialStateReady = true;
    Serial.println("[ota] pending image without matching OTA record; await WELCOME until timeout");
  } else if (bootAction == OtaBootAction::RESUME_APP_TRIAL) {
    otaTrial = true;
    otaMarkedValid = true;
    otaTrialPhase = OtaTrialPhase::WAIT_WELCOME;
    otaTrialBoots = savedBoots < 255 ? savedBoots + 1 : savedBoots;
    otaPreviousPartitionLabel = previousLabel;
    otaTrialTimedOut = false;
    otaRollbackImageVerified = findBootablePreviousPartition(otaPreviousPartitionLabel) != nullptr;
    otaTrialStateReady = saveOtaTrialRecord(
        otaTrialPhase, otaTrialBoots, otaPreviousPartitionLabel, savedTarget);
    if (!otaTrialStateReady) {
      Serial.println("[ota] app trial boot count write failed; attempting safe rollback");
      rollbackToPreviousPartition("failed to persist app trial state");
    }
    const OtaTrialAction action = decideOtaTrial(
        otaTrialPhase, OtaTrialEvent::BOOT, otaTrialBoots, otaRollbackImageVerified);
    Serial.printf("[ota] app trial reboot %u/%u reset_reason=%s\n",
                  otaTrialBoots, OTA_TRIAL_MAX_BOOT_COUNT,
                  resetReasonName(esp_reset_reason()));
    if (action == OtaTrialAction::APP_ROLLBACK) {
      rollbackToPreviousPartition("app trial reboot count exceeded");
    } else if (action == OtaTrialAction::CONTINUE_AND_LOG) {
      Serial.printf("[ota] exceeded %u trial boots but rollback image is not bootable; continuing\n",
                    OTA_TRIAL_MAX_BOOT_COUNT);
    }
  } else {
    // A non-pending image must never be invalidated. Keep OTA command metadata for rollback reporting.
    clearOtaTrialRecord();
    otaTrial = false;
    otaMarkedValid = false;
    otaTrialPhase = OtaTrialPhase::NONE;
    otaTrialBoots = 0;
    otaTrialTimedOut = false;
    otaTrialStateReady = true;
    otaRollbackImageVerified = false;
  }

  if (hasOtaRecord) {
    logUpdate("rebooted: v" + from + " -> running v" FIRMWARE_VERSION);
    upd.active = true;
    upd.commandId = cmd;
    upd.action = "UPDATE_FIRMWARE";
    upd.target = target;
    upd.status = "REBOOTING";
    upd.progress = -1;
    upd.changedMs = millis();
  }
}
void mgmtLoop() {
  const bool online = WiFi.status() == WL_CONNECTED;

  if (otaTrial && otaTrialPhase == OtaTrialPhase::WAIT_WELCOME &&
      millis() - otaTrialStartedMs >= OTA_TRIAL_TIMEOUT_MS) {
    handleOtaTrialTimeout();
  }
  if (!mgmtConfigured()) return;

#if defined(OTA_TEST_CRASH_AFTER_REPORT) && OTA_TEST_CRASH_AFTER_REPORT
  // This test build must prove the report-200-before-HELLO crash window.
  if (online && reportPending && (lastReportTryMs == 0 || millis() - lastReportTryMs > 30000)) {
    lastReportTryMs = millis();
    reportPending = !sendReport();
  }
  if (reportPending) return;
#endif

  if (online && !wsStarted) startWs();
  if (wsStarted) ws.loop();

  if (mgmtConnected && millis() - lastHeartbeatMs > heartbeatIntervalMs) {
    lastHeartbeatMs = millis();
    sendHeartbeat();
  }

  if (online && reportPending &&
      (lastReportTryMs == 0 || millis() - lastReportTryMs > 30000)) {
    lastReportTryMs = millis();
    reportPending = !sendReport();
  }

  if (!currentCmd.active && queuedCmd.active && mgmtConnected) {
    currentCmd = queuedCmd;
    queuedCmd.active = false;
    if (currentCmd.action == "UPDATE_CONFIG") doConfigUpdate(currentCmd);
    else doFirmwareUpdate(currentCmd);
    currentCmd.active = false;
  }
}
