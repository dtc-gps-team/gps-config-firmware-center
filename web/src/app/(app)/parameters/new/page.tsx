import { ParameterNewView } from "./parameter-new-view";

export const metadata = {
  title: "สร้าง Parameter ใหม่ | GPS Config Center",
};

/** สร้าง Parameter ใหม่ (`POST /config-definitions`) — หน้าแยกเหมือน `/config/new`
 *  สร้างได้เฉพาะ Role ConfigEngineer (gate ทั้งหน้าใน `ParameterNewView`) */
export default function ParameterNewPage() {
  return <ParameterNewView />;
}
