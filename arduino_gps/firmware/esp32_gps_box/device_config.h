#pragma once

// ============================
// Parameter ที่ firmware รุ่นนี้รองรับ (ต้องตรงกับ schema ของ delivery-server)
// ============================
struct ParamDef {
  const char *group;
  const char *key;
};

static const ParamDef SUPPORTED_PARAMS[] = {
  { "led", "enabled" },
  { "gps", "enabled" },
  { "gps", "baud_rate" },
  { "gps", "send_interval_sec" },
  { "data_server", "protocol" },
  { "data_server", "host" },
  { "data_server", "port" },
  { "data_server", "path" },
#if FEATURE_SPEED_LIMIT
  { "speed_limit", "enabled" },
  { "speed_limit", "max_kmh" },
#endif
#if FEATURE_GEOFENCE
  { "geofence", "enabled" },
  { "geofence", "center_lat" },
  { "geofence", "center_lng" },
  { "geofence", "radius_m" },
#endif
};

bool isSupportedParam(const char *group, const char *key) {
  for (const ParamDef &p : SUPPORTED_PARAMS) {
    if (!strcmp(p.group, group) && !strcmp(p.key, key)) return true;
  }
  return false;
}

bool validHostname(const String &h) {
  if (h.length() == 0 || h.length() > 253) return false;
  for (char c : h) {
    if (!isalnum((unsigned char)c) && c != '-' && c != '.') return false;
  }
  return true;
}

// ตรวจ settings จาก server อีกชั้น (type / range / parameter ที่ไม่รองรับ) ก่อน apply
bool parseSettings(JsonObjectConst s, DeviceConfig &out, String &err) {
  if (s.isNull()) {
    err = "SETTINGS_MISSING";
    return false;
  }
  for (JsonPairConst g : s) {
    if (!g.value().is<JsonObjectConst>()) {
      err = String("INVALID_GROUP:") + g.key().c_str();
      return false;
    }
    for (JsonPairConst kv : g.value().as<JsonObjectConst>()) {
      if (!isSupportedParam(g.key().c_str(), kv.key().c_str())) {
        err = String("UNSUPPORTED_PARAMETER:") + g.key().c_str() + "." + kv.key().c_str();
        return false;
      }
    }
  }

  DeviceConfig c;  // เริ่มจาก default ของ firmware

#define INVALID(name) \
  { \
    err = String("INVALID_VALUE:") + name; \
    return false; \
  }
#define READ_BOOL(group, key, field) \
  { \
    JsonVariantConst v = s[group][key]; \
    if (!v.isNull()) { \
      if (!v.is<bool>()) INVALID(group "." key); \
      field = v.as<bool>(); \
    } \
  }
#define READ_NUM(group, key, field, type, lo, hi) \
  { \
    JsonVariantConst v = s[group][key]; \
    if (!v.isNull()) { \
      if (!v.is<double>()) INVALID(group "." key); \
      double d = v.as<double>(); \
      if (d < (lo) || d > (hi)) INVALID(group "." key); \
      field = (type)d; \
    } \
  }
#define READ_STR(group, key, field) \
  { \
    JsonVariantConst v = s[group][key]; \
    if (!v.isNull()) { \
      if (!v.is<const char *>()) INVALID(group "." key); \
      field = v.as<const char *>(); \
    } \
  }

  READ_BOOL("led", "enabled", c.ledEnabled);
  READ_BOOL("gps", "enabled", c.gpsEnabled);
  READ_NUM("gps", "baud_rate", c.gpsBaud, uint32_t, 4800, 38400);
  READ_NUM("gps", "send_interval_sec", c.sendIntervalSec, uint32_t, 5, 3600);
  READ_STR("data_server", "protocol", c.dsProtocol);
  READ_STR("data_server", "host", c.dsHost);
  READ_NUM("data_server", "port", c.dsPort, uint16_t, 1, 65535);
  READ_STR("data_server", "path", c.dsPath);
#if FEATURE_SPEED_LIMIT
  READ_BOOL("speed_limit", "enabled", c.speedLimitEnabled);
  READ_NUM("speed_limit", "max_kmh", c.speedLimitKmh, float, 1, 200);
#endif
#if FEATURE_GEOFENCE
  READ_BOOL("geofence", "enabled", c.geofenceEnabled);
  READ_NUM("geofence", "center_lat", c.geofenceLat, double, -90, 90);
  READ_NUM("geofence", "center_lng", c.geofenceLng, double, -180, 180);
  READ_NUM("geofence", "radius_m", c.geofenceRadiusM, uint32_t, 50, 100000);
#endif

#undef READ_STR
#undef READ_NUM
#undef READ_BOOL

  if (c.gpsBaud != 4800 && c.gpsBaud != 9600 && c.gpsBaud != 38400) INVALID("gps.baud_rate");
  if (c.dsProtocol != "https" && c.dsProtocol != "http") INVALID("data_server.protocol");
  if (c.dsHost.length() && !validHostname(c.dsHost)) INVALID("data_server.host");  // ว่าง = ไม่ส่งพิกัด
  if (!c.dsPath.startsWith("/")) INVALID("data_server.path");
#undef INVALID

  c.version = out.version;
  out = c;
  return true;
}

void configToJson(const DeviceConfig &c, JsonObject o) {
  o["led"]["enabled"] = c.ledEnabled;
  o["gps"]["enabled"] = c.gpsEnabled;
  o["gps"]["baud_rate"] = c.gpsBaud;
  o["gps"]["send_interval_sec"] = c.sendIntervalSec;
  o["data_server"]["protocol"] = c.dsProtocol;
  o["data_server"]["host"] = c.dsHost;
  o["data_server"]["port"] = c.dsPort;
  o["data_server"]["path"] = c.dsPath;
#if FEATURE_SPEED_LIMIT
  o["speed_limit"]["enabled"] = c.speedLimitEnabled;
  o["speed_limit"]["max_kmh"] = c.speedLimitKmh;
#endif
#if FEATURE_GEOFENCE
  o["geofence"]["enabled"] = c.geofenceEnabled;
  o["geofence"]["center_lat"] = c.geofenceLat;
  o["geofence"]["center_lng"] = c.geofenceLng;
  o["geofence"]["radius_m"] = c.geofenceRadiusM;
#endif
}

String configToString(const DeviceConfig &c) {
  JsonDocument doc;
  configToJson(c, doc.to<JsonObject>());
  String s;
  serializeJson(doc, s);
  return s;
}

// ============================
// NVS: เก็บ config ปัจจุบัน + ค่าก่อนหน้า (known-good)
// ============================
bool loadConfigFrom(const char *jsonKey, const char *verKey, DeviceConfig &out) {
  String json = prefs.getString(jsonKey, "");
  if (json.isEmpty()) return false;
  JsonDocument doc;
  if (deserializeJson(doc, json)) return false;
  DeviceConfig c;
  c.version = prefs.getUInt(verKey, 0);
  String err;
  // config ที่บันทึกจาก firmware รุ่นใหม่กว่าอาจมี parameter ที่รุ่นนี้ไม่รู้จัก (กรณี rollback) -> ข้าม
  JsonDocument filtered;
  for (JsonPairConst g : doc.as<JsonObjectConst>()) {
    if (!g.value().is<JsonObjectConst>()) continue;
    for (JsonPairConst kv : g.value().as<JsonObjectConst>()) {
      if (isSupportedParam(g.key().c_str(), kv.key().c_str())) filtered[g.key()][kv.key()] = kv.value();
    }
  }
  if (!parseSettings(filtered.as<JsonObjectConst>(), c, err)) {
    Serial.println("config ใน NVS ใช้ไม่ได้: " + err);
    return false;
  }
  out = c;
  return true;
}

void loadConfig() {
  prefs.begin("cfg", true);
  bool ok = loadConfigFrom("json", "ver", cfg) || loadConfigFrom("prev_json", "prev_ver", cfg);
  prefs.end();
  if (!ok) cfg = DeviceConfig();
  Serial.printf("config_version=%u data_server=%s\n", cfg.version, cfg.dsHost.c_str());
}

void saveConfig(const DeviceConfig &c) {
  prefs.begin("cfg", false);
  String cur = prefs.getString("json", "");
  if (cur.length()) {
    prefs.putString("prev_json", cur);
    prefs.putUInt("prev_ver", prefs.getUInt("ver", 0));
  }
  prefs.putString("json", configToString(c));
  prefs.putUInt("ver", c.version);
  prefs.end();
}

// ============================
// NVS: ค่าตั้งการเชื่อมต่อส่วนกลาง
// ============================
void loadMgmt() {
  prefs.begin("mgmt", true);
  mgmt.deviceId = prefs.getString("id", DEFAULT_DEVICE_ID);
  // ทุกกล่องใช้รหัสร่วมที่ฝังใน firmware เสมอ (ไม่ใช้ค่าที่ firmware รุ่นเก่าเคยบันทึกไว้)
  mgmt.token = DEFAULT_DEVICE_TOKEN;
  mgmt.gatewayUrl = prefs.getString("gw", DEFAULT_GATEWAY_URL);
  mgmt.deliveryUrl = prefs.getString("dl", DEFAULT_DELIVERY_URL);
  // ถ้าค่าที่บันทึกไว้คือค่าเริ่มต้นของ firmware รุ่นก่อน (ผู้ใช้ไม่ได้แก้เอง) ให้ใช้ค่าเริ่มต้นของรุ่นนี้แทน
  // (ค่าที่บันทึกก่อนมี def_gw / def_dl ถือว่าเป็นค่าเริ่มต้นเดิม)
  if (mgmt.gatewayUrl == prefs.getString("def_gw", mgmt.gatewayUrl)) mgmt.gatewayUrl = DEFAULT_GATEWAY_URL;
  if (mgmt.deliveryUrl == prefs.getString("def_dl", mgmt.deliveryUrl)) mgmt.deliveryUrl = DEFAULT_DELIVERY_URL;
  prefs.end();
}

void saveMgmt() {
  prefs.begin("mgmt", false);
  prefs.putString("id", mgmt.deviceId);
  prefs.remove("token");  // รหัสมาจาก firmware ไม่ต้องเก็บ
  prefs.putString("gw", mgmt.gatewayUrl);
  prefs.putString("dl", mgmt.deliveryUrl);
  // จำไว้ว่าตอนบันทึก ค่าเริ่มต้นคืออะไร เพื่อแยกว่าผู้ใช้แก้ URL เองหรือไม่
  prefs.putString("def_gw", DEFAULT_GATEWAY_URL);
  prefs.putString("def_dl", DEFAULT_DELIVERY_URL);
  prefs.end();
}

bool mgmtConfigured() {
  return mgmt.deviceId.length() && mgmt.token.length() && mgmt.gatewayUrl.length() && mgmt.deliveryUrl.length();
}
