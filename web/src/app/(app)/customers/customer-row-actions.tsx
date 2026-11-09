"use client";

import { useState } from "react";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormDialogHeader } from "@/components/form-dialog";
import { ApiError } from "@/lib/api";
import {
  deleteCustomer,
  updateCustomer,
  type ManagedCustomer,
} from "@/lib/customer-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CustomerForm } from "./customer-form";

/**
 * ปุ่มต่อแถวของหน้าจัดการลูกค้า — Admin/SuperAdmin เท่านั้นที่เห็นหน้านี้อยู่แล้ว (gate ที่
 * `customer-management-view.tsx`) · แก้ไข (Dialog) · ปิด/เปิดใช้งาน (เรียก PATCH ทันที สีตามสถานะ
 * เหมือนหน้า User Management) · ลบ (ลบจริง เฉพาะลูกค้าที่ไม่มีเครื่องผูก)
 *
 * ลูกค้าที่มีเครื่องผูกลบไม่ได้ — ไม่ต้องเดาล่วงหน้า ให้ backend ตอบ 409 พร้อมจำนวนเครื่องแล้วแสดงใน
 * กล่องยืนยัน และชี้ให้ใช้ "ปิดใช้งาน" แทน · ลูกค้าที่ปิดใช้งานยังผูกกับเครื่องเดิมได้ แต่เลือกให้เครื่องใหม่ไม่ได้
 */
export function CustomerRowActions({
  customer,
  onChanged,
}: {
  customer: ManagedCustomer;
  onChanged: () => void;
}) {
  const { session } = useAuth();
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function toggleActive() {
    if (!session?.accessToken) return;
    setPending(true);
    try {
      const updated = await updateCustomer(session.accessToken, customer.id, {
        isActive: !customer.isActive,
      });
      toast.success(
        updated.isActive
          ? `เปิดใช้งาน "${customer.companyName}" แล้ว`
          : `ปิดใช้งาน "${customer.companyName}" แล้ว เลือกให้เครื่องใหม่ไม่ได้ แต่เครื่องเดิมยังผูกอยู่ (ดูลูกค้าที่ปิดได้ที่ตัวกรองสถานะ)`,
      );
      onChanged();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "แก้สถานะไม่สำเร็จ";
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(): Promise<boolean> {
    if (!session?.accessToken) return false;
    setDeleteError(null);
    try {
      await deleteCustomer(session.accessToken, customer.id);
      toast.success(`ลบลูกค้า "${customer.companyName}" แล้ว`);
      onChanged();
      return true;
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : "ลบลูกค้าไม่สำเร็จ",
      );
      return false;
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => setEditing(true)}
      >
        <PencilIcon /> แก้ไข
      </Button>
      <Button
        size="sm"
        // ปิดใช้งาน = destructive, เปิดใช้งานกลับคืน = outline ปกติ (มติ UI เดิม ตามหน้า User Management)
        variant={customer.isActive ? "destructive" : "outline"}
        disabled={pending}
        title={
          customer.isActive
            ? "ปิดแล้วเลือกให้เครื่องใหม่ไม่ได้ แต่เครื่องเดิมยังผูกอยู่"
            : "เปิดให้เลือกให้เครื่องใหม่ได้อีกครั้ง"
        }
        onClick={() => void toggleActive()}
      >
        {customer.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        aria-label={`ลบ ${customer.companyName}`}
        onClick={() => {
          setDeleteError(null);
          setDeleting(true);
        }}
      >
        <Trash2Icon /> ลบ
      </Button>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="gap-0 p-0 pb-0 sm:max-w-xl sm:pb-0">
          <FormDialogHeader
            icon={PencilIcon}
            title={`แก้ข้อมูลลูกค้า ${customer.companyName}`}
            description="เครื่องที่ผูกกับลูกค้านี้จะตามชื่อใหม่เองถ้าเปลี่ยนชื่อบริษัท"
          />
          <CustomerForm
            customer={customer}
            onSaved={() => {
              setEditing(false);
              onChanged();
            }}
            onCancel={() => setEditing(false)}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`ลบลูกค้า ${customer.companyName}?`}
        description={
          <>
            ลบจริง กู้คืนไม่ได้ ทำได้เฉพาะลูกค้าที่ไม่มีเครื่องผูกอยู่ ถ้าลูกค้านี้เคยมีเครื่องแล้ว
            ให้ใช้ &quot;ปิดใช้งาน&quot; แทน
            {deleteError && (
              <span className="mt-2 block text-destructive">{deleteError}</span>
            )}
          </>
        }
        confirmLabel="ยืนยันลบ"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
