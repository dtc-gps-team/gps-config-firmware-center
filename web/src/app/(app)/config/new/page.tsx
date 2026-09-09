import { ConfigWizardView } from "../config-wizard-view";

export const metadata = {
  title: "สร้าง Config ใหม่ | GPS Config Center",
};

/** สร้าง Config ใหม่ — wizard 2 ขั้น (ข้อมูลพื้นฐาน → เลือก Parameter)
 *  สร้างได้เฉพาะ Role SW (gate ทั้งหน้าใน `ConfigWizardView`) */
export default function ConfigNewPage() {
  return <ConfigWizardView mode="create" />;
}
