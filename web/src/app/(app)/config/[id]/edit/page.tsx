import { ConfigWizardView } from "../../config-wizard-view";

export const metadata = {
  title: "แก้ไข Config | GPS Config Center",
};

/** แก้ไข Config สถานะ draft — wizard เดียวกับหน้าสร้าง แต่ล็อกรุ่น/โปรโตคอล
 *  แก้ได้เฉพาะ Role SW (gate ทั้งหน้าใน `ConfigWizardView`) */
export default async function ConfigEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConfigWizardView mode="edit" configId={id} />;
}
