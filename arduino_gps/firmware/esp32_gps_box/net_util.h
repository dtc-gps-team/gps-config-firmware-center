#pragma once

#include <esp_system.h>

// CA bundle ที่ฝังมากับ ESP32 core (ใช้ตรวจ certificate ของ wss:// / https:// จริง ไม่ใช้ setInsecure)
extern const uint8_t x509_crt_bundle_start[] asm("_binary_x509_crt_bundle_start");
extern const uint8_t x509_crt_bundle_end[] asm("_binary_x509_crt_bundle_end");

struct ParsedUrl {
  bool secure = false;
  String host;
  uint16_t port = 80;
  String path = "/";
};

bool parseUrl(const String &url, ParsedUrl &out) {
  int p = url.indexOf("://");
  if (p <= 0) return false;
  String scheme = url.substring(0, p);
  scheme.toLowerCase();
  if (scheme != "ws" && scheme != "wss" && scheme != "http" && scheme != "https") return false;
  out.secure = scheme == "wss" || scheme == "https";
  String rest = url.substring(p + 3);
  int slash = rest.indexOf('/');
  String hostPort = slash < 0 ? rest : rest.substring(0, slash);
  out.path = slash < 0 ? "/" : rest.substring(slash);
  int colon = hostPort.lastIndexOf(':');
  if (colon > 0) {
    out.host = hostPort.substring(0, colon);
    out.port = hostPort.substring(colon + 1).toInt();
  } else {
    out.host = hostPort;
    out.port = out.secure ? 443 : 80;
  }
  return out.host.length() > 0 && out.port > 0;
}

// client สำหรับ http/https ตาม URL (https ตรวจ certificate ด้วย CA bundle)
class HttpConn {
private:
  // HTTPClient retains a pointer to the selected NetworkClient and calls stop()
  // in its destructor. Declare the transports first so `http` is destroyed
  // before them (C++ destroys members in reverse declaration order).
  NetworkClient plain;
  NetworkClientSecure secure;

public:
  HTTPClient http;

  bool begin(const String &url) {
    if (url.startsWith("https://")) {
      secure.useBuiltinCACertBundle();
      return http.begin(secure, url);
    }
    return http.begin(plain, url);
  }

};

struct HttpResult {
  int code;
  String body;
};

const char *resetReasonName(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_UNKNOWN: return "UNKNOWN";
    case ESP_RST_POWERON: return "POWERON";
    case ESP_RST_EXT: return "EXT";
    case ESP_RST_SW: return "SW";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_INT_WDT: return "INT_WDT";
    case ESP_RST_TASK_WDT: return "TASK_WDT";
    case ESP_RST_WDT: return "WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_SDIO: return "SDIO";
    case ESP_RST_USB: return "USB";
    case ESP_RST_JTAG: return "JTAG";
    case ESP_RST_EFUSE: return "EFUSE";
    case ESP_RST_PWR_GLITCH: return "PWR_GLITCH";
    case ESP_RST_CPU_LOCKUP: return "CPU_LOCKUP";
    default: return "UNKNOWN";
  }
}

HttpResult httpJson(const char *method, const String &url, const String &body, bool withDeviceAuth) {
  HttpConn c;
  if (!c.begin(url)) return { -1, "" };
  c.http.setTimeout(10000);
  c.http.setConnectTimeout(5000);
  if (withDeviceAuth) {
    c.http.addHeader("Authorization", "Bearer " + mgmt.token);
    c.http.addHeader("X-Device-Id", mgmt.deviceId);
  }
  if (body.length()) c.http.addHeader("Content-Type", "application/json");
  int code = c.http.sendRequest(method, body);
  String resp = code > 0 ? c.http.getString() : "";
  c.http.end();
  return { code, resp };
}

void healthJsonFields(JsonObject h) {
  h["rssi"] = WiFi.RSSI();
  h["free_heap"] = ESP.getFreeHeap();
  h["uptime_sec"] = millis() / 1000;
  h["reset_reason"] = resetReasonName(esp_reset_reason());
  h["gps_fix"] = gps.location.isValid() && gps.location.age() < 5000;
  h["satellites"] = gps.satellites.isValid() ? gps.satellites.value() : 0;
}

// รายงานเวอร์ชันที่รันจริง + config ที่ apply แล้วไปที่ Delivery Server
bool sendReport() {
  JsonDocument d;
  d["firmware_version"] = FIRMWARE_VERSION;
  d["schema_version"] = SCHEMA_VERSION;
  d["config_version"] = cfg.version;
  if (cfg.version > 0) configToJson(cfg, d["reported_config"].to<JsonObject>());
  healthJsonFields(d["health"].to<JsonObject>());
  String body;
  serializeJson(d, body);
  HttpResult r = httpJson("POST", mgmt.deliveryUrl + "/api/device/me/report", body, true);
  Serial.printf("[report] HTTP %d%s\n", r.code, r.code == 401 ? " (Device ID / รหัสไม่ถูก หรือกล่องถูกระงับ)" : "");
#if defined(OTA_TEST_CRASH_AFTER_REPORT) && OTA_TEST_CRASH_AFTER_REPORT
  if (r.code == 200 && otaTrial && prefs.begin("ota_trial", false)) {
    const bool alreadyCrashed = prefs.getBool("test_report_crash", false);
    const bool saved = alreadyCrashed || prefs.putBool("test_report_crash", true);
    prefs.end();
    if (!alreadyCrashed && saved) {
      Serial.println("[ota-test] intentional crash after report HTTP 200 and before HELLO");
      delay(100);
      abort();
    }
  }
#endif
  return r.code == 200;
}
