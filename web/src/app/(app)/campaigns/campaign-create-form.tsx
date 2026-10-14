"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/data-table/data-table";
import { multiSelectFilterFn } from "@/components/data-table/filter-fns";
import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import { createCampaign, type CampaignTargetInput } from "@/lib/campaign-api";
import { FIELD_REPORT_SOURCE, type Incident } from "@/lib/incident-api";
import type { Device } from "@/lib/device-api";
import { useDevices } from "@/hooks/use-devices";
import { useIncident } from "@/hooks/use-incident";
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
 *
 * **มาจาก "ส่งต่อเป็น Campaign" (issue #284):** `sourceIncidentId` มาจาก query
 * หน้า Incident หลัง Operation ตัดสินใจ promote Field Report ดึง Incident
 * มาตั้งชื่อเริ่มต้นและเลือกอุปกรณ์ที่รายงานให้ (เฉพาะที่ installed เพราะ
 * backend ปฏิเสธเครื่องที่ยังไม่ติดตั้ง) แล้วส่ง `sourceIncidentId` ไปกับคำขอ
 * ให้ backend ผูกกลุ่มกับรายงานนี้ · ค่าเริ่มต้นเหล่านี้คำนวณตอน render
 * (`ค่าที่ผู้ใช้แก้ ?? ค่าเริ่มต้น`) แก้ได้อิสระ ไม่เขียน state ใน effect
 */
export function CampaignCreateForm({
  sourceIncidentId,
}: {
  sourceIncidentId?: string;
}) {
  const router = useRouter();
  const { session } = useAuth();

  const devicesQuery = useDevices();
  const sourceQuery = useIncident(sourceIncidentId ?? null);
  const sourceIncident = sourceQuery.data;
  // ผูกได้เมื่อเป็น Field Report ที่ถูก promote มาแล้วเท่านั้น (backend ตรวจ
  // สถานะ investigating ซ้ำอีกชั้น) ไม่งั้นไม่ส่ง sourceIncidentId ไปเลย
  const linkableSource =
    sourceIncident &&
    sourceIncident.source === FIELD_REPORT_SOURCE &&
    sourceIncident.status === "investigating"
      ? sourceIncident
      : null;

  const [nameInput, setNameInput] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [selectedInput, setSelectedInput] = useState<string[] | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function clearErrors() {
    setNameError(null);
    setFormError(null);
  }

  const installedDevices = useMemo(
    () => (devicesQuery.data ?? []).filter((d) => d.status === "installed"),
    [devicesQuery.data],
  );

  const defaultName = linkableSource
    ? `แก้ไขปัญหา: ${linkableSource.title}`
    : "";
  const reportedDeviceId = linkableSource?.deviceId ?? null;
  const reportedDeviceInstalled =
    reportedDeviceId !== null &&
    installedDevices.some((d) => d.deviceId === reportedDeviceId);
  const defaultSelected = useMemo(
    () =>
      reportedDeviceInstalled && reportedDeviceId ? [reportedDeviceId] : [],
    [reportedDeviceInstalled, reportedDeviceId],
  );
  const name = nameInput ?? defaultName;
  const selectedDeviceIds = selectedInput ?? defaultSelected;

  const isDirty =
    name.trim() !== "" ||
    description.trim() !== "" ||
    selectedDeviceIds.length > 0;
  const { confirmLeave } = useUnsavedChangesWarning(isDirty);

  function toggleDevice(deviceId: string, checked: boolean) {
    setSelectedInput((prev) => {
      const base = prev ?? defaultSelected;
      if (checked) {
        return base.includes(deviceId) ? base : [...base, deviceId];
      }
      return base.filter((id) => id !== deviceId);
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
        ...(linkableSource ? { sourceIncidentId: linkableSource.id } : {}),
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
        header: "โมเดล",
        filterFn: multiSelectFilterFn,
        meta: { filterVariant: "multi-select", label: "โมเดล" },
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
      {sourceIncidentId && (
        <SourceIncidentNotice
          isLoading={sourceQuery.isLoading}
          error={sourceQuery.error}
          incident={sourceIncident}
          linkable={linkableSource !== null}
          deviceId={reportedDeviceId}
          deviceInstalled={reportedDeviceInstalled}
        />
      )}

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-name">ชื่อกลุ่ม</Label>
          <Input
            id="campaign-name"
            value={name}
            onChange={(e) => {
              setNameInput(e.target.value);
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
      </Card>

      <Card className="gap-3 p-5">
        <div>
          <p className="text-sm font-medium">เลือกอุปกรณ์สมาชิก</p>
          <p className="text-xs text-muted-foreground">
            ติ๊กช่องซ้ายมือหรือคลิกที่แถวเพื่อเลือก/ยกเลิก เฉพาะอุปกรณ์สถานะ
            installed เท่านั้น (เลือกแล้ว {selectedDeviceIds.length} เครื่อง)
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
            searchPlaceholder="ค้นหาเลขเครื่อง/โมเดล…"
            emptyMessage="ไม่พบอุปกรณ์ที่ตรงกับเงื่อนไข"
            onRowClick={(device) =>
              toggleDevice(
                device.deviceId,
                !selectedDeviceIds.includes(device.deviceId),
              )
            }
          />
        )}
      </Card>

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

/**
 * แถบแจ้งที่มาเมื่อสร้างกลุ่มจาก "ส่งต่อเป็น Campaign" บอกว่ากลุ่มนี้จะผูกกับ
 * รายงานปัญหาไหน หรือเหตุผลที่ผูกไม่ได้ (โหลดไม่สำเร็จ หรือสถานะไม่ใช่ที่ส่งต่อ
 * แล้ว) และอุปกรณ์ที่รายงานถูกเลือกให้หรือไม่
 */
function SourceIncidentNotice({
  isLoading,
  error,
  incident,
  linkable,
  deviceId,
  deviceInstalled,
}: {
  isLoading: boolean;
  error: string | null;
  incident: Incident | null;
  linkable: boolean;
  deviceId: string | null;
  deviceInstalled: boolean;
}) {
  const info =
    "rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200";
  const warn =
    "rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";

  if (isLoading) {
    return <div className={info}>กำลังโหลดรายงานปัญหาที่ส่งต่อมา…</div>;
  }
  if (error || !incident) {
    return (
      <div className={warn}>
        {error ?? "ไม่พบรายงานปัญหา"} กลุ่มนี้จะไม่ถูกผูกกับรายงานปัญหา
        สร้างกลุ่มต่อได้ตามปกติ
      </div>
    );
  }
  if (!linkable) {
    return (
      <div className={warn}>
        รายงานปัญหา &ldquo;{incident.title}&rdquo;
        ไม่ได้อยู่ในสถานะที่ส่งต่อเป็น Campaign ได้แล้ว
        กลุ่มนี้จะไม่ถูกผูกกับรายงานนี้
      </div>
    );
  }
  return (
    <div className={info}>
      <p>
        สร้างจากรายงานปัญหา &ldquo;{incident.title}&rdquo; กลุ่มนี้จะถูกผูกกับ
        รายงานนี้เมื่อสร้าง
      </p>
      {deviceId && deviceInstalled && (
        <p className="mt-1 text-xs">
          เลือกอุปกรณ์ที่รายงานไว้ให้แล้ว ({deviceId}) เพิ่มเครื่องอื่นได้ตาม
          ดุลยพินิจ
        </p>
      )}
      {deviceId && !deviceInstalled && (
        <p className="mt-1 text-xs">
          อุปกรณ์ที่รายงาน ({deviceId}) ยังไม่ติดตั้ง จึงเลือกให้ไม่ได้
          เลือกอุปกรณ์เองจากรายการด้านล่าง
        </p>
      )}
    </div>
  );
}
