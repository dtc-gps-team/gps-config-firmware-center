-- สร้างกล่องจำลองสำหรับทดสอบโหลด — รันกับฐาน gps_config_firmware_loadtest เท่านั้น
-- deviceId = LT-00001..LT-06000, telemetry key = k6key-<เลข> (เก็บ SHA-256 hex ตาม TelemetryKeyGuard)
INSERT INTO "Device" (id, "deviceId", "simNumber", "deviceModel", protocol, status, "modelId", "telemetryKeyHash")
SELECT gen_random_uuid(), 'LT-' || lpad(i::text, 5, '0'), '08' || lpad(i::text, 8, '0'),
       m.name, m."supportedProtocols"[1], 'installed', m.id,
       encode(sha256(('k6key-' || i)::bytea), 'hex')
FROM generate_series(1, 6000) AS i
CROSS JOIN "DeviceModel" m
WHERE m.name = 'GT06N'
ON CONFLICT ("deviceId") DO NOTHING;
