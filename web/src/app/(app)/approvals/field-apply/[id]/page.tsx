import { FieldApplyRequestDetailView } from "../../field-apply-request-detail-view";

export const metadata = {
  title: "รายละเอียดคำขอส่งเข้ากล่อง | GPS Config Center",
};

/** หน้าเต็มสำหรับดู/ตัดสินใจคำขอส่ง Config/Firmware เข้ากล่องจากหน้างาน 1 รายการ */
export default async function FieldApplyRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FieldApplyRequestDetailView id={id} />;
}
