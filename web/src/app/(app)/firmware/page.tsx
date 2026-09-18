import { FirmwareTableCard } from "./firmware-table";

export const metadata = {
  title: "Firmware Repository | GPS Config Center",
};

/**
 * Firmware Repository — list Firmware จาก `GET /firmware` จริง + คลิกแถวไป
 * หน้ารายละเอียดเต็ม `/firmware/{id}` (แก้ Compatibility Tag + ทดสอบ) · ปุ่ม
 * "อัปโหลด Firmware" พาไปหน้า `/firmware/upload` — อัปโหลด/แก้ Compatibility
 * Tag ได้เฉพาะ Role FirmwareEngineer, ทดสอบได้
 * FirmwareEngineer/QAEngineer/Operation/ST/OT, อ่านได้ทุก Role
 */
export default async function FirmwarePage({
  searchParams,
}: {
  searchParams: Promise<{ uploaded?: string }>;
}) {
  const { uploaded } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Firmware Repository</h1>
        <p className="text-sm text-muted-foreground">
          อัปโหลด + Compatibility Tag · อัปโหลด/แก้ได้เฉพาะ Role FirmwareEngineer
        </p>
      </div>

      <FirmwareTableCard justUploadedId={uploaded ?? null} />
    </div>
  );
}
