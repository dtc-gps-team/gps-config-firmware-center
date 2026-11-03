"use client";

import { useMemo, useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth/auth-provider";
import { DisabledWithReason } from "@/components/disabled-with-reason";
import { useDevices } from "@/hooks/use-devices";
import { ApiError } from "@/lib/api";
import {
  addCampaignTargets,
  deleteCampaign,
  removeCampaignTarget,
  updateCampaign,
  type Campaign,
} from "@/lib/campaign-api";

/** เหตุผลที่ใช้ซ้ำทุกปุ่มที่แก้สมาชิก/ลบกลุ่มไม่ได้ขณะมี Rollout ค้าง */
export const OPEN_ROLLOUT_REASON =
  "กลุ่มนี้มี Rollout ที่ยังไม่จบ ต้องรอให้จบหรือปฏิเสธก่อน";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/** แก้ชื่อ/คำอธิบายกลุ่ม (ทำได้ทุกเมื่อ แม้มี Rollout ค้าง) */
export function EditCampaignButton({
  campaign,
  onUpdated,
}: {
  campaign: Campaign;
  onUpdated: () => void;
}) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [description, setDescription] = useState(campaign.description ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed =
    name.trim() !== campaign.name ||
    description.trim() !== (campaign.description ?? "");

  async function submit() {
    if (!session) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateCampaign(session.accessToken, campaign.id, {
        name: name.trim(),
        description: description.trim(),
      });
      toast.success("บันทึกการแก้ไขแล้ว");
      setOpen(false);
      onUpdated();
    } catch (err) {
      setError(errorMessage(err, "บันทึกไม่สำเร็จ"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(campaign.name);
          setDescription(campaign.description ?? "");
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <PencilIcon /> แก้ไขกลุ่ม
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>แก้ไขกลุ่ม</DialogTitle>
          <DialogDescription>
            แก้ชื่อและคำอธิบายได้ทุกเมื่อ ไม่กระทบ Rollout ที่มีอยู่
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-edit-name">ชื่อกลุ่ม</Label>
            <Input
              id="campaign-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-edit-description">คำอธิบาย</Label>
            <Input
              id="campaign-edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => setOpen(false)}
          >
            ยกเลิก
          </Button>
          <Button
            disabled={submitting || name.trim() === "" || !changed}
            onClick={() => void submit()}
          >
            {submitting ? "กำลังบันทึก…" : "บันทึก"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ลบกลุ่ม (ลบจริงพร้อมสมาชิกและประวัติ Rollout) · ปิดปุ่มพร้อมเหตุผลเมื่อมี
 * Rollout ค้าง */
export function DeleteCampaignButton({
  campaign,
  disabledReason,
  onDeleted,
}: {
  campaign: Campaign;
  disabledReason: string | null;
  onDeleted: () => void;
}) {
  const { session } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!session) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteCampaign(session.accessToken, campaign.id);
      toast.success(`ลบกลุ่ม ${campaign.name} แล้ว`);
      setConfirming(false);
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, "ลบกลุ่มไม่สำเร็จ"));
    } finally {
      setDeleting(false);
    }
  }

  const trigger = (
    <Button
      variant="destructive"
      disabled={disabledReason !== null}
      onClick={() => {
        setError(null);
        setConfirming(true);
      }}
    >
      <Trash2Icon /> ลบกลุ่ม
    </Button>
  );

  return (
    <>
      {disabledReason ? (
        <DisabledWithReason reason={disabledReason}>{trigger}</DisabledWithReason>
      ) : (
        trigger
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบกลุ่ม {campaign.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              สมาชิกและประวัติ Rollout ของกลุ่มนี้จะถูกลบถาวร ไม่กระทบอุปกรณ์
              เพราะค่าที่ส่งไปแล้วอยู่บนกล่องเอง แต่จะย้อนกลับ (Rollback)
              รอบเก่าของกลุ่มนี้ไม่ได้อีก
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? "กำลังลบ…" : "ยืนยันลบกลุ่ม"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** เพิ่มเครื่อง (installed ที่ยังไม่อยู่ในกลุ่ม) เข้ากลุ่ม */
export function AddMembersButton({
  campaignId,
  memberDeviceIds,
  disabledReason,
  onAdded,
}: {
  campaignId: string;
  memberDeviceIds: string[];
  disabledReason: string | null;
  onAdded: () => void;
}) {
  const { session } = useAuth();
  const devicesQuery = useDevices();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => {
    const members = new Set(memberDeviceIds);
    const keyword = search.trim().toLowerCase();
    return (devicesQuery.data ?? []).filter(
      (d) =>
        d.status === "installed" &&
        !members.has(d.deviceId) &&
        (keyword === "" ||
          d.deviceId.toLowerCase().includes(keyword) ||
          d.deviceModel.toLowerCase().includes(keyword)),
    );
  }, [devicesQuery.data, memberDeviceIds, search]);

  function reset() {
    setSearch("");
    setSelected([]);
    setError(null);
  }

  async function submit() {
    if (!session) return;
    setSubmitting(true);
    setError(null);
    try {
      await addCampaignTargets(
        session.accessToken,
        campaignId,
        selected.map((deviceId) => ({ deviceId })),
      );
      toast.success(`เพิ่ม ${selected.length} เครื่องเข้ากลุ่มแล้ว`);
      setOpen(false);
      reset();
      onAdded();
    } catch (err) {
      setError(errorMessage(err, "เพิ่มเครื่องไม่สำเร็จ"));
    } finally {
      setSubmitting(false);
    }
  }

  if (disabledReason) {
    return (
      <DisabledWithReason reason={disabledReason}>
        <Button variant="outline" size="sm" disabled>
          <PlusIcon /> เพิ่มเครื่อง
        </Button>
      </DisabledWithReason>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon /> เพิ่มเครื่อง
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>เพิ่มเครื่องเข้ากลุ่ม</DialogTitle>
          <DialogDescription>
            เลือกได้เฉพาะเครื่องที่ติดตั้งแล้ว (installed) และยังไม่อยู่ในกลุ่มนี้
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาเลขเครื่องหรือรุ่น"
          aria-label="ค้นหาเครื่อง"
        />
        <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
          {devicesQuery.isLoading && !devicesQuery.data ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              กำลังโหลดรายการเครื่อง…
            </li>
          ) : candidates.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              ไม่พบเครื่องที่เพิ่มได้
            </li>
          ) : (
            candidates.map((d) => {
              const checked = selected.includes(d.deviceId);
              return (
                <li key={d.deviceId}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) =>
                        setSelected((prev) =>
                          c === true
                            ? [...prev, d.deviceId]
                            : prev.filter((id) => id !== d.deviceId),
                        )
                      }
                    />
                    <span className="font-instrument text-xs">
                      {d.deviceId}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {d.deviceModel}
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => setOpen(false)}
          >
            ยกเลิก
          </Button>
          <Button
            disabled={submitting || selected.length === 0}
            onClick={() => void submit()}
          >
            {submitting ? "กำลังเพิ่ม…" : `เพิ่ม ${selected.length} เครื่อง`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** เอาเครื่องหนึ่งออกจากกลุ่ม · ปิดปุ่มพร้อมเหตุผลเมื่อมี Rollout ค้างหรือเป็น
 * เครื่องสุดท้าย */
export function RemoveMemberButton({
  campaignId,
  deviceId,
  disabledReason,
  onRemoved,
}: {
  campaignId: string;
  deviceId: string;
  disabledReason: string | null;
  onRemoved: () => void;
}) {
  const { session } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmRemove() {
    if (!session) return;
    setRemoving(true);
    setError(null);
    try {
      await removeCampaignTarget(session.accessToken, campaignId, deviceId);
      toast.success(`เอา ${deviceId} ออกจากกลุ่มแล้ว`);
      setConfirming(false);
      onRemoved();
    } catch (err) {
      setError(errorMessage(err, "เอาเครื่องออกไม่สำเร็จ"));
    } finally {
      setRemoving(false);
    }
  }

  const trigger = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`เอา ${deviceId} ออกจากกลุ่ม`}
      disabled={disabledReason !== null}
      onClick={() => {
        setError(null);
        setConfirming(true);
      }}
    >
      <XIcon />
    </Button>
  );

  return (
    <>
      {disabledReason ? (
        <DisabledWithReason reason={disabledReason}>{trigger}</DisabledWithReason>
      ) : (
        trigger
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>เอา {deviceId} ออกจากกลุ่ม?</AlertDialogTitle>
            <AlertDialogDescription>
              เครื่องจะไม่ถูกรวมในการ Roll out รอบถัดไป ไม่กระทบค่าที่อยู่บนกล่อง
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removing}
              onClick={(e) => {
                e.preventDefault();
                void confirmRemove();
              }}
            >
              {removing ? "กำลังเอาออก…" : "ยืนยันเอาออก"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
