"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-provider";
import { canSimulateFirmware } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import {
  simulateFirmware,
  type Firmware,
  type SimulationResult,
} from "@/lib/firmware-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/lib/status-pill";

/**
 * แผง "ทดสอบ Firmware" — FirmwareEngineer/QAEngineer/Operation/ST/OT (resource `firmware-simulation`
 * แยกจาก `firmware` — mirror `ConfigReviewPanel`) mock เช็คว่ารุ่นอุปกรณ์ที่
 * ระบุอยู่ใน compatibility tag ไหม · dry-run ล้วน ไม่แตะ `uploadStatus` ·
 * 409 ถ้า `uploadStatus` ยังไม่ `stored` (ยังไม่มีไฟล์จริงใน Object Storage
 * ให้ทดสอบ)
 */
export function FirmwareSimulatePanel({ firmware }: { firmware: Firmware }) {
  const { session } = useAuth();
  const [deviceModel, setDeviceModel] = useState(
    firmware.deviceModelCompatibility[0] ?? "",
  );
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canSimulateFirmware(session?.role)) return null;

  async function runSimulate() {
    if (!session?.accessToken || !deviceModel.trim()) return;
    setRunning(true);
    setError(null);
    setSim(null);
    try {
      setSim(
        await simulateFirmware(
          session.accessToken,
          firmware.id,
          deviceModel.trim(),
        ),
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "ทดสอบไม่สำเร็จ";
      setError(message);
      toast.error(message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
      <p className="text-sm font-medium">ทดสอบ Firmware</p>
      <p className="text-xs text-muted-foreground">
        ระบุรุ่นอุปกรณ์ที่จะทดสอบ (ลองรุ่นนอกรายการ compatibility เพื่อดูผลไม่ผ่านได้)
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={deviceModel}
          disabled={running}
          placeholder="เช่น GT06N"
          className="h-8 max-w-40"
          list="firmware-compatible-models"
          onChange={(e) => setDeviceModel(e.target.value)}
        />
        <datalist id="firmware-compatible-models">
          {firmware.deviceModelCompatibility.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <Button
          size="sm"
          variant="outline"
          disabled={running || !deviceModel.trim()}
          onClick={() => void runSimulate()}
        >
          {running ? "กำลังทดสอบ…" : "ทดสอบ"}
        </Button>
        {sim && (
          <StatusPill tone={sim.passed ? "success" : "danger"}>
            {sim.passed ? "ผ่าน" : "ไม่ผ่าน"}
          </StatusPill>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>

      {sim && sim.details.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {sim.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
