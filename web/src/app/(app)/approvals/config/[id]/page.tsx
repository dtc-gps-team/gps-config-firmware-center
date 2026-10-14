import { ConfigApprovalDetailView } from "../../config-approval-detail-view";

export const metadata = {
  title: "รายละเอียดคำขออนุมัติ Config | GPS Config Center",
};

/** หน้าเต็มสำหรับตัดสินใจอนุมัติ Config 1 ตัว — แสดงส่วนที่ต่างจากเวอร์ชันที่
 *  อนุมัติล่าสุดก่อน แล้วค่อยตามด้วยค่าทั้งหมดจัดกลุ่มตามหมวด */
export default async function ConfigApprovalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConfigApprovalDetailView configId={id} />;
}
