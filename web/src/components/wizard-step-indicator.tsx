import { CheckIcon } from "lucide-react";

export type WizardStep = { n: number; label: string };

/**
 * Step indicator ใช้ร่วมกันทุก wizard หลายขั้นตอนในระบบ (Config Wizard,
 * Campaign Wizard) — เดิม implement ซ้ำแยกกัน 2 ที่เหมือนกันเป๊ะทุก class
 * ต่างแค่จำนวน/label ของ step แยกมาไว้ที่นี่ให้แก้สไตล์ทีเดียวใช้ได้ทุกที่
 */
export function WizardStepIndicator({
  steps,
  step,
}: {
  steps: readonly WizardStep[];
  step: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((s, i) => {
        const done = step > s.n;
        const active = step === s.n;
        return (
          <div key={s.n} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-8 bg-border" />}
            <span
              className={
                "flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-xs font-medium " +
                (active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground")
              }
            >
              <span
                className={
                  "flex size-5 items-center justify-center rounded-full text-[0.65rem] " +
                  (active
                    ? "bg-primary-foreground text-primary"
                    : "bg-border text-muted-foreground")
                }
              >
                {done ? <CheckIcon className="size-3" /> : s.n}
              </span>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
