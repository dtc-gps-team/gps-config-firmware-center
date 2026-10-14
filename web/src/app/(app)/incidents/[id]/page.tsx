import { IncidentDetailView } from "../incident-detail-view";

export const metadata = {
  title: "รายละเอียด Incident | GPS Config Center",
};

/** รายละเอียด Incident แบบหน้าเต็ม — ปลายทางของลิงก์จากตารางรายการและ
 * จากกระดิ่งแจ้งเตือน (ดู `incident-detail-view.tsx`) */
export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <IncidentDetailView incidentId={id} />;
}
