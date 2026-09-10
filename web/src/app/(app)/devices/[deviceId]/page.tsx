import { DeviceDetailView } from "../device-detail-view";

export const metadata = {
  title: "Device Detail | GPS Config Center",
};

/** Device Detail — ต่อ `GET /devices/{deviceId}` จริง (Sprint 2 #11) */
export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = await params;
  return <DeviceDetailView deviceId={deviceId} />;
}
