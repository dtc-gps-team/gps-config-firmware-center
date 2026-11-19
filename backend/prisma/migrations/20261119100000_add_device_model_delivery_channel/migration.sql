-- docs/33: ทางส่งเข้ากล่องต่อรุ่น (null = Server กลาง ESP32 เหมือนเดิม)
ALTER TABLE "DeviceModel" ADD COLUMN "deliveryChannel" TEXT;
