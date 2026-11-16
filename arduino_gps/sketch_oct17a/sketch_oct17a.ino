// ESP32: ตั้งค่า WiFi ครั้งแรกโดยไม่ต้องใช้แอป (Captive Portal)
// 1) ESP32 ปล่อย WiFi ชื่อ "ESP32-GPS-Setup" -> มือถือเชื่อมต่อ -> หน้าตั้งค่าเด้งขึ้นมาเอง
// 2) เลือก WiFi บ้าน + ใส่รหัส -> หน้าเว็บแสดง IP เมื่อเชื่อมต่อสำเร็จ
// 3) ครั้งต่อไปเชื่อมต่อ WiFi บ้านอัตโนมัติ ถ้าเชื่อมไม่ได้จะกลับมาโหมดตั้งค่า

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <TinyGPSPlus.h>

const char *AP_SSID = "ESP32-GPS-Setup";
const char *AP_PASS = "12345678";    // รหัส WiFi ของบอร์ด (อย่างน้อย 8 ตัว) หรือ "" = ไม่มีรหัส
const char *HOSTNAME = "esp32-gps";  // เข้าเว็บได้ที่ http://esp32-gps.local
const uint32_t WIFI_TIMEOUT_MS = 20000;
const uint32_t AP_KEEP_MS = 15000;       // หลังเชื่อมสำเร็จ ปิด WiFi ตั้งค่าใน 15 วินาที -> มือถือกลับไปต่อ WiFi บ้านเอง
const uint32_t SETUP_RETRY_MS = 300000;  // ถ้ามี WiFi เดิมแต่เชื่อมไม่ได้ รีสตาร์ทลองใหม่ทุก 5 นาที
const int RESET_BTN_PIN = 0;             // ปุ่ม BOOT บนบอร์ด: กดค้าง 3 วินาที = ลบ WiFi เข้าโหมดตั้งค่า
const uint32_t RESET_HOLD_MS = 3000;

// ============================
// ตั้งค่า GPS
// ต่อสาย: GPS VCC -> VIN, GND -> GND, TX -> GPIO13 (GPS RX ไม่ต้องต่อ)
// ============================
#define GPS_RX_PIN 13
#define GPS_BAUD 9600

HardwareSerial gpsSerial(2);
TinyGPSPlus gps;
WebServer server(80);
DNSServer dns;
Preferences prefs;

String savedSsid, savedPass;
bool setupMode = false;
bool webStarted = false;
uint32_t setupSince = 0;

enum ConnState { CS_IDLE, CS_CONNECTING, CS_OK, CS_FAIL };
ConnState connState = CS_IDLE;
String pendingSsid, pendingPass;
uint32_t connStart = 0;
uint32_t apOffAt = 0;

unsigned long gpsBytes = 0;
unsigned long nmeaStarts = 0;
unsigned long lastGPSByte = 0;

String lastNMEA = "";
String nmeaBuffer = "";

// ---------- WiFi storage ----------
void loadWifi() {
  prefs.begin("wifi", true);
  savedSsid = prefs.getString("ssid", "");
  savedPass = prefs.getString("pass", "");
  prefs.end();
}

void saveWifi(const String &ssid, const String &pass) {
  prefs.begin("wifi", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.end();
  savedSsid = ssid;
  savedPass = pass;
}

void clearWifi() {
  prefs.begin("wifi", false);
  prefs.clear();
  prefs.end();
  savedSsid = "";
  savedPass = "";
}

bool connectWifi(const String &ssid, const String &pass) {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(HOSTNAME);
  WiFi.begin(ssid.c_str(), pass.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

String ipUrl() {
  return "http://" + WiFi.localIP().toString() + "/";
}

void printConnected() {
  Serial.println("=================================");
  Serial.println(" เชื่อมต่อ WiFi สำเร็จ!");
  Serial.println(" SSID : " + WiFi.SSID());
  Serial.println(" IP   : " + WiFi.localIP().toString());
  Serial.println(" เว็บ  : " + ipUrl());
  Serial.println("        http://" + String(HOSTNAME) + ".local/");
  Serial.println("=================================");
}

// ============================
// อ่าน GPS
// ============================
void gpsLoop() {
  static uint32_t lastLog = 0;

  while (gpsSerial.available() > 0) {
    char c = (char)gpsSerial.read();

    gpsBytes++;
    lastGPSByte = millis();

    gps.encode(c);

    if (c == '$') {
      nmeaStarts++;
    }

    if (c == '\n') {
      lastNMEA = nmeaBuffer;
      nmeaBuffer = "";
    } else if (c != '\r') {
      if (nmeaBuffer.length() < 180) {
        nmeaBuffer += c;
      } else {
        nmeaBuffer = "";
      }
    }
  }

  if (millis() - lastLog > 5000) {
    lastLog = millis();
    Serial.printf("GPS: bytes=%lu nmea=%lu sats=%d | %s\n", gpsBytes, nmeaStarts,
                  gps.satellites.isValid() ? (int)gps.satellites.value() : 0, lastNMEA.c_str());
  }
}

// ============================
// HTML
// ============================
String htmlEscape(String s) {
  s.replace("&", "&amp;");
  s.replace("<", "&lt;");
  s.replace(">", "&gt;");
  s.replace("\"", "&quot;");
  s.replace("'", "&#39;");
  return s;
}

String escapeJSON(String s) {
  s.replace("\\", "\\\\");
  s.replace("\"", "\\\"");
  s.replace("\n", "\\n");
  s.replace("\r", "\\r");
  s.replace("\t", "\\t");
  return s;
}

String htmlPage(String title, String body) {
  String html = R"HTML(
<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Cache-Control" content="no-store">
<title>ESP32 GPS</title>
<style>
* { box-sizing:border-box; }
body {
  margin:0;
  padding:20px;
  font-family:Arial,Tahoma,sans-serif;
  background:#0f172a;
  color:#f8fafc;
}
.container {
  max-width:650px;
  margin:auto;
}
.card {
  background:#1e293b;
  border:1px solid #334155;
  padding:20px;
  border-radius:14px;
  margin-bottom:14px;
}
h1 { font-size:23px;color:#38bdf8; }
h2 { font-size:17px; }
.small { color:#94a3b8;font-size:13px; }
.grid {
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px;
}
.value {
  font-size:25px;
  font-weight:bold;
  margin-top:9px;
}
.status {
  padding:13px;
  border-radius:8px;
  background:#334155;
  font-weight:bold;
}
.green { color:#4ade80; }
.red { color:#f87171; }
.ip { font-size:28px;font-weight:bold;color:#4ade80; }
.hide { display:none; }
input,select,button {
  width:100%;
  padding:13px;
  border-radius:8px;
  margin:8px 0;
  font-size:15px;
}
input,select {
  background:#fff;
  color:#111827;
  border:0;
}
button {
  background:#0284c7;
  color:white;
  font-weight:bold;
  border:0;
  cursor:pointer;
}
button.danger { background:#dc2626; }
td { padding:4px 8px; }
a { color:#38bdf8; }
pre {
  color:#4ade80;
  white-space:pre-wrap;
  overflow-wrap:anywhere;
  font-size:12px;
}
</style>
</head>
<body>
<div class="container">
)HTML";

  html += body;
  html += "</div></body></html>";
  return html;
}

// ============================
// หน้าตั้งค่า WiFi (โหมดตั้งค่า)
// ============================
void sendSetupPage() {
  int n = WiFi.scanNetworks();
  String options = "";
  for (int i = 0; i < n; i++) {
    String s = htmlEscape(WiFi.SSID(i));
    if (s.isEmpty()) continue;
    options += "<option value=\"" + s + "\">" + s + " (" + WiFi.RSSI(i) + " dBm)</option>";
  }
  WiFi.scanDelete();
  if (options.isEmpty()) options = "<option value=''>ไม่พบเครือข่าย WiFi</option>";

  String body =
    "<div class='card' id='formCard'>"
    "<h1>ตั้งค่า Wi-Fi สำหรับกล่อง GPS</h1>"
    "<p class='small'>เลือกเครือข่าย Wi-Fi บ้าน (2.4 GHz)</p>"
    "<form id='f'>"
    "<label>เลือก Wi-Fi</label>"
    "<select name='ssid'>" + options + "</select>"
    "<label>หรือกรอกชื่อ Wi-Fi เอง</label>"
    "<input name='manual' placeholder='ชื่อ Wi-Fi (ถ้าไม่มีในรายการ)'>"
    "<label>รหัสผ่าน Wi-Fi</label>"
    "<input type='password' name='pass' placeholder='กรอกรหัสผ่าน'>"
    "<button type='submit'>เชื่อมต่อ</button>"
    "</form>"
    "<a href='/'>สแกน Wi-Fi อีกครั้ง</a>"
    "</div>"
    "<div class='card hide' id='msgCard'><div id='msg'></div></div>";

  body += R"HTML(
<script>
const f=document.getElementById('f'),fc=document.getElementById('formCard'),
  mc=document.getElementById('msgCard'),m=document.getElementById('msg');
function show(h){m.innerHTML=h;mc.classList.remove('hide');}
f.onsubmit=e=>{
  e.preventDefault();
  fc.classList.add('hide');
  show('กำลังเชื่อมต่อ... กรุณารอสักครู่');
  fetch('/save',{method:'POST',body:new URLSearchParams(new FormData(f))})
    .then(()=>setTimeout(poll,1500))
    .catch(()=>setTimeout(poll,2000));
};
function poll(){
  fetch('/status').then(r=>r.json()).then(s=>{
    if(s.state=='connecting'){setTimeout(poll,1500);return;}
    if(s.state=='ok'){
      const u='http://'+s.ip+'/';
      show('<h1>เชื่อมต่อสำเร็จ!</h1>Wi-Fi: <b>'+s.ssid+'</b><br>IP ของอุปกรณ์:<div class=ip>'+s.ip+'</div>'
        +'<p>ลิงก์: <a href="'+u+'">'+u+'</a></p>'
        +'<p>มือถือจะกลับไปต่อ Wi-Fi <b>'+s.ssid+'</b> เอง แล้วหน้านี้จะเปลี่ยนไปที่ลิงก์ให้อัตโนมัติ...</p>'
        +'<button onclick="fetch(\'/done\')">ปิดโหมดตั้งค่าเลย</button>');
      go(u);
      return;
    }
    show('<b class=red>เชื่อมต่อไม่สำเร็จ</b> ตรวจสอบชื่อ/รหัสผ่านแล้วลองใหม่');
    fc.classList.remove('hide');
  }).catch(()=>setTimeout(poll,2000));
}
// รอจนมือถือเข้าถึง IP ใหม่ได้ (กลับไปอยู่ WiFi บ้านแล้ว) แล้วเปลี่ยนหน้า
function go(u){
  fetch(u+'ping',{mode:'no-cors',cache:'no-store'})
    .then(()=>{location.href=u;})
    .catch(()=>setTimeout(()=>go(u),2000));
}
</script>
)HTML";

  server.send(200, "text/html; charset=utf-8", htmlPage("ตั้งค่า WiFi", body));
}

// ============================
// หน้า GPS Monitor (ต่อ WiFi บ้านแล้ว)
// ============================
void sendMonitorPage() {
  String body = R"HTML(
<div class="card">
<h1>ติดตามสถานะ GPS แบบเรียลไทม์</h1>
<p class="small">GY-GPS6MV2 | GPIO13 | 9600 baud</p>
<div class="status" id="status">
กำลังตรวจสอบ GPS...
</div>
<p class="small" id="fix">
กำลังตรวจสอบดาวเทียม...
</p>
</div>

<div class="grid">
  <div class="card">
    <div class="small">ข้อมูลที่ได้รับ</div>
    <div class="value" id="bytes">0</div>
    <div class="small">ไบต์</div>
  </div>
  <div class="card">
    <div class="small">ข้อความ NMEA</div>
    <div class="value" id="nmea">0</div>
    <div class="small">ข้อความ</div>
  </div>
  <div class="card">
    <div class="small">จำนวนดาวเทียม</div>
    <div class="value" id="sats">0</div>
    <div class="small">ดวง</div>
  </div>
  <div class="card">
    <div class="small">ความเร็ว</div>
    <div class="value" id="speed">--</div>
    <div class="small">กม./ชม.</div>
  </div>
</div>

<div class="card">
<h2>ตำแหน่ง GPS ล่าสุด</h2>
<p>ละติจูด: <b id="lat">--</b></p>
<p>ลองจิจูด: <b id="lng">--</b></p>
<p id="maplink"></p>
</div>

<div class="card">
<h2>ข้อมูล NMEA ล่าสุด</h2>
<pre id="raw">กำลังรอข้อมูล GPS...</pre>
</div>

<script>
async function update() {
  try {
    const r = await fetch('/api/gps', {
      cache: 'no-store'
    });
    const d = await r.json();

    const status = document.getElementById('status');

    status.textContent = d.gps_active
      ? 'กำลังรับข้อมูลจาก GPS'
      : 'ยังไม่ได้รับข้อมูลจาก GPS';

    status.className = d.gps_active
      ? 'status green' : 'status red';

    document.getElementById('fix').textContent =
      d.fix ? 'จับตำแหน่งดาวเทียมสำเร็จ'
      : d.gps_active
      ? 'กำลังรอจับตำแหน่งดาวเทียม'
      : 'ยังไม่สามารถตรวจสอบตำแหน่งได้';

    document.getElementById('bytes').textContent =
      d.bytes;

    document.getElementById('nmea').textContent =
      d.nmea;

    document.getElementById('sats').textContent =
      d.gps_active ? d.satellites : '--';

    document.getElementById('speed').textContent =
      d.speed === null ? '--' : d.speed;

    document.getElementById('lat').textContent =
      d.latitude === null ? '--' : d.latitude;

    document.getElementById('lng').textContent =
      d.longitude === null ? '--' : d.longitude;

    document.getElementById('raw').textContent =
      d.raw || 'กำลังรอข้อมูล GPS...';

    const map = document.getElementById('maplink');

    if (d.fix) {
      const url = 'https://www.google.com/maps?q='
        + d.latitude + ',' + d.longitude;

      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'เปิดตำแหน่งบน Google Maps';

      map.replaceChildren(a);
    } else {
      map.textContent = 'ยังไม่มีพิกัดที่ใช้งานได้';
    }

  } catch (e) {
    document.getElementById('status').textContent =
      'ไม่สามารถเชื่อมต่อกับ ESP32 ได้';
  }
}

setInterval(update,1000);
update();
</script>
)HTML";

  body += "<div class='card'><h2>สถานะอุปกรณ์</h2><table>";
  body += "<tr><td>Wi-Fi</td><td><b>" + htmlEscape(WiFi.SSID()) + "</b></td></tr>";
  body += "<tr><td>IP</td><td><b>" + WiFi.localIP().toString() + "</b></td></tr>";
  body += "<tr><td>Hostname</td><td>" + String(HOSTNAME) + ".local</td></tr>";
  body += "<tr><td>สัญญาณ</td><td>" + String(WiFi.RSSI()) + " dBm</td></tr>";
  body += "<tr><td>MAC</td><td>" + WiFi.macAddress() + "</td></tr>";
  body += "<tr><td>Uptime</td><td>" + String(millis() / 1000) + " วินาที</td></tr>";
  body += "</table>"
          "<form method='POST' action='/reset' "
          "onsubmit=\"return confirm('ลบ WiFi แล้วเข้าโหมดตั้งค่าใหม่?')\">"
          "<button class='danger' type='submit'>เปลี่ยน WiFi (เข้าโหมดตั้งค่าใหม่)</button></form></div>";

  server.send(200, "text/html; charset=utf-8", htmlPage("ติดตาม GPS", body));
}

// ============================
// Handlers
// ============================
void handleRoot() {
  if (setupMode) sendSetupPage();
  else sendMonitorPage();
}

void handleSave() {
  if (!setupMode) {
    server.send(403, "text/plain", "not in setup mode");
    return;
  }
  pendingSsid = server.arg("manual");
  pendingSsid.trim();
  if (pendingSsid.isEmpty()) pendingSsid = server.arg("ssid");
  pendingPass = server.arg("pass");
  if (pendingSsid.isEmpty()) {
    server.send(400, "application/json", "{\"ok\":false}");
    return;
  }
  server.send(200, "application/json", "{\"ok\":true}");
  Serial.println("กำลังเชื่อมต่อ: " + pendingSsid);
  WiFi.disconnect();
  WiFi.begin(pendingSsid.c_str(), pendingPass.c_str());
  connState = CS_CONNECTING;
  connStart = millis();
}

// สถานะการเชื่อมต่อ WiFi (ใช้ในหน้าตั้งค่า)
void handleStatus() {
  const char *st = connState == CS_CONNECTING ? "connecting"
                 : connState == CS_OK         ? "ok"
                 : connState == CS_FAIL       ? "fail"
                                              : "idle";
  String ssid = htmlEscape(WiFi.SSID());
  ssid.replace("\\", "\\\\");
  String j = "{\"state\":\"" + String(st) + "\",\"ssid\":\"" + ssid + "\",\"ip\":\"" + WiFi.localIP().toString() + "\"}";
  server.send(200, "application/json", j);
}

// ข้อมูล GPS (ใช้ในหน้า Monitor)
void handleGps() {
  bool gpsActive =
    gpsBytes > 0 &&
    millis() - lastGPSByte < 5000;

  bool fix =
    gpsActive &&
    gps.location.isValid() &&
    gps.location.age() < 5000;

  String json = "{";

  json += "\"gps_active\":";
  json += gpsActive ? "true," : "false,";

  json += "\"fix\":";
  json += fix ? "true," : "false,";

  json += "\"bytes\":" + String(gpsBytes) + ",";
  json += "\"nmea\":" + String(nmeaStarts) + ",";

  json += "\"satellites\":";
  json += gps.satellites.isValid()
          ? String(gps.satellites.value()) : "0";
  json += ",";

  json += "\"latitude\":";
  json += fix ? String(gps.location.lat(), 6) : "null";
  json += ",";

  json += "\"longitude\":";
  json += fix ? String(gps.location.lng(), 6) : "null";
  json += ",";

  json += "\"speed\":";
  json += (fix && gps.speed.isValid() &&
           gps.speed.age() < 5000)
          ? String(gps.speed.kmph(), 1) : "null";
  json += ",";

  json += "\"raw\":\"";
  json += escapeJSON(lastNMEA);
  json += "\"}";

  server.send(200, "application/json; charset=utf-8", json);
}

void handleDone() {
  server.send(200, "text/plain", "ok");
  if (connState == CS_OK) apOffAt = millis() + 1000;
}

void handleReset() {
  clearWifi();
  server.send(200, "text/html; charset=utf-8",
              htmlPage("Reset",
                       "<div class='card'>ลบ WiFi แล้ว อุปกรณ์กำลังรีสตาร์ท<br>ให้มือถือต่อ WiFi <b>" +
                       String(AP_SSID) + "</b> เพื่อตั้งค่าใหม่</div>"));
  delay(1000);
  ESP.restart();
}

void handleNotFound() {
  if (setupMode) {
    // Captive portal: ทุก URL (เช่น captive.apple.com) ส่งไปหน้าตั้งค่า -> มือถือเด้งหน้านี้ขึ้นมาเอง
    server.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/", true);
    server.send(302, "text/plain", "");
  } else {
    server.send(404, "text/plain", "Not found");
  }
}

void startWeb() {
  if (webStarted) return;
  server.on("/", handleRoot);
  server.on("/save", HTTP_POST, handleSave);
  server.on("/status", handleStatus);
  server.on("/done", handleDone);
  server.on("/ping", []() { server.send(200, "text/plain", "ok"); });
  server.on("/api/gps", handleGps);
  server.on("/reset", HTTP_POST, handleReset);
  server.onNotFound(handleNotFound);
  server.begin();
  webStarted = true;
}

void startMdns() {
  if (MDNS.begin(HOSTNAME)) MDNS.addService("http", "tcp", 80);
}

// ---------- Setup mode (Access Point) ----------
void startSetupMode() {
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_AP_STA);
  WiFi.setHostname(HOSTNAME);
  WiFi.softAP(AP_SSID, strlen(AP_PASS) ? AP_PASS : nullptr);
  dns.start(53, "*", WiFi.softAPIP());
  setupMode = true;
  setupSince = millis();
  startWeb();
  Serial.println("โหมดตั้งค่า: ให้มือถือต่อ WiFi \"" + String(AP_SSID) + "\" รหัส " + String(AP_PASS));
  Serial.println("หน้าตั้งค่าจะเด้งขึ้นมาเอง หรือเปิด http://" + WiFi.softAPIP().toString() + "/");
}

void finishSetupMode() {
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  setupMode = false;
  connState = CS_IDLE;
  apOffAt = 0;
  Serial.println("ปิดโหมดตั้งค่าแล้ว ใช้งานผ่าน " + ipUrl());
}

void setupModeLoop() {
  dns.processNextRequest();

  if (connState == CS_CONNECTING) {
    if (WiFi.status() == WL_CONNECTED) {
      saveWifi(pendingSsid, pendingPass);
      connState = CS_OK;
      apOffAt = millis() + AP_KEEP_MS;
      startMdns();
      printConnected();
    } else if (millis() - connStart > WIFI_TIMEOUT_MS) {
      WiFi.disconnect();
      connState = CS_FAIL;
      Serial.println("เชื่อมต่อไม่สำเร็จ: " + pendingSsid);
    }
  }

  if (connState == CS_OK && (int32_t)(millis() - apOffAt) >= 0) finishSetupMode();

  // มี WiFi เดิมแต่เชื่อมไม่ได้ (เช่น เราเตอร์ดับ) และไม่มีใครมาตั้งค่า -> รีสตาร์ทลองใหม่
  if (!savedSsid.isEmpty() && connState == CS_IDLE && WiFi.softAPgetStationNum() == 0 &&
      millis() - setupSince > SETUP_RETRY_MS) {
    ESP.restart();
  }
}

void resetButtonLoop() {
  static uint32_t pressedAt = 0;
  if (digitalRead(RESET_BTN_PIN) == LOW) {
    if (pressedAt == 0) pressedAt = millis();
    else if (millis() - pressedAt > RESET_HOLD_MS) {
      Serial.println("กดปุ่ม BOOT ค้าง -> ลบ WiFi แล้วรีสตาร์ทเข้าโหมดตั้งค่า");
      clearWifi();
      delay(200);
      ESP.restart();
    }
  } else {
    pressedAt = 0;
  }
}

// ---------- main ----------
void setup() {
  Serial.begin(115200);
  pinMode(RESET_BTN_PIN, INPUT_PULLUP);
  delay(1000);  // ให้ GPS บูตก่อน

  Serial.println("เริ่มระบบ ESP32 GPS");
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, -1);

  loadWifi();

  if (!savedSsid.isEmpty()) {
    Serial.println("กำลังเชื่อมต่อ WiFi ที่บันทึกไว้: " + savedSsid);
    if (connectWifi(savedSsid, savedPass)) {
      startWeb();
      startMdns();
      printConnected();
      return;
    }
    Serial.println("เชื่อมต่อไม่สำเร็จ -> เข้าโหมดตั้งค่า");
  } else {
    Serial.println("ยังไม่มีการตั้งค่า WiFi -> เข้าโหมดตั้งค่า");
  }
  startSetupMode();
}

void loop() {
  resetButtonLoop();
  gpsLoop();
  if (setupMode) setupModeLoop();
  server.handleClient();
}
