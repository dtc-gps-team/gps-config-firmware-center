#pragma once

// ============================
// ค่าตั้งการเชื่อมต่อส่วนกลาง (bootstrap) — เก็บใน NVS "mgmt"
// ============================
struct MgmtSettings {
  String deviceId;
  String token;
  String gatewayUrl;
  String deliveryUrl;
};

// ============================
// Device Config ที่ apply แล้ว — ฟิลด์ตาม Parameter Schema ของ firmware รุ่นนี้
// ============================
struct DeviceConfig {
  uint32_t version = 0;  // config_version
  bool ledEnabled = true;
  bool gpsEnabled = true;
  uint32_t gpsBaud = 9600;
  uint32_t sendIntervalSec = 10;
  String dsProtocol = "https";
  String dsHost = "";
  uint16_t dsPort = 443;
  String dsPath = "/api/gps";
#if FEATURE_SPEED_LIMIT
  bool speedLimitEnabled = false;
  float speedLimitKmh = 80;
#endif
#if FEATURE_GEOFENCE
  bool geofenceEnabled = false;
  double geofenceLat = 13.7563;
  double geofenceLng = 100.5018;
  uint32_t geofenceRadiusM = 500;
#endif
};

// คำสั่งจาก Gateway
struct Command {
  bool active = false;
  String id;
  String action;  // UPDATE_CONFIG | UPDATE_FIRMWARE
  String target;  // target_config_version หรือ target_firmware_version
};

HardwareSerial gpsSerial(2);
TinyGPSPlus gps;
WebServer server(80);
DNSServer dns;
Preferences prefs;
WebSocketsClient ws;

MgmtSettings mgmt;
DeviceConfig cfg;
String bootId;

// ---------- WiFi / หน้าตั้งค่า ----------
const char *AP_SSID = "ESP32-GPS-Setup";
const char *AP_PASS = "12345678";
const char *HOSTNAME = "esp32-gps";
const uint32_t WIFI_TIMEOUT_MS = 20000;
const uint32_t AP_KEEP_MS = 15000;
const uint32_t SETUP_RETRY_MS = 300000;
const uint32_t RESET_HOLD_MS = 3000;

String savedSsid, savedPass;
bool setupMode = false;
bool webStarted = false;
uint32_t setupSince = 0;

enum ConnState { CS_IDLE, CS_CONNECTING, CS_OK, CS_FAIL };
ConnState connState = CS_IDLE;
String pendingSsid, pendingPass;
uint32_t connStart = 0;
uint32_t apOffAt = 0;

// ---------- GPS ----------
unsigned long gpsBytes = 0;
unsigned long nmeaStarts = 0;
unsigned long lastGPSByte = 0;
String lastNMEA = "";
String nmeaBuffer = "";

// ---------- Management ----------
bool wsStarted = false;
bool mgmtConnected = false;  // ได้ WELCOME แล้ว
uint32_t heartbeatIntervalMs = 30000;
uint32_t lastHeartbeatMs = 0;
uint32_t wsBackoffMs = 2000;
bool reportPending = true;
uint32_t lastReportTryMs = 0;
bool otaTrial = false;  // firmware นี้เพิ่งติดตั้งผ่าน OTA และยังไม่ผ่าน health check
bool otaMarkedValid = false;

Command currentCmd;
Command queuedCmd;
String lastCommandText = "-";
String lastServerError = "";

// ---------- Data Server / Alerts ----------
uint32_t lastDataSendMs = 0;
int lastDataHttpCode = 0;
String lastEventText = "-";
bool alertOverspeed = false;
bool alertGeofence = false;

// ---------- โหมดจำลองการขับ (หน้าเว็บ เมนู "จำลองการขับ") ----------
bool simActive = false;
float simSpeedKmh = 0;
uint32_t simLastMs = 0;
const uint32_t SIM_TIMEOUT_MS = 5000;  // หน้าเว็บไม่ส่งค่ามา 5 วินาที = ปิดโหมดจำลอง
