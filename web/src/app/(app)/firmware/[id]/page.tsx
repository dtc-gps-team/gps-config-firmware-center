import { FirmwareDetailView } from "../firmware-detail-view";

export const metadata = {
  title: "รายละเอียด Firmware | GPS Config Center",
};

/** รายละเอียด Firmware แบบหน้าเต็ม — ข้อมูลไฟล์ + Compatibility Tag (แก้ได้
 *  เฉพาะ SW) + ทดสอบกับ Device Simulator (SW/Operation/ST/OT) */
export default async function FirmwareDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FirmwareDetailView firmwareId={id} />;
}
