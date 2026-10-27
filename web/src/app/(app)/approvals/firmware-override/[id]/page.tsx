import { DeviceFirmwareOverrideDetailView } from "../../device-firmware-override-detail-view";

export const metadata = {
  title: "รายละเอียดคำขอ Firmware Override | GPS Config Center",
};

/** หน้าเต็มสำหรับดู/ตัดสินใจคำขอ Firmware Override รายเครื่อง 1 รายการ */
export default async function DeviceFirmwareOverrideDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DeviceFirmwareOverrideDetailView id={id} />;
}
