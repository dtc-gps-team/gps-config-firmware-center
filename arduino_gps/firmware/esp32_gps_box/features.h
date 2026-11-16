#pragma once

// ============================
// GPS: อ่าน NMEA จาก GPIO13
// ============================
void gpsLoop() {
  if (!cfg.gpsEnabled) return;
  while (gpsSerial.available() > 0) {
    char c = (char)gpsSerial.read();
    gpsBytes++;
    lastGPSByte = millis();
    gps.encode(c);
    if (c == '$') nmeaStarts++;
    if (c == '\n') {
      lastNMEA = nmeaBuffer;
      nmeaBuffer = "";
    } else if (c != '\r') {
      if (nmeaBuffer.length() < 180) nmeaBuffer += c;
      else nmeaBuffer = "";
    }
  }
}

bool gpsFix() {
  return cfg.gpsEnabled && gps.location.isValid() && gps.location.age() < 5000;
}

float gpsSpeedKmh() {
  return gps.speed.isValid() && gps.speed.age() < 5000 ? gps.speed.kmph() : 0;
}

// ตำแหน่ง / ความเร็วที่ใช้ตรวจแจ้งเตือนและส่งข้อมูล: โหมดจำลองใช้ความเร็วจากหน้าเว็บ
// และใช้พิกัดจริงถ้ามี ไม่มีก็ใช้พิกัดเริ่มต้น
bool locationValid() {
  return gpsFix() || simActive;
}

float currentSpeedKmh() {
  return simActive ? simSpeedKmh : gpsSpeedKmh();
}

double currentLat() {
  return gpsFix() ? gps.location.lat() : atof(DEFAULT_LATITUDE);
}

double currentLng() {
  return gpsFix() ? gps.location.lng() : atof(DEFAULT_LONGITUDE);
}

// เวลา UTC จาก GPS -> ISO 8601 (ว่าง ถ้ายังไม่มีเวลา)
String gpsTimestamp() {
  if (!gps.date.isValid() || !gps.time.isValid() || gps.date.year() < 2020) return "";
  char buf[24];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ", gps.date.year(), gps.date.month(), gps.date.day(),
           gps.time.hour(), gps.time.minute(), gps.time.second());
  return buf;
}

// ============================
// Data Server: ส่งตรงจากกล่อง ไม่ผ่าน Management Server
// ============================
String dataServerUrl() {
  return cfg.dsProtocol + "://" + cfg.dsHost + ":" + String(cfg.dsPort) + cfg.dsPath;
}

bool dataServerReady() {
  return cfg.dsHost.length() && WiFi.status() == WL_CONNECTED;
}

int postToDataServer(JsonDocument &doc) {
  String body;
  serializeJson(doc, body);
  HttpResult r = httpJson("POST", dataServerUrl(), body, false);
  return r.code;
}

void sendEvent(const char *eventType, JsonDocument &doc) {
  doc["device_id"] = mgmt.deviceId;
  doc["event_type"] = eventType;
  doc["timestamp"] = gpsTimestamp();
  if (simActive) doc["simulated"] = true;
  int code = dataServerReady() ? postToDataServer(doc) : 0;
  lastEventText = String(eventType) + " (HTTP " + code + ")";
  Serial.println("[event] " + lastEventText);
}

void dataLoop() {
  if (!cfg.gpsEnabled || !dataServerReady()) return;
  if (millis() - lastDataSendMs < cfg.sendIntervalSec * 1000UL) return;
  lastDataSendMs = millis();

  // ส่งทุกรอบ: ยังไม่มีสัญญาณ GPS ใช้พิกัดเริ่มต้น (location_source = "default")
  JsonDocument d;
  d["device_id"] = mgmt.deviceId;
  d["latitude"] = serialized(String(currentLat(), 6));
  d["longitude"] = serialized(String(currentLng(), 6));
  if (locationValid()) d["speed_kmh"] = serialized(String(currentSpeedKmh(), 1));
  else d["speed_kmh"] = nullptr;
  d["location_source"] = gpsFix() ? "gps" : "default";
  d["fix"] = gpsFix();
  d["satellites"] = gps.satellites.isValid() ? gps.satellites.value() : 0;
  d["firmware_version"] = FIRMWARE_VERSION;
  if (simActive) d["simulated"] = true;  // ข้อมูลจากโหมดจำลอง
  d["timestamp"] = gpsTimestamp();
  lastDataHttpCode = postToDataServer(d);
  Serial.printf("[data] POST %s -> %d\n", dataServerUrl().c_str(), lastDataHttpCode);
}

// ============================
// v1.1.0: ตรวจจับความเร็วเกิน (แจ้งเตือนเท่านั้น ไม่ได้ควบคุมรถ)
// ต้องเกินต่อเนื่อง 3 วินาทีจึงแจ้ง และต้องต่ำกว่า (limit - 5) ต่อเนื่อง 5 วินาทีจึงรีเซ็ต
// ============================
#if FEATURE_SPEED_LIMIT
void speedLimitLoop() {
  static uint32_t overSince = 0, underSince = 0;
  if (!cfg.speedLimitEnabled || !locationValid()) {
    overSince = underSince = 0;
    alertOverspeed = false;
    return;
  }
  float speed = currentSpeedKmh();
  uint32_t now = millis();

  if (!alertOverspeed) {
    if (speed > cfg.speedLimitKmh) {
      if (!overSince) overSince = now;
      if (now - overSince >= 3000) {
        alertOverspeed = true;
        underSince = 0;
        JsonDocument e;
        e["speed_kmh"] = serialized(String(speed, 1));
        e["speed_limit_kmh"] = serialized(String(cfg.speedLimitKmh, 1));
        e["latitude"] = serialized(String(currentLat(), 6));
        e["longitude"] = serialized(String(currentLng(), 6));
        sendEvent("OVERSPEED", e);
      }
    } else {
      overSince = 0;
    }
  } else if (speed < cfg.speedLimitKmh - 5) {
    if (!underSince) underSince = now;
    if (now - underSince >= 5000) {
      alertOverspeed = false;
      overSince = 0;
    }
  } else {
    underSince = 0;
  }
}
#endif

// ============================
// v1.2.0: แจ้งเตือนเข้า/ออกพื้นที่ (geofence) ใช้ระยะเผื่อ 20 ม. และยืนยัน 5 วินาที
// ============================
#if FEATURE_GEOFENCE
double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
  const double R = 6371000.0;
  double dLat = radians(lat2 - lat1), dLng = radians(lng2 - lng1);
  double a = sin(dLat / 2) * sin(dLat / 2) + cos(radians(lat1)) * cos(radians(lat2)) * sin(dLng / 2) * sin(dLng / 2);
  return 2 * R * atan2(sqrt(a), sqrt(1 - a));
}

double geofenceDistance = -1;

void geofenceLoop() {
  static int8_t state = -1;  // -1 ยังไม่รู้, 0 ในพื้นที่, 1 นอกพื้นที่
  static uint32_t candidateSince = 0;
  if (!cfg.geofenceEnabled || !locationValid()) {
    state = -1;
    candidateSince = 0;
    alertGeofence = false;
    geofenceDistance = -1;
    return;
  }
  geofenceDistance = distanceMeters(cfg.geofenceLat, cfg.geofenceLng, currentLat(), currentLng());
  int8_t seen = geofenceDistance > cfg.geofenceRadiusM + 20 ? 1 : geofenceDistance < cfg.geofenceRadiusM - 20 ? 0 : state;
  if (seen == state || seen < 0) {
    candidateSince = 0;
    return;
  }
  if (!candidateSince) candidateSince = millis();
  if (millis() - candidateSince < 5000) return;

  bool first = state < 0;
  state = seen;
  candidateSince = 0;
  alertGeofence = state == 1;
  if (first && state == 0) return;  // เริ่มต้นอยู่ในพื้นที่: ไม่ต้องแจ้ง

  JsonDocument e;
  e["distance_m"] = (int)geofenceDistance;
  e["radius_m"] = cfg.geofenceRadiusM;
  e["latitude"] = serialized(String(currentLat(), 6));
  e["longitude"] = serialized(String(currentLng(), 6));
  sendEvent(state == 1 ? "GEOFENCE_EXIT" : "GEOFENCE_ENTER", e);
}
#endif

// ============================
// LED สถานะ
//   กระพริบเร็ว = มีการแจ้งเตือน, ติดค้าง = ต่อ Gateway แล้ว,
//   กระพริบช้า = มี WiFi แต่ยังไม่ต่อ Gateway, กระพริบสั้น ๆ = ยังไม่มี WiFi
// ============================
void ledLoop() {
  bool on;
  uint32_t t = millis();
  if (!cfg.ledEnabled) on = false;
  else if (alertOverspeed || alertGeofence) on = (t / 100) % 2;
  else if (mgmtConnected) on = true;
  else if (WiFi.status() == WL_CONNECTED) on = (t / 500) % 2;
  else on = (t % 1500) < 100;
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}

void featuresLoop() {
  if (simActive && millis() - simLastMs > SIM_TIMEOUT_MS) {
    simActive = false;
    simSpeedKmh = 0;
    Serial.println("[sim] ปิดโหมดจำลอง (หน้าเว็บไม่ส่งค่ามา)");
  }
  gpsLoop();
  dataLoop();
#if FEATURE_SPEED_LIMIT
  speedLimitLoop();
#endif
#if FEATURE_GEOFENCE
  geofenceLoop();
#endif
  ledLoop();
}
