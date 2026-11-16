#!/usr/bin/env bash
# ตั้ง env ของ backend ทดสอบโหลด (พอร์ต 3002 + ฐาน gps_config_firmware_loadtest)
# อ่าน DATABASE_URL จาก .env ของ repo ที่รัน แล้วเปลี่ยนแค่ชื่อฐาน — ไม่พิมพ์ค่าลับ
# ใช้: source env.sh <path ของ .env>
ENV_FILE="${1:?ต้องระบุ path ของ .env}"
BASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"\r')
export DATABASE_URL="${BASE_URL%/*}/gps_config_firmware_loadtest"
export PORT=3002
export NOTIFICATION_MODE=mock
export CENTRAL_MODE=mock
export DEVICE_CONFIG_APPLY_MODE=mock
export LEGACY_SYNC_MODE=mock
export TELEMETRY_RATE_LIMIT_PER_IP="${TELEMETRY_RATE_LIMIT_PER_IP:-100000000}"
