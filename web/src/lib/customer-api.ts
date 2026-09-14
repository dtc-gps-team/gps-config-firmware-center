import { apiJson } from "@/lib/api";

/**
 * Customer API client — ตรงกับ `docs/api/openapi.yaml` tag `customer`
 * (`listCustomers` / schema `CustomerSummary`) — docs/12_CustomerScope_Proposal.md
 * เฟส B (PR #127/#153) · **ไม่ใช่** หน้า "จัดการลูกค้า" (Admin CRUD) — ตัดสินใจ
 * ร่วมกันแล้วว่าเกินขอบเขตตอนนี้ ลูกค้าเพิ่ม/แก้ได้ผ่าน backend seed เท่านั้น
 */

/** id + ชื่อบริษัทเท่านั้น (ไม่มี contactName/email/phone/priorityTier) —
 * ทุก role ที่ login แล้วเรียกได้ จึงตัดข้อมูลติดต่อที่ละเอียดกว่านี้ออก */
export type CustomerSummary = {
  id: string;
  companyName: string;
};

/** `GET /customers` — เรียงตามชื่อบริษัท · ใช้ทำ dropdown filter "ลูกค้า"
 * บนหน้า Device Search */
export function listCustomers(token: string): Promise<CustomerSummary[]> {
  return apiJson<CustomerSummary[]>("/customers", { token });
}
