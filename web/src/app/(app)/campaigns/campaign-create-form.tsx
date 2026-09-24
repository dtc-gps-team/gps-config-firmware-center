"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/data-table/data-table";
import { multiSelectFilterFn } from "@/components/data-table/filter-fns";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { createCampaign, type CampaignTargetInput } from "@/lib/campaign-api";
import type { Device } from "@/lib/device-api";
import { useDevices } from "@/hooks/use-devices";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { DetailSkeleton } from "@/components/skeleton/detail-skeleton";

/** ค่าที่ใช้แทน "ไม่ได้ผูกลูกค้า" ในตัวกรอง — mirror ข้อความเดียวกับคอลัมน์
 * "ลูกค้า" ในหน้า Device Search (docs/12 เฟส B) */
const UNASSIGNED_CUSTOMER = "ไม่ระบุ";

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-sm text-destructive">{message}</p>
    </div>
  );
}

/**
 * สร้างกลุ่มอุปกรณ์ใหม่ (`POST /campaigns`) — แก้ไข 2026-09-24 (Campaign
 * Monitor #22 — แยกกลุ่มออกจากรอบ push): เดิมหน้านี้เป็น wizard 4 ขั้น
 * (เลือกเป้าหมาย / เลือก Payload / Rollout / ตรวจสอบ&ยืนยัน) เพราะสร้าง
 * Campaign พร้อม payload+approval ในคำขอเดียว — ตอนนี้สร้างกลุ่มเปล่าๆ
 * เท่านั้น (แค่ชื่อ+สมาชิก) เหลือขั้นตอนเดียว เลือก Config/Firmware ทำทีหลัง
 * ผ่าน "Roll out ใหม่" ในหน้ารายละเอียดกลุ่มแทน (ดู
 * `campaign-rollout-create-form.tsx`)
 *
 * **MVP (มติ 2026-09-24):** สมาชิกกลุ่ม fix ตอนสร้างเท่านั้น ยังไม่มี
 * endpoint เพิ่ม/ลบทีหลัง
 */
export function CampaignCreateForm() {
  const router = useRouter();
  const { session } = useAuth();

  const devicesQuery = useDevices();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function clearErrors() {
    setNameError(null);
    setFormError(null);
  }

  const isDirty =
    name.trim() !== "" ||
    description.trim() !== "" ||
    selectedDeviceIds.length > 0;
  const { confirmLeave } = useUnsavedChangesWarning(isDirty);

  const installedDevices = useMemo(
    () => (devicesQuery.data ?? []).filter((d) => d.status === "installed"),
    [devicesQuery.data],
  );

  function toggleDevice(deviceId: string, checked: boolean) {
    setSelectedDeviceIds((prev) => {
      if (checked) {
        return prev.includes(deviceId) ? prev : [...prev, deviceId];
      }
      return prev.filter((id) => id !== deviceId);
    });
    clearErrors();
  }

  async function handleSubmit() {
    clearErrors();
    if (!session?.accessToken) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("ต้องตั้งชื่อกลุ่ม");
      return;
    }
    if (selectedDeviceIds.length === 0) {
      setFormError("เลือกอุปกรณ์เป้าหมายอย่างน้อย 1 เครื่อง");
      return;
    }

    const targetInputs: CampaignTargetInput[] = selectedDeviceIds.map(
      (deviceId) => ({ deviceId }),
    );

    setSubmitting(true);
    try {
      const trimmedDesc = description.trim();
      const created = await createCampaign(session.accessToken, {
        name: trimmedName,
        targets: targetInputs,
        ...(trimmedDesc ? { description: trimmedDesc } : {}),
      });
      toast.success(`สร้างกลุ่ม "${created.name}" แล้ว`);
      router.push(`/campaigns/${created.id}`);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        setFormError(err.message);
        toast.error(err.message);
        return;
      }
      setFormError("สร้างกลุ่มไม่สำเร็จ");
      toast.error("สร้างกลุ่มไม่สำเร็จ");
    }
  }

  /** คอลัมน์ตาราง picker — ใช้ `DataTable` กลาง (ค้นหารวม + ฟิลเตอร์ต่อคอลัมน์
   * + เรียงลำดับ) mirror `device-search-view.tsx` + คอลัมน์ checkbox เพิ่ม
   * ด้านหน้าสำหรับเลือกเป้าหมาย — checkbox หยุด propagation กันชนกับคลิก
   * ทั้งแถว (`onRowClick` ด้านล่างก็ toggle เหมือนกัน ให้คลิกตรงไหนของแถวก็ได้) */
  const columns: ColumnDef<Device>[] = useMemo(
    () => [
      {
        id: "select",
        header: "",
        enableSorting: false,
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const checked = selectedDeviceIds.includes(row.original.deviceId);
          return (
            <span onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={checked}
                onCheckedChange={(c) =>
                  toggleDevice(row.original.deviceId, c === true)
                }
                aria-label={
                  checked ? "ยกเลิกเลือกอุปกรณ์นี้" : "เลือกอุปกรณ์นี้"
                }
                className="size-5"
              />
            </span>
          );
        },
      },
      {
        accessorKey: "deviceId",
        header: "เลขเครื่อง",
        meta: { filterVariant: "text", label: "เลขเครื่อง" },
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.deviceId}</span>
        ),
      },
      {
        accessorKey: "deviceModel",
        header: "รุ่นอุปกรณ์",
        filterFn: multiSelectFilterFn,
        meta: { filterVariant: "multi-select", label: "รุ่น" },
      },
      {
        accessorKey: "protocol",
        header: "โปรโตคอล",
        filterFn: multiSelectFilterFn,
        meta: { filterVariant: "multi-select", label: "โปรโตคอล" },
      },
      {
        id: "customer",
        accessorFn: (row) => row.customer?.companyName ?? UNASSIGNED_CUSTOMER,
        header: "ลูกค้า",
        filterFn: multiSelectFilterFn,
        meta: { filterVariant: "multi-select", label: "ลูกค้า" },
        cell: ({ row }) =>
          row.original.customer ? (
            row.original.customer.companyName
          ) : (
            <span className="italic text-muted-foreground">
              {UNASSIGNED_CUSTOMER}
            </span>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toggleDevice closes over selectedDeviceIds เท่านั้น รวมไว้ใน deps เดียวพอ
    [selectedDeviceIds],
  );

  if (devicesQuery.isLoading && !devicesQuery.data) {
    return <DetailSkeleton lines={6} />;
  }

  if (devicesQuery.error) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <p className="text-sm text-destructive">{devicesQuery.error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void devicesQuery.refetch()}
        >
          ลองใหม่
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-name">ชื่อกลุ่ม</Label>
          <Input
            id="campaign-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearErrors();
            }}
            maxLength={120}
            placeholder="เช่น อุปกรณ์ภาคกลาง Q3"
            aria-invalid={nameError ? true : undefined}
          />
          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-description">
            คำอธิบาย{" "}
            <span className="font-normal text-muted-foreground">
              (ไม่บังคับ)
            </span>
          </Label>
          <textarea
            id="campaign-description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              clearErrors();
            }}
            maxLength={500}
            rows={2}
            placeholder="อธิบายวัตถุประสงค์ของกลุ่มนี้…"
            className="min-h-16 resize-y rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div>
          <p className="text-sm font-medium">เลือกอุปกรณ์สมาชิก</p>
          <p className="text-xs text-muted-foreground">
            ติ๊กช่องซ้ายมือหรือคลิกที่แถวเพื่อเลือก/ยกเลิก · เฉพาะอุปกรณ์
            สถานะ installed เท่านั้น · เลือกแล้ว {selectedDeviceIds.length}{" "}
            เครื่อง
          </p>
        </div>

        {installedDevices.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            ไม่พบอุปกรณ์ที่ installed
          </p>
        ) : (
          <DataTable
            columns={columns}
            data={installedDevices}
            searchPlaceholder="ค้นหาเลขเครื่อง/รุ่น…"
            emptyMessage="ไม่พบอุปกรณ์ที่ตรงกับเงื่อนไข"
            onRowClick={(device) =>
              toggleDevice(
                device.deviceId,
                !selectedDeviceIds.includes(device.deviceId),
              )
            }
          />
        )}
      </div>

      {formError && <ErrorBanner message={formError} />}

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button
          variant="outline"
          disabled={submitting}
          onClick={() => {
            if (confirmLeave()) router.push("/campaigns");
          }}
        >
          ยกเลิก
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting ? "กำลังสร้างกลุ่ม…" : "สร้างกลุ่ม"}
        </Button>
      </div>
    </div>
  );
}
