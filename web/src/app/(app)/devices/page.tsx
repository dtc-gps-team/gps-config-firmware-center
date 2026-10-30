import { DeviceSearchView } from "./device-search-view";

export const metadata = {
  title: "Device Search | GPS Config Center",
};

/** Device Search — ต่อ `GET /devices` จริง (Sprint 2 #11) · ทุก Role อ่านได้ ·
 *  `?connection=online|offline|unknown` ตั้งตัวกรองการเชื่อมต่อตั้งต้น (ลิงก์จาก Dashboard) */
export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { connection } = await searchParams;
  return (
    <DeviceSearchView
      initialConnection={typeof connection === "string" ? connection : undefined}
    />
  );
}
