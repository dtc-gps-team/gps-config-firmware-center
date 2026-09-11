"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api";
import {
  decideConfig,
  simulateConfig,
  type Config,
  type SimulationResult,
} from "@/lib/config-api";
import { listUsers, type UserSummary } from "@/lib/users-api";
import { Button } from "@/components/ui/button";
import { pillClass } from "@/lib/status-pill";

/**
 * แผง "ทดสอบ & ส่งอนุมัติ" ฝั่ง SW (Config Simulation Gate — #18) — โผล่บนหน้า
 * รายละเอียด Config เฉพาะสถานะ `draft` + role SW
 *
 * 2 step ตามดีไซน์ (ดู ConfigService.decide): (1) "ทดสอบ" = `POST /simulate`
 * dry-run กดกี่ครั้งก็ได้ ไม่แตะ status · (2) "ส่งให้อนุมัติ" = `POST /decide`
 * `passed:true` → `draft`→`testing` (ดุลพินิจ SW — ส่งได้แม้ sim มี warning) +
 * เจาะจงผู้อนุมัติ (optional, dropdown Operation — #19)
 */
export function ConfigReviewPanel({ config }: { config: Config }) {
  const { session } = useAuth();
  const router = useRouter();

  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState(false);
  const [operators, setOperators] = useState<UserSummary[]>([]);
  const [approverId, setApproverId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || !session?.accessToken || operators.length > 0) return;
    listUsers(session.accessToken, { role: "Operation" })
      .then(setOperators)
      .catch(() => setOperators([]));
  }, [expanded, session?.accessToken, operators.length]);

  async function runSimulate() {
    if (!session?.accessToken) return;
    setSimRunning(true);
    setSimError(null);
    setSim(null);
    try {
      setSim(await simulateConfig(session.accessToken, config.id));
    } catch (err) {
      setSimError(err instanceof ApiError ? err.message : "ทดสอบไม่สำเร็จ");
    } finally {
      setSimRunning(false);
    }
  }

  async function submit() {
    if (!session?.accessToken) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await decideConfig(session.accessToken, config.id, {
        passed: true,
        ...(approverId ? { suggestedApproverId: approverId } : {}),
      });
      router.push(`/config?saved=${encodeURIComponent(config.id)}`);
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      setSubmitError(
        err instanceof ApiError ? err.message : "ส่งอนุมัติไม่สำเร็จ",
      );
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
      <p className="text-sm font-medium">ทดสอบ &amp; ส่งอนุมัติ</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={simRunning}
          onClick={() => void runSimulate()}
        >
          {simRunning ? "กำลังทดสอบ…" : "ทดสอบ Config"}
        </Button>
        {sim && (
          <span className={pillClass(sim.passed ? "success" : "danger")}>
            {sim.passed ? "ผ่าน" : "ไม่ผ่าน"}
          </span>
        )}
        {simError && (
          <span className="text-xs text-destructive">{simError}</span>
        )}
      </div>

      {sim && sim.details.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {sim.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}

      {!expanded ? (
        <Button
          size="sm"
          className="w-fit"
          onClick={() => setExpanded(true)}
        >
          ส่งให้ Operation อนุมัติ
        </Button>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              เจาะจงผู้อนุมัติ (ไม่บังคับ — Operation คนอื่นก็อนุมัติได้)
            </span>
            <select
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
              className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
            >
              <option value="">ไม่เจาะจง</option>
              {operators.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
          </label>
          {submitError && (
            <p className="text-xs text-destructive">{submitError}</p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={submitting}
              onClick={() => void submit()}
            >
              {submitting ? "กำลังส่ง…" : "ยืนยันส่งอนุมัติ"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() => setExpanded(false)}
            >
              ยกเลิก
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
