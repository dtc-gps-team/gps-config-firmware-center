import { ParameterLibraryView } from "./parameter-library-view";

export const metadata = {
  title: "Parameter Library | GPS Config Center",
};

/**
 * Config Definition Lookup (task #12/#26) — ต่อ `GET /config-definitions` จริง
 * (ดู parameter-library-view.tsx) — SW/Operation/ST/OT เท่านั้น (Auditor/Admin
 * ไม่มีสิทธิ์เข้า — gate ทั้งหน้าผ่าน ParameterLibraryView)
 */
export default function ParametersPage() {
  return <ParameterLibraryView />;
}
