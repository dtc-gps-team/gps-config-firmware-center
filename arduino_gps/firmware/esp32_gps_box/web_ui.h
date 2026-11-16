#pragma once

// ============================
// เว็บในกล่อง: หน้าตั้งค่า (Captive Portal) + หน้าสถานะ
// ============================

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
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
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

// ---------- HTML ----------
String htmlEscape(String s) {
  s.replace("&", "&amp;");
  s.replace("<", "&lt;");
  s.replace(">", "&gt;");
  s.replace("\"", "&quot;");
  s.replace("'", "&#39;");
  return s;
}

String htmlPage(const String &body) {
  String html = R"HTML(<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Cache-Control" content="no-store">
<title>ESP32 GPS Box</title>
<style>
* { box-sizing:border-box; }
body { margin:0; padding:20px; font-family:Arial,Tahoma,sans-serif; background:#0f172a; color:#f8fafc; }
.container { max-width:650px; margin:auto; }
.card { background:#1e293b; border:1px solid #334155; padding:20px; border-radius:14px; margin-bottom:14px; }
h1 { font-size:23px; color:#38bdf8; }
h2 { font-size:17px; }
.small { color:#94a3b8; font-size:13px; }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.value { font-size:25px; font-weight:bold; margin-top:9px; }
.status { padding:13px; border-radius:8px; background:#334155; font-weight:bold; }
.green { color:#4ade80; }
.red { color:#f87171; }
.amber { color:#fbbf24; }
.ip { font-size:28px; font-weight:bold; color:#4ade80; }
.hide { display:none; }
.badge { display:inline-block; padding:3px 10px; border-radius:999px; background:#0284c7; font-size:13px; margin:2px; }
.badge.off { background:#475569; }
.badge.done { background:#16a34a; }
.badge.now { background:#f59e0b; }
.bar { height:14px; background:#334155; border-radius:7px; overflow:hidden; margin:10px 0; }
.bar > div { height:100%; width:0; background:#38bdf8; transition:width .4s; }
.log { color:#cbd5e1; max-height:260px; overflow:auto; }
#updBanner { display:block; border-color:#38bdf8; color:#f8fafc; text-decoration:none; }
#updBanner.hide { display:none; }
.menu { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px; }
.menu a { padding:7px 12px; border-radius:999px; background:#1e293b; border:1px solid #334155; color:#94a3b8; font-size:13px; text-decoration:none; }
.menu a.active { background:#0284c7; border-color:#0284c7; color:#fff; }
input,select,button { width:100%; padding:13px; border-radius:8px; margin:8px 0; font-size:15px; }
input,select { background:#fff; color:#111827; border:0; }
button { background:#0284c7; color:white; font-weight:bold; border:0; cursor:pointer; }
button.danger { background:#dc2626; }
td { padding:4px 8px; vertical-align:top; }
a { color:#38bdf8; }
pre { color:#4ade80; white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; }
</style>
</head>
<body>
<div class="container">
)HTML";
  html += body;
  html += "</div></body></html>";
  return html;
}

// ---------- หน้าตั้งค่า (WiFi + Server) ----------
void sendSetupPage() {
  int n = WiFi.scanNetworks();
  String options;
  for (int i = 0; i < n; i++) {
    String s = htmlEscape(WiFi.SSID(i));
    if (s.isEmpty()) continue;
    options += "<option value=\"" + s + "\">" + s + " (" + WiFi.RSSI(i) + " dBm)</option>";
  }
  WiFi.scanDelete();
  if (options.isEmpty()) options = "<option value=''>ไม่พบเครือข่าย WiFi</option>";

  String body =
    "<div class='card' id='formCard'>"
    "<h1>ตั้งค่ากล่อง GPS</h1>"
    "<p class='small'>Firmware v" FIRMWARE_VERSION "</p>"
    "<form id='f'>"
    "<h2>Wi-Fi บ้าน (2.4 GHz)</h2>"
    "<select name='ssid'>" + options + "</select>"
    "<input name='manual' placeholder='หรือพิมพ์ชื่อ Wi-Fi เอง (ถ้าไม่มีในรายการ)'>"
    "<input type='password' name='pass' placeholder='รหัสผ่าน Wi-Fi'>"
    "<h2>Server ส่วนกลาง</h2>"
    "<label class='small'>Device ID</label>"
    "<input name='device_id' value='" + htmlEscape(mgmt.deviceId) + "'>"
    "<label class='small'>Gateway URL</label>"
    "<input name='gateway_url' value='" + htmlEscape(mgmt.gatewayUrl) + "'>"
    "<label class='small'>Delivery URL</label>"
    "<input name='delivery_url' value='" + htmlEscape(mgmt.deliveryUrl) + "'>"
    "<button type='submit'>บันทึกและเชื่อมต่อ</button>"
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
    .then(r=>r.json()).then(j=>{
      if(!j.ok){show('<b class=red>'+j.error+'</b>');fc.classList.remove('hide');return;}
      setTimeout(poll,1500);
    })
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
function go(u){
  fetch(u+'ping',{mode:'no-cors',cache:'no-store'})
    .then(()=>{location.href=u;})
    .catch(()=>setTimeout(()=>go(u),2000));
}
</script>
)HTML";

  server.send(200, "text/html; charset=utf-8", htmlPage(body));
}

// ---------- หน้าสถานะ ----------
// หน้า "GPS" = หน้าเดิมทุกอย่าง ส่วนที่เพิ่มใหม่แยกเป็นเมนู:
//   Server / อัปเดต (#server), Config (#config), ส่งข้อมูล / แจ้งเตือน (#data), ประวัติ (#log)
// แถบ "กำลังอัปเดต" แสดงเฉพาะตอนมีการอัปเดต firmware / config
void sendMonitorPage() {
  String body = R"HTML(
<nav class="menu">
  <a href="#gps" data-tab="gps">GPS</a>
  <a href="#server" data-tab="server">Server / อัปเดต</a>
  <a href="#config" data-tab="config">Config</a>
  <a href="#data" data-tab="data">ส่งข้อมูล / แจ้งเตือน</a>
  <a href="#log" data-tab="log">ประวัติ</a>
  <a href="#sim" data-tab="sim">จำลองการขับ</a>
</nav>

<a href="#server" class="card hide" id="updBanner">
  <b id="updBannerText">กำลังอัปเดต...</b>
  <div class="bar"><div id="updBannerBar"></div></div>
</a>

<!-- ================= GPS (หน้าเดิม) ================= -->
<section id="tab-gps">
<div class="card">
<h1>ติดตามสถานะ GPS แบบเรียลไทม์</h1>
<p class="small">GY-GPS6MV2 | GPIO13 | <span id="baud">9600</span> baud</p>
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
)HTML";

  body += "<div class='card'><h2>สถานะอุปกรณ์</h2><table>";
  body += "<tr><td>Wi-Fi</td><td><b>" + htmlEscape(WiFi.SSID()) + "</b></td></tr>";
  body += "<tr><td>IP</td><td><b>" + WiFi.localIP().toString() + "</b></td></tr>";
  body += "<tr><td>Hostname</td><td>" + String(HOSTNAME) + ".local</td></tr>";
  body += "<tr><td>สัญญาณ</td><td>" + String(WiFi.RSSI()) + " dBm</td></tr>";
  body += "<tr><td>MAC</td><td>" + WiFi.macAddress() + "</td></tr>";
  body += "<tr><td>Uptime</td><td><span id='uptime'>" + String(millis() / 1000) + "</span> วินาที</td></tr>";
  body += "</table>"
          "<form method='POST' action='/reset' "
          "onsubmit=\"return confirm('ลบ WiFi แล้วเข้าโหมดตั้งค่าใหม่? (ค่า Server จะยังอยู่)')\">"
          "<button class='danger' type='submit'>เปลี่ยน WiFi (เข้าโหมดตั้งค่าใหม่)</button></form></div>"
          "</section>";

  body += R"HTML(
<!-- ================= Server / อัปเดต ================= -->
<section id="tab-server" class="hide">
<div class="card">
<h1>Server ส่วนกลาง</h1>
<p><span class="badge" id="fwBadge">Firmware v-</span><span class="badge" id="schemaBadge">Schema -</span>
<span class="badge">GPS</span><span class="badge off" id="fSpeed">Speed limit</span><span class="badge off" id="fGeo">Geofence</span></p>
<div class="status" id="mgmt">กำลังตรวจสอบ...</div>
<table>
<tr><td>Device ID</td><td><b id="devid">-</b></td></tr>
<tr><td>config_version</td><td><b id="cfgver">-</b></td></tr>
<tr><td>Gateway</td><td class="small" id="gwUrl">-</td></tr>
<tr><td>Delivery</td><td class="small" id="dlUrl">-</td></tr>
<tr><td>คำสั่งล่าสุด</td><td class="small" id="cmd">-</td></tr>
</table>
<p class="small red" id="srverr"></p>
</div>

<div class="card">
<h2 id="updTitle">การอัปเดต</h2>
<div class="bar"><div id="updBar"></div></div>
<p class="steps" id="updSteps"></p>
<p id="updMsg" class="small">ยังไม่มีการอัปเดต รอคำสั่งจาก Server</p>
</div>
</section>

<!-- ================= Config ================= -->
<section id="tab-config" class="hide">
<div class="card">
<h1>Config ที่ใช้งานอยู่</h1>
<p class="small">config_version <b id="cfgver2">-</b> (ค่าจาก Server ส่วนกลาง)</p>
<table id="cfg"></table>
</div>
</section>

<!-- ================= ส่งข้อมูล / แจ้งเตือน ================= -->
<section id="tab-data" class="hide">
<div class="card">
<h1>ส่งข้อมูล / แจ้งเตือน</h1>
<table>
<tr><td>Data Server</td><td id="ds">-</td></tr>
<tr><td>รอบส่ง</td><td id="dsInterval">-</td></tr>
<tr><td>ส่งล่าสุด</td><td id="dscode">-</td></tr>
<tr><td>แจ้งเตือน</td><td id="alert">-</td></tr>
<tr><td>Event ล่าสุด</td><td id="event">-</td></tr>
</table>
</div>
</section>

<!-- ================= จำลองการขับ ================= -->
<section id="tab-sim" class="hide">
<div class="card">
<h1>จำลองการขับ</h1>
<p class="small">ใช้สาธิตการตรวจจับความเร็วเกินโดยไม่ต้องขับจริง — ความเร็วจำลองถูกส่งเข้าระบบของกล่อง (ข้อมูลที่ส่งออกจะติดป้าย simulated)</p>
<div class="status" id="simStatus">โหมดจำลองปิดอยู่</div>
<svg id="gauge" viewBox="0 0 300 230" style="width:100%;max-width:420px;display:block;margin:10px auto"></svg>
<div style="text-align:center"><span class="value" id="simSpeed" style="font-size:44px">0</span> <span class="small">กม./ชม.</span></div>
<p class="small" style="text-align:center" id="simLimit"></p>
<div class="grid">
  <button id="brakeBtn" class="danger" style="padding:26px;font-size:20px;touch-action:none;user-select:none">เบรก</button>
  <button id="gasBtn" style="padding:26px;font-size:20px;background:#16a34a;touch-action:none;user-select:none">คันเร่ง</button>
</div>
<p class="small" style="text-align:center">กดค้างเพื่อเร่ง / เบรก · ปล่อยแล้วความเร็วจะค่อย ๆ ลด · คีย์บอร์ด: ลูกศรขึ้น / ลง</p>
<button id="simToggle" style="background:#334155">เปิดโหมดจำลอง</button>
</div>
</section>

<!-- ================= ประวัติ ================= -->
<section id="tab-log" class="hide">
<div class="card">
<h1>ประวัติการอัปเดต</h1>
<pre class="log" id="log">-</pre>
</div>
</section>

<script>
const $=id=>document.getElementById(id);
const TABS=['gps','server','config','data','log','sim'];
const FW_STEPS=['ACKNOWLEDGED','DOWNLOADING','VALIDATING','INSTALLING','REBOOTING','SUCCESS'];
const CFG_STEPS=['ACKNOWLEDGED','SUCCESS'];
const STEP_TH={ACKNOWLEDGED:'รับคำสั่ง',DOWNLOADING:'ดาวน์โหลด',VALIDATING:'ตรวจลายเซ็น',INSTALLING:'ติดตั้ง',REBOOTING:'รีบูต',SUCCESS:'สำเร็จ',FAILED:'ล้มเหลว',ROLLED_BACK:'ย้อนกลับเวอร์ชันเดิม'};
let lastUpd=null,lastFw=null,offline=0;

function showTab(){
  const t=TABS.includes(location.hash.slice(1))?location.hash.slice(1):'gps';
  TABS.forEach(n=>$('tab-'+n).classList.toggle('hide',n!==t));
  document.querySelectorAll('.menu a').forEach(a=>a.classList.toggle('active',a.dataset.tab===t));
}
window.addEventListener('hashchange',showTab);
showTab();

// ---------- จำลองการขับ: หน้าปัดความเร็ว ----------
const SIM_MAX=200,G_START=-120,G_SPAN=240;  // องศาเข็ม: 0 กม./ชม. = -120°, 200 = +120°
const NS='http://www.w3.org/2000/svg';
const sim={on:false,speed:0,gas:false,brake:false,limit:null,lastSend:0};
function svg(tag,attrs){const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);$('gauge').appendChild(e);return e;}
function polar(v,r){const a=(G_START+v/SIM_MAX*G_SPAN-90)*Math.PI/180;return [150+r*Math.cos(a),150+r*Math.sin(a)];}
function arc(v1,v2,r){const [x1,y1]=polar(v1,r),[x2,y2]=polar(v2,r);return 'M'+x1+' '+y1+' A'+r+' '+r+' 0 '+((v2-v1)/SIM_MAX*G_SPAN>180?1:0)+' 1 '+x2+' '+y2;}
let needle,redZone;
function drawGauge(){
  $('gauge').replaceChildren();
  svg('path',{d:arc(0,SIM_MAX,120),stroke:'#334155','stroke-width':14,fill:'none'});
  redZone=svg('path',{d:'',stroke:'#dc2626','stroke-width':14,fill:'none'});
  for(let v=0;v<=SIM_MAX;v+=10){
    const big=v%20===0,[x1,y1]=polar(v,big?100:106),[x2,y2]=polar(v,113);
    svg('line',{x1,y1,x2,y2,stroke:'#94a3b8','stroke-width':big?3:1.5});
    if(big){const [tx,ty]=polar(v,84);svg('text',{x:tx,y:ty+5,fill:'#cbd5e1','font-size':13,'text-anchor':'middle'}).textContent=v;}
  }
  needle=svg('line',{x1:150,y1:150,x2:150,y2:45,stroke:'#f8fafc','stroke-width':4,'stroke-linecap':'round'});
  svg('circle',{cx:150,cy:150,r:9,fill:'#38bdf8'});
}
function renderGauge(){
  const over=sim.limit!==null&&sim.speed>sim.limit;
  needle.setAttribute('transform','rotate('+(G_START+sim.speed/SIM_MAX*G_SPAN)+' 150 150)');
  needle.setAttribute('stroke',over?'#f87171':'#f8fafc');
  redZone.setAttribute('d',sim.limit!==null&&sim.limit<SIM_MAX?arc(sim.limit,SIM_MAX,120):'');
  $('simSpeed').textContent=sim.speed.toFixed(0);
  $('simSpeed').className='value'+(over?' red':'');
}
function sendSim(force){
  if(!force&&Date.now()-sim.lastSend<250)return;
  sim.lastSend=Date.now();
  fetch('/api/sim',{method:'POST',body:JSON.stringify({active:sim.on,speed:Math.round(sim.speed*10)/10})}).catch(()=>{});
}
function simTick(){
  if(sim.on){
    const dt=0.05;
    if(sim.gas)sim.speed+=28*dt;else if(sim.brake)sim.speed-=70*dt;else sim.speed-=6*dt;
    sim.speed=Math.max(0,Math.min(SIM_MAX,sim.speed));
    sendSim(false);
  }
  renderGauge();
}
function setSim(on){
  sim.on=on;
  if(!on){sim.speed=0;sim.gas=sim.brake=false;}
  $('simToggle').textContent=on?'ปิดโหมดจำลอง':'เปิดโหมดจำลอง';
  sendSim(true);
}
function hold(btn,key){
  btn.addEventListener('pointerdown',e=>{e.preventDefault();if(!sim.on)setSim(true);sim[key]=true;});
  ['pointerup','pointerleave','pointercancel'].forEach(t=>btn.addEventListener(t,()=>{sim[key]=false;}));
}
drawGauge();
hold($('gasBtn'),'gas');
hold($('brakeBtn'),'brake');
$('simToggle').addEventListener('click',()=>setSim(!sim.on));
document.addEventListener('keydown',e=>{
  if(location.hash!=='#sim')return;
  if(e.key==='ArrowUp'){if(!sim.on)setSim(true);sim.gas=true;e.preventDefault();}
  if(e.key==='ArrowDown'){sim.brake=true;e.preventDefault();}
});
document.addEventListener('keyup',e=>{if(e.key==='ArrowUp')sim.gas=false;if(e.key==='ArrowDown')sim.brake=false;});
setInterval(simTick,50);
function updateSimInfo(d){
  const sl=d.config.speed_limit;
  sim.limit=d.features.speed_limit&&sl&&sl.enabled?sl.max_kmh:null;
  $('simLimit').textContent=!d.features.speed_limit?'firmware v'+d.firmware_version+' ยังไม่มีการตรวจจับความเร็วเกิน (มีใน v1.1.0 ขึ้นไป)'
    :sim.limit===null?'ยังไม่ได้เปิดตรวจความเร็วเกินใน Config (speed_limit.enabled)'
    :'ความเร็วสูงสุดที่ตั้งไว้ '+sim.limit+' กม./ชม. — เกินต่อเนื่อง 3 วินาทีจะแจ้งเตือน';
  const st=$('simStatus');
  if(!d.sim.active){st.textContent='โหมดจำลองปิดอยู่ — กดคันเร่งเพื่อเริ่ม';st.className='status';}
  else if(d.alerts.length){st.textContent='แจ้งเตือน: '+d.alerts.join(', ')+' · '+d.last_event;st.className='status red';}
  else{st.textContent='กำลังจำลอง — กล่องใช้ความเร็ว '+d.sim.speed+' กม./ชม.';st.className='status green';}
}

function flat(o,p,out){for(const k in o){const v=o[k],key=p?p+'.'+k:k;if(v&&typeof v==='object')flat(v,key,out);else out.push([key,v]);}return out;}

function updPercent(u,steps){
  if(u.status==='SUCCESS')return 100;
  if(u.action==='UPDATE_FIRMWARE'){
    if(u.status==='DOWNLOADING')return Math.max(5,(u.progress>=0?u.progress:0)*0.7);
    return {ACKNOWLEDGED:3,VALIDATING:75,INSTALLING:85,REBOOTING:95}[u.status]||0;
  }
  const i=steps.indexOf(u.status);return i>=0?Math.round(i/(steps.length-1)*100):0;
}

function showUpdate(u,fw){
  const has=u&&u.command_id;
  const recent=has&&(u.active||u.age_sec<30);
  $('updBanner').classList.toggle('hide',!recent);
  if(!has)return;
  const isFw=u.action==='UPDATE_FIRMWARE';
  const steps=isFw?FW_STEPS:CFG_STEPS;
  const failed=u.status==='FAILED'||u.status==='ROLLED_BACK';
  const title=(isFw?'อัปเดต Firmware → v'+u.target:'รับ Config ใหม่ → version '+u.target)
    +(u.active?' ...':failed?' : ไม่สำเร็จ':' : สำเร็จ');
  const pct=updPercent(u,steps);
  const color=failed?'#f87171':u.status==='SUCCESS'?'#4ade80':'#38bdf8';
  $('updTitle').textContent=title;
  $('updTitle').className=failed?'red':u.active?'':'green';
  $('updBannerText').textContent=title+(u.status==='DOWNLOADING'&&u.progress>=0?' '+u.progress+'%':'');
  for(const id of ['updBar','updBannerBar']){$(id).style.width=pct+'%';$(id).style.background=color;}
  const idx=steps.indexOf(u.status);
  $('updSteps').innerHTML=steps.map((s,i)=>{
    const cls=failed&&i>=idx?'off':(i<idx||u.status==='SUCCESS')?'done':i===idx?'now':'off';
    return '<span class="badge '+cls+'">'+STEP_TH[s]+(s==='DOWNLOADING'&&u.status===s&&u.progress>=0?' '+u.progress+'%':'')+'</span>';
  }).join(' ');
  $('updMsg').textContent=failed?(STEP_TH[u.status]+(u.error?' : '+u.error:''))
    :u.status==='REBOOTING'?'กล่องกำลังรีบูตเข้า firmware ใหม่ หน้านี้จะกลับมาเอง...'
    :u.status==='SUCCESS'&&isFw?'ตอนนี้กล่องรัน firmware v'+fw+' แล้ว'
    :u.status==='SUCCESS'?'ใช้ค่า config ใหม่แล้ว (ดูรายการที่เปลี่ยนในเมนูประวัติ)':'กำลังดำเนินการ...';
}

async function update() {
  try {
    const d = await (await fetch('/api/status', { cache: 'no-store' })).json();
    offline=0;

    // ---------- GPS (หน้าเดิม) ----------
    const status = $('status');
    status.textContent = d.gps_active ? 'กำลังรับข้อมูลจาก GPS' : 'ยังไม่ได้รับข้อมูลจาก GPS';
    status.className = d.gps_active ? 'status green' : 'status red';
    $('fix').textContent = d.fix ? 'จับตำแหน่งดาวเทียมสำเร็จ'
      : d.gps_active ? 'กำลังรอจับตำแหน่งดาวเทียม' : 'ยังไม่สามารถตรวจสอบตำแหน่งได้';
    $('bytes').textContent = d.bytes;
    $('nmea').textContent = d.nmea;
    $('sats').textContent = d.gps_active ? d.satellites : '--';
    $('speed').textContent = d.speed === null ? '--' : d.speed;
    $('lat').textContent = d.latitude === null ? '--' : d.latitude;
    $('lng').textContent = d.longitude === null ? '--' : d.longitude;
    $('raw').textContent = d.raw || 'กำลังรอข้อมูล GPS...';
    $('uptime').textContent = d.uptime_sec;
    $('baud').textContent = d.config.gps.baud_rate;
    const map = $('maplink');
    if (d.latitude !== null && d.longitude !== null) {
      const a = document.createElement('a');
      a.href = 'https://www.google.com/maps?q=' + d.latitude + ',' + d.longitude;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'เปิดตำแหน่งบน Google Maps';
      // ยังไม่มีสัญญาณ GPS: แสดงพิกัดเริ่มต้น พร้อมบอกให้ชัดว่าไม่ใช่ตำแหน่งจริง
      if (d.fix) {
        map.replaceChildren(a);
      } else {
        const note = document.createElement('span');
        note.className = 'small amber';
        note.textContent = 'ยังไม่มีสัญญาณ GPS — แสดงพิกัดเริ่มต้น';
        map.replaceChildren(note, document.createElement('br'), a);
      }
    } else {
      map.textContent = 'ยังไม่มีพิกัดที่ใช้งานได้';
    }

    // ---------- เมนูใหม่ ----------
    if(lastFw&&lastFw!==d.firmware_version){location.reload();return;}  // รีบูตเข้า firmware ใหม่แล้ว
    lastFw=d.firmware_version;
    $('fwBadge').textContent='Firmware v'+d.firmware_version;
    $('schemaBadge').textContent='Schema '+d.schema_version;
    $('fSpeed').className='badge'+(d.features.speed_limit?'':' off');
    $('fGeo').className='badge'+(d.features.geofence?'':' off');
    $('devid').textContent=d.device_id;
    $('cfgver').textContent=d.config_version;
    $('cfgver2').textContent=d.config_version;
    $('gwUrl').textContent=d.gateway_url;
    $('dlUrl').textContent=d.delivery_url;
    $('mgmt').textContent=d.mgmt_connected?'เชื่อมต่อ Server ส่วนกลางแล้ว':(d.mgmt_configured?'กำลังเชื่อมต่อ Server ส่วนกลาง...':'ยังไม่ได้ตั้งค่า Server (กด "เปลี่ยน WiFi" ที่เมนู GPS เพื่อตั้งค่า)');
    $('mgmt').className='status '+(d.mgmt_connected?'green':'amber');
    $('cmd').textContent=d.last_command;
    $('srverr').textContent=d.server_error;
    $('log').textContent=d.update_log.length?d.update_log.join('\n'):'-';
    $('cfg').replaceChildren(...flat(d.config,'',[]).map(([k,v])=>{const tr=document.createElement('tr');tr.innerHTML='<td class=small></td><td></td>';tr.children[0].textContent=k;tr.children[1].textContent=v;return tr;}));
    $('ds').textContent=d.data_server||'(ยังไม่ได้ตั้งค่า)';
    $('dsInterval').textContent='ทุก '+d.config.gps.send_interval_sec+' วินาที (เมื่อจับพิกัดได้)';
    $('dscode').textContent=d.data_http_code?('HTTP '+d.data_http_code):'-';
    $('alert').innerHTML=d.alerts.length?'<b class=red>'+d.alerts.join(', ')+'</b>':'<span class=green>ปกติ</span>';
    $('event').textContent=d.last_event;
    updateSimInfo(d);
    lastUpd=d.update;
    showUpdate(d.update,d.firmware_version);
  } catch (e) {
    offline++;
    if(lastUpd&&lastUpd.active&&lastUpd.action==='UPDATE_FIRMWARE'){
      lastUpd.status='REBOOTING';
      showUpdate(lastUpd,lastFw);
      $('updMsg').textContent='กล่องกำลังรีบูตเข้า firmware ใหม่ รอสักครู่... ('+offline+' วินาที)';
      $('updBannerText').textContent='กล่องกำลังรีบูตเข้า firmware ใหม่... ('+offline+' วินาที)';
    } else {
      $('status').textContent = 'ไม่สามารถเชื่อมต่อกับ ESP32 ได้';
    }
  }
}

setInterval(update,1000);
update();
</script>
)HTML";

  server.send(200, "text/html; charset=utf-8", htmlPage(body));
}

// โหมดจำลองการขับ: หน้าเว็บส่ง {active, speed} มาเรื่อย ๆ (ถ้าหยุดส่ง 5 วินาทีจะปิดเอง)
void handleSim() {
  JsonDocument b;
  if (deserializeJson(b, server.arg("plain"))) {
    server.send(400, "application/json", "{\"error\":\"INVALID_JSON\"}");
    return;
  }
  bool active = b["active"] | false;
  float speed = b["speed"] | 0.0f;
  if (active != simActive) Serial.printf("[sim] %s\n", active ? "เปิดโหมดจำลอง" : "ปิดโหมดจำลอง");
  simActive = active;
  simSpeedKmh = active ? constrain(speed, 0.0f, 300.0f) : 0;
  simLastMs = millis();
  server.send(200, "application/json", "{\"ok\":true}");
}

void handleApiStatus() {
  bool gpsActive = gpsBytes > 0 && millis() - lastGPSByte < 5000;
  bool fix = gpsActive && gpsFix();
  JsonDocument d;
  d["device_id"] = mgmt.deviceId;
  d["firmware_version"] = FIRMWARE_VERSION;
  d["ota_partition"] = otaPartitionInfo();
  d["schema_version"] = SCHEMA_VERSION;
  d["features"]["speed_limit"] = (bool)FEATURE_SPEED_LIMIT;
  d["features"]["geofence"] = (bool)FEATURE_GEOFENCE;
  d["config_version"] = cfg.version;
  d["uptime_sec"] = millis() / 1000;
  d["mgmt_configured"] = mgmtConfigured();
  d["mgmt_connected"] = mgmtConnected;
  d["gateway_url"] = mgmt.gatewayUrl;
  d["delivery_url"] = mgmt.deliveryUrl;
  d["gps_active"] = gpsActive;
  d["fix"] = fix;
  d["bytes"] = gpsBytes;
  d["nmea"] = nmeaStarts;
  d["satellites"] = gps.satellites.isValid() ? gps.satellites.value() : 0;
  if (fix) {
    d["latitude"] = serialized(String(gps.location.lat(), 6));
    d["longitude"] = serialized(String(gps.location.lng(), 6));
    if (gps.speed.isValid() && gps.speed.age() < 5000) d["speed"] = serialized(String(gps.speed.kmph(), 1));
    else d["speed"] = nullptr;
  } else {
    // ยังไม่มีสัญญาณ GPS: ส่งพิกัดเริ่มต้นให้หน้าเว็บแสดง (fix = false บอกว่าไม่ใช่ตำแหน่งจริง)
    d["latitude"] = serialized(DEFAULT_LATITUDE);
    d["longitude"] = serialized(DEFAULT_LONGITUDE);
    d["location_source"] = "default";
    d["speed"] = nullptr;
  }
  d["raw"] = lastNMEA;
  configToJson(cfg, d["config"].to<JsonObject>());
  d["data_server"] = cfg.dsHost.length() ? dataServerUrl() : "";
  d["data_http_code"] = lastDataHttpCode;
  JsonArray alerts = d["alerts"].to<JsonArray>();
  if (alertOverspeed) alerts.add("ความเร็วเกิน");
  if (alertGeofence) alerts.add("ออกนอกพื้นที่");
  d["last_event"] = lastEventText;
  d["sim"]["active"] = simActive;
  d["sim"]["speed"] = serialized(String(simSpeedKmh, 1));
  d["last_command"] = lastCommandText;
  d["server_error"] = lastServerError;

  JsonObject u = d["update"].to<JsonObject>();
  u["active"] = upd.active;
  u["command_id"] = upd.commandId;
  u["action"] = upd.action;
  u["target"] = upd.target;
  u["status"] = upd.status;
  u["progress"] = upd.progress;
  u["error"] = upd.error;
  u["age_sec"] = (millis() - upd.changedMs) / 1000;

  // ประวัติการอัปเดต ใหม่สุดอยู่บน
  JsonArray log = d["update_log"].to<JsonArray>();
  for (uint8_t i = 1; i <= UPDATE_LOG_SIZE; i++) {
    const String &line = updateLog[(updateLogNext + UPDATE_LOG_SIZE - i) % UPDATE_LOG_SIZE];
    if (line.length()) log.add(line);
  }

  String out;
  serializeJson(d, out);
  server.send(200, "application/json; charset=utf-8", out);
}

// ---------- Handlers ----------
void handleRoot() {
  if (setupMode) sendSetupPage();
  else sendMonitorPage();
}

void handleSave() {
  if (!setupMode) {
    server.send(403, "application/json", "{\"ok\":false,\"error\":\"not in setup mode\"}");
    return;
  }
  pendingSsid = server.arg("manual");
  pendingSsid.trim();
  if (pendingSsid.isEmpty()) pendingSsid = server.arg("ssid");
  pendingPass = server.arg("pass");

  String id = server.arg("device_id");
  String gw = server.arg("gateway_url"), dl = server.arg("delivery_url");
  id.trim(), gw.trim(), dl.trim();
  while (dl.endsWith("/")) dl.remove(dl.length() - 1);
  ParsedUrl u;
  const char *error = nullptr;
  if (pendingSsid.isEmpty()) error = "กรุณาเลือก Wi-Fi";
  else if (id.isEmpty() || id.length() > 32) error = "Device ID ไม่ถูกต้อง";
  else if (!parseUrl(gw, u) || !gw.startsWith("ws")) error = "Gateway URL ต้องขึ้นต้นด้วย ws:// หรือ wss://";
  else if (!parseUrl(dl, u) || !dl.startsWith("http")) error = "Delivery URL ต้องขึ้นต้นด้วย http:// หรือ https://";
  if (error) {
    server.send(400, "application/json; charset=utf-8", String("{\"ok\":false,\"error\":\"") + error + "\"}");
    return;
  }

  mgmt.deviceId = id;
  mgmt.gatewayUrl = gw;
  mgmt.deliveryUrl = dl;
  saveMgmt();

  server.send(200, "application/json", "{\"ok\":true}");
  Serial.println("กำลังเชื่อมต่อ: " + pendingSsid);
  WiFi.disconnect();
  WiFi.begin(pendingSsid.c_str(), pendingPass.c_str());
  connState = CS_CONNECTING;
  connStart = millis();
}

void handleStatus() {
  const char *st = connState == CS_CONNECTING ? "connecting"
                   : connState == CS_OK       ? "ok"
                   : connState == CS_FAIL     ? "fail"
                                              : "idle";
  JsonDocument d;
  d["state"] = st;
  d["ssid"] = htmlEscape(WiFi.SSID());
  d["ip"] = WiFi.localIP().toString();
  String out;
  serializeJson(d, out);
  server.send(200, "application/json", out);
}

void handleDone() {
  server.send(200, "text/plain", "ok");
  if (connState == CS_OK) apOffAt = millis() + 1000;
}

void handleReset() {
  clearWifi();
  server.send(200, "text/html; charset=utf-8",
              htmlPage("<div class='card'>ลบ WiFi แล้ว อุปกรณ์กำลังรีสตาร์ท<br>ให้มือถือต่อ WiFi <b>" + String(AP_SSID) +
                       "</b> (รหัส " + AP_PASS + ") เพื่อตั้งค่าใหม่</div>"));
  delay(1000);
  ESP.restart();
}

void handleNotFound() {
  if (setupMode) {
    // Captive portal: ทุก URL ส่งไปหน้าตั้งค่า -> มือถือเด้งหน้านี้ขึ้นมาเอง
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
  server.on("/ping", []() {
    server.send(200, "text/plain", "ok");
  });
  server.on("/api/status", handleApiStatus);
  server.on("/api/sim", HTTP_POST, handleSim);
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

  // มี WiFi เดิมแต่เชื่อมไม่ได้ และไม่มีใครมาตั้งค่า -> รีสตาร์ทลองใหม่
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
