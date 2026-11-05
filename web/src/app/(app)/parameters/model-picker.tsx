"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ConfigFieldModelSupport } from "@/lib/config-definition-api";
import type { DeviceModel } from "@/lib/device-model-api";

/** ขยายรุ่นที่เลือกเป็นคู่ (deviceModel, protocol) ให้ครบทุก protocol ที่รุ่นนั้นรองรับ
 * ตามทะเบียน (issue #203 approach ข — ผู้ใช้ไม่ต้องเลือก protocol เอง) · ใช้ร่วมกันทั้ง
 * ฟอร์มสร้างและหน้าแก้ไข Parameter */
export function expandModelsToSupport(
  models: DeviceModel[],
  selectedNames: Set<string>,
): ConfigFieldModelSupport[] {
  return models
    .filter((m) => selectedNames.has(m.name))
    .flatMap((m) =>
      m.supportedProtocols.map((protocol) => ({
        deviceModel: m.name,
        protocol,
      })),
    );
}

/**
 * เลือกโมเดลแบบค้นหาได้ (รองรับโมเดลจำนวนมาก): ปุ่มเปิดรายการที่ค้นหา/เลื่อนได้ + ชิปของที่เลือกไว้
 * ลบทีละตัวได้ · "เลือกที่แสดงทั้งหมด" ทำงานกับผลค้นหาปัจจุบัน
 */
export function ModelPicker({
  models,
  selected,
  onToggle,
  onSetMany,
}: {
  models: DeviceModel[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onSetMany: (names: string[], on: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = models.filter(
    (m) =>
      !q ||
      m.name.toLowerCase().includes(q) ||
      m.supportedProtocols.some((p) => p.toLowerCase().includes(q)),
  );
  const chosen = models.filter((m) => selected.has(m.name));

  if (models.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        ยังไม่มีโมเดลในระบบ เพิ่มโมเดลก่อน
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Popover>
          <PopoverTrigger
            render={
              <Button type="button" variant="outline">
                <PlusIcon />
                เลือกโมเดล
              </Button>
            }
          />
          <PopoverContent className="flex w-80 flex-col gap-2 p-2" align="start">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาโมเดลหรือโปรโตคอล"
              aria-label="ค้นหาโมเดล"
              autoComplete="off"
              className="h-8"
            />
            <div className="flex max-h-64 flex-col overflow-y-auto">
              {visible.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  ไม่พบโมเดลที่ตรงกับคำค้น
                </p>
              ) : (
                visible.map((m) => (
                  <label
                    key={m.id}
                    htmlFor={`param-model-${m.id}`}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      id={`param-model-${m.id}`}
                      checked={selected.has(m.name)}
                      onCheckedChange={() => onToggle(m.name)}
                    />
                    <span className="font-instrument">{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({m.supportedProtocols.join(", ")})
                    </span>
                    {m.status === "discontinued" && (
                      <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[0.7rem] text-muted-foreground">
                        เลิกผลิต
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={visible.length === 0}
                onClick={() => onSetMany(visible.map((m) => m.name), true)}
              >
                เลือกที่แสดงทั้งหมด ({visible.length})
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={chosen.length === 0}
                onClick={() => onSetMany(chosen.map((m) => m.name), false)}
              >
                ล้าง
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {chosen.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          ยังไม่ได้เลือกโมเดล เลือกอย่างน้อย 1 โมเดล
        </p>
      ) : (
        <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" aria-label="โมเดลที่เลือกแล้ว">
          {chosen.map((m) => (
            <li
              key={m.id}
              className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 py-0.5 pr-1 pl-2 text-sm"
            >
              <span className="font-instrument">{m.name}</span>
              <span className="text-xs text-muted-foreground">
                ({m.supportedProtocols.join(", ")})
              </span>
              <button
                type="button"
                onClick={() => onToggle(m.name)}
                aria-label={`เอา ${m.name} ออก`}
                className="rounded p-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
