import { ConfigWizardView } from "../config-wizard-view";

export const metadata = {
  title: "สร้าง Config ใหม่ | GPS Config Center",
};

/** สร้าง Config ใหม่ — wizard 2 ขั้น (ข้อมูลพื้นฐาน → เลือก Parameter)
 *  `?from=<id>` = โคลนจาก Config ที่มีอยู่ (prefill ทุกอย่างยกเว้นชื่อ)
 *  สร้างได้เฉพาะ Role SW (gate ทั้งหน้าใน `ConfigWizardView`) */
export default async function ConfigNewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  return <ConfigWizardView mode="create" cloneFromId={from} />;
}
