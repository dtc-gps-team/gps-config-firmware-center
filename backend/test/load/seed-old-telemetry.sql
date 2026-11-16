-- S5: เติม telemetry ที่เก่ากว่า 7 วัน (8 วันก่อน) ไว้ล่วงหน้า เพื่อดูว่า job ลบข้อมูลเก่า
-- (device-telemetry-retention, ชั่วโมงละครั้ง) ลบได้กี่แถวต่อรอบ — ฐาน loadtest เท่านั้น
-- 300 กล่อง × 1 ชม. ที่ส่งทุก 10 วิ = 108,000 แถว → เติม 2 ชม. = 216,000 แถว
INSERT INTO "DeviceTelemetry" (id, "deviceId", latitude, longitude, "speedKmh", fix, satellites, "locationSource", simulated, "recordedAt", "receivedAt")
SELECT gen_random_uuid()::text,
       'LT-' || lpad(((i % 300) + 1)::text, 5, '0'),
       13.7 + random() * 0.1, 100.5 + random() * 0.1, round((random() * 90)::numeric, 1),
       true, 9, 'gps', false,
       now() - interval '8 days' - (i * interval '33 milliseconds'),
       now() - interval '8 days' - (i * interval '33 milliseconds')
FROM generate_series(1, 216000) AS i;
