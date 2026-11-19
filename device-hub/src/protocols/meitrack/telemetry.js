// แพ็กเก็ต CCE ของ TA255 → body ของ POST /device-sync/:deviceId/telemetry/:key (DeviceDataReportDto, snake_case)
// docs/33 D6 ระยะแรก — ใช้ endpoint เดิมของ ESP32 โดยไม่แก้ backend
'use strict';

// event ของ TA255 ที่ backend รู้จัก (DEVICE_EVENT_TYPES) · event อื่นส่งเป็น telemetry ธรรมดา
const EVENT_TYPES = { 19: 'OVERSPEED', 20: 'GEOFENCE_ENTER', 21: 'GEOFENCE_EXIT' };

function toTelemetryReport(packet, { imei, firmwareVersion }) {
  const fix = packet.gpsValid === 1;
  const report = {
    device_id: imei,
    latitude: packet.lat,
    longitude: packet.lng,
    speed_kmh: packet.speedKmh ?? null,
    fix,
    // TA255 ที่ไม่มี GPS ใช้ตำแหน่งจากเสา/Wi-Fi — ถือเป็น 'default' (fix=false) ให้ UI กรองออกเหมือนกล่อง ESP32
    location_source: fix ? 'gps' : 'default',
    satellites: packet.satellites,
    timestamp: packet.time ?? '',
  };
  if (firmwareVersion) report.firmware_version = firmwareVersion;
  const eventType = EVENT_TYPES[packet.eventCode];
  if (eventType) report.event_type = eventType;
  return report;
}

module.exports = { toTelemetryReport };
