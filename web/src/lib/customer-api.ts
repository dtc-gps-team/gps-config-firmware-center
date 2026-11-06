import { apiJson } from "@/lib/api";

/**
 * Customer API client — ตรงกับ `docs/api/openapi.yaml` tag `customer`
 * (`listCustomers` / `listManagedCustomers` / `createCustomer` / `updateCustomer` /
 * `deleteCustomer`) — docs/12_CustomerScope_Proposal.md เฟส B (PR #127/#153) และ
 * มติ A 2026-11-05 จัดการลูกค้า (PR #443)
 */

/** id + ชื่อบริษัทเท่านั้น (ไม่มีข้อมูลติดต่อ) — ที่ฝังมากับ `Device.customer` */
export type CustomerSummary = {
  id: string;
  companyName: string;
};

/** รายการใน `GET /customers` — แบบย่อ + สถานะ · ทุก role ที่ login แล้วเรียกได้ จึงตัดข้อมูล
 * ติดต่อที่ละเอียดกว่านี้ออก */
export type CustomerListItem = CustomerSummary & { isActive: boolean };

/** ข้อมูลเต็มของหน้าจัดการลูกค้า (Admin/SuperAdmin) + จำนวนเครื่องที่ผูกอยู่ */
export type ManagedCustomer = CustomerListItem & {
  contactName: string | null;
  email: string | null;
  phone: string | null;
  priorityTier: string | null;
  /** เครื่องที่ผูกกับลูกค้านี้ทั้งหมด (รวมที่ปลดระวางแล้ว) — ลบได้เมื่อเป็น 0 เท่านั้น */
  deviceCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateCustomerInput = {
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  priorityTier?: string;
};

/** ช่องที่ไม่บังคับส่ง `null` เพื่อล้างค่า · `isActive` ปิด/เปิดใช้งาน */
export type UpdateCustomerInput = {
  companyName?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  priorityTier?: string | null;
  isActive?: boolean;
};

/** `GET /customers` — เรียงตามชื่อบริษัท · `activeOnly` ตัดลูกค้าที่ปิดใช้งานออก (dropdown
 * ลงทะเบียนอุปกรณ์) · ไม่ส่ง = ทุกคน (dropdown filter หน้า Device Search ต้องเห็นลูกค้าของเครื่องเดิม) */
export function listCustomers(
  token: string,
  params?: { activeOnly?: boolean },
): Promise<CustomerListItem[]> {
  const query = params?.activeOnly ? "?activeOnly=true" : "";
  return apiJson<CustomerListItem[]>(`/customers${query}`, { token });
}

/** `GET /customers/managed` — ข้อมูลเต็ม + จำนวนเครื่องที่ผูก (Admin/SuperAdmin) */
export function listManagedCustomers(token: string): Promise<ManagedCustomer[]> {
  return apiJson<ManagedCustomer[]>("/customers/managed", { token });
}

/** `POST /customers` — ชื่อบริษัทห้ามซ้ำแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ (409) */
export function createCustomer(
  token: string,
  body: CreateCustomerInput,
): Promise<ManagedCustomer> {
  return apiJson<ManagedCustomer>("/customers", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
}

/** `PATCH /customers/{id}` — แก้เฉพาะ field ที่ส่ง */
export function updateCustomer(
  token: string,
  id: string,
  body: UpdateCustomerInput,
): Promise<ManagedCustomer> {
  return apiJson<ManagedCustomer>(`/customers/${id}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(body),
  });
}

/** `DELETE /customers/{id}` — ลบจริง เฉพาะลูกค้าที่ไม่มีเครื่องผูก (409 พร้อมจำนวนเครื่อง) */
export function deleteCustomer(token: string, id: string): Promise<void> {
  return apiJson<void>(`/customers/${id}`, { method: "DELETE", token });
}
