import { DeviceConfigOverrideDetailView } from "../../device-config-override-detail-view";

export const metadata = {
  title: "รายละเอียดคำขอ Config Override | GPS Config Center",
};

/** หน้าเต็มสำหรับดู/ตัดสินใจคำขอ Config Override รายเครื่อง 1 รายการ */
export default async function DeviceConfigOverrideDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DeviceConfigOverrideDetailView id={id} />;
}
