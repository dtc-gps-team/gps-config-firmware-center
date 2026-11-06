import { CustomerManagementView } from "./customer-management-view";

export const metadata = {
  title: "Customer Management | GPS Config Center",
};

/**
 * Customer Management (`GET /customers/managed`, `POST /customers`, `PATCH /customers/{id}`,
 * `DELETE /customers/{id}`) — Admin/SuperAdmin เท่านั้น gate ทั้งหน้าผ่าน CustomerManagementView
 * (ดูไฟล์นั้น) · "เพิ่มลูกค้า" เป็น Dialog ในตัว ไม่มี route `/customers/new` แยก
 */
export default function CustomersPage() {
  return <CustomerManagementView />;
}
