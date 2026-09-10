import { DeviceSearchView } from "./device-search-view";

export const metadata = {
  title: "Device Search | GPS Config Center",
};

/** Device Search — ต่อ `GET /devices` จริง (Sprint 2 #11) · ทุก Role อ่านได้ */
export default function DevicesPage() {
  return <DeviceSearchView />;
}
