"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { canManageCustomers } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import {
  createCustomer,
  updateCustomer,
  type ManagedCustomer,
} from "@/lib/customer-api";
import { FormBody, FormFooter, FormSection } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * ฟอร์มเพิ่ม/แก้ลูกค้า (Admin/SuperAdmin) — ใช้ทั้งที่หน้าจัดการลูกค้าและปุ่ม "เพิ่มลูกค้าใหม่" ในฟอร์ม
 * ลงทะเบียนอุปกรณ์ (มติ A 2026-11-05) · ไม่ส่ง `customer` = เพิ่มใหม่ (`POST /customers`) ส่ง
 * `customer` = แก้ (`PATCH /customers/{id}`) ช่องที่ไม่บังคับเว้นว่าง = ล้างค่า
 *
 * เรียก `onSaved` แทน navigate ให้ parent ปิด dialog + refetch เอง · gate นี้เป็น UX-level เท่านั้น
 * — backend PermissionGuard บังคับสิทธิ์จริงเสมอ
 */
export function CustomerForm({
  customer,
  onSaved,
  onCancel,
}: {
  customer?: ManagedCustomer;
  onSaved: (saved: ManagedCustomer) => void;
  onCancel?: () => void;
}) {
  const { session } = useAuth();
  const editing = customer !== undefined;

  const [companyName, setCompanyName] = useState(customer?.companyName ?? "");
  const [contactName, setContactName] = useState(customer?.contactName ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [priorityTier, setPriorityTier] = useState(customer?.priorityTier ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!canManageCustomers(session?.role)) {
    return (
      <p className="px-6 py-5 text-sm text-muted-foreground">
        เฉพาะ Role Admin/SuperAdmin เท่านั้นที่จัดการลูกค้าได้
      </p>
    );
  }

  async function onSubmit() {
    if (!session?.accessToken) return;
    const name = companyName.trim();
    if (!name) {
      setFormError("ต้องระบุชื่อบริษัท");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const saved = editing
        ? await updateCustomer(session.accessToken, customer.id, {
            companyName: name,
            contactName: contactName.trim() || null,
            email: email.trim() || null,
            phone: phone.trim() || null,
            priorityTier: priorityTier.trim() || null,
          })
        : await createCustomer(session.accessToken, {
            companyName: name,
            contactName: contactName.trim() || undefined,
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
            priorityTier: priorityTier.trim() || undefined,
          });
      toast.success(
        editing
          ? `แก้ข้อมูลลูกค้า "${saved.companyName}" แล้ว`
          : `เพิ่มลูกค้า "${saved.companyName}" แล้ว`,
      );
      onSaved(saved);
    } catch (err) {
      setSubmitting(false);
      const message =
        err instanceof ApiError
          ? err.message
          : editing
            ? "แก้ข้อมูลลูกค้าไม่สำเร็จ"
            : "เพิ่มลูกค้าไม่สำเร็จ";
      setFormError(message);
      toast.error(message);
    }
  }

  const canSubmit = companyName.trim() !== "" && !submitting;

  return (
    <div className="flex flex-col">
      <FormBody>
        <FormSection title="ข้อมูลหลัก">
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="customer-company"
              className="after:ml-0.5 after:text-destructive after:content-['*']"
            >
              ชื่อบริษัท
            </Label>
            <Input
              id="customer-company"
              value={companyName}
              disabled={submitting}
              maxLength={200}
              onChange={(e) => setCompanyName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              ห้ามซ้ำกับลูกค้าคนอื่น (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
            </p>
          </div>
        </FormSection>

        <FormSection title="ข้อมูลติดต่อ">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="customer-contact">
                ผู้ติดต่อ{" "}
                <span className="font-normal text-muted-foreground">
                  (ไม่บังคับ)
                </span>
              </Label>
              <Input
                id="customer-contact"
                value={contactName}
                disabled={submitting}
                maxLength={200}
                onChange={(e) => setContactName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="customer-phone">
                เบอร์โทร{" "}
                <span className="font-normal text-muted-foreground">
                  (ไม่บังคับ)
                </span>
              </Label>
              <Input
                id="customer-phone"
                value={phone}
                disabled={submitting}
                maxLength={50}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="customer-email">
                อีเมล{" "}
                <span className="font-normal text-muted-foreground">
                  (ไม่บังคับ)
                </span>
              </Label>
              <Input
                id="customer-email"
                type="email"
                value={email}
                disabled={submitting}
                maxLength={200}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="customer-tier">
                ระดับความสำคัญ{" "}
                <span className="font-normal text-muted-foreground">
                  (ไม่บังคับ)
                </span>
              </Label>
              <Input
                id="customer-tier"
                value={priorityTier}
                disabled={submitting}
                maxLength={50}
                onChange={(e) => setPriorityTier(e.target.value)}
              />
            </div>
          </div>
        </FormSection>

        {formError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {formError}
          </div>
        )}
      </FormBody>

      <FormFooter onCancel={onCancel} submitting={submitting}>
        <Button disabled={!canSubmit} onClick={() => void onSubmit()}>
          {submitting ? "กำลังบันทึก…" : editing ? "บันทึก" : "เพิ่มลูกค้า"}
        </Button>
      </FormFooter>
    </div>
  );
}
