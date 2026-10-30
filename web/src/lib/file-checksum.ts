/** SHA-256 ของไฟล์เป็น hex (ตรวจว่าไฟล์ที่เลือกตรงกับที่ระบบเก็บ) · คืน null ถ้า
 * เบราว์เซอร์คำนวณไม่ได้ (ไม่ใช่ HTTPS ฯลฯ) ไม่ throw */
export async function sha256Hex(file: Blob): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof file.arrayBuffer !== "function") return null;
    const digest = await subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
