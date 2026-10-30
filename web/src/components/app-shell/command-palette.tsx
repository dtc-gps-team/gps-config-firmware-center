"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { BoxIcon, MoonIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { useAuth } from "@/components/auth/auth-provider";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useDevices } from "@/hooks/use-devices";
import { visibleNavItems } from "@/lib/nav";
import { requestRefresh } from "@/lib/refresh-bus";

/** แสดงอุปกรณ์สูงสุดกี่รายการในรายการเริ่มต้น (ที่เหลือค้นเจอเมื่อพิมพ์) */
const DEVICE_RESULT_LIMIT = 8;

const ITEM_CLASS =
  "flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";
const GROUP_CLASS =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground";

/**
 * Command Palette (Ctrl/Cmd+K): ค้นหาหน้า อุปกรณ์ และสั่งงานเร็ว — รายการหน้า
 * ใช้ `visibleNavItems` ชุดเดียวกับ sidebar จึงไม่เห็นหน้าที่ Role นี้เข้าไม่ได้
 * · อุปกรณ์โหลดเมื่อเปิดครั้งแรกเท่านั้น (content mount ตอนเปิด)
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] max-w-xl -translate-y-0 gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">ค้นหาและสั่งงาน</DialogTitle>
        <DialogDescription className="sr-only">
          พิมพ์ชื่อหน้า รหัสอุปกรณ์ หรือคำสั่ง
        </DialogDescription>
        <PaletteBody onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { session } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const devices = useDevices();
  // ยังไม่พิมพ์: โชว์อุปกรณ์ชุดแรกพอเป็นทางลัด · พิมพ์แล้ว: ให้ cmdk กรองจากทั้งหมด
  const [search, setSearch] = useState("");

  const pages = visibleNavItems(session?.role);

  function go(href: string) {
    onDone();
    router.push(href);
  }

  return (
    <Command label="ค้นหาและสั่งงาน" className="flex flex-col">
      <div className="flex items-center gap-2.5 border-b px-3.5">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <Command.Input
          autoFocus
          value={search}
          onValueChange={setSearch}
          placeholder="ค้นหาหน้า อุปกรณ์ หรือคำสั่ง"
          className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="font-instrument rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
          Esc
        </kbd>
      </div>
      <Command.List className="max-h-80 overflow-y-auto p-1.5">
        <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
          ไม่พบรายการที่ตรงกับที่พิมพ์
        </Command.Empty>

        <Command.Group heading="หน้า" className={GROUP_CLASS}>
          {pages.map((item) => (
            <Command.Item
              key={item.href}
              value={`หน้า ${item.label}`}
              onSelect={() => go(item.href)}
              className={ITEM_CLASS}
            >
              <item.icon className="size-4 text-muted-foreground" />
              {item.label}
            </Command.Item>
          ))}
        </Command.Group>

        {devices.data && devices.data.length > 0 && (
          <Command.Group heading="อุปกรณ์" className={GROUP_CLASS}>
            {(search ? devices.data : devices.data.slice(0, DEVICE_RESULT_LIMIT)).map(
              (d) => (
                <DeviceItem key={d.id} d={d} onSelect={go} />
              ),
            )}
          </Command.Group>
        )}

        <Command.Group heading="คำสั่ง" className={GROUP_CLASS}>
          <Command.Item
            value="คำสั่ง สลับธีม สว่าง มืด dark light"
            onSelect={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
              onDone();
            }}
            className={ITEM_CLASS}
          >
            <MoonIcon className="size-4 text-muted-foreground" />
            สลับธีมสว่าง/มืด
          </Command.Item>
          <Command.Item
            value="คำสั่ง รีเฟรช โหลดใหม่ refresh"
            onSelect={() => {
              requestRefresh();
              onDone();
            }}
            className={ITEM_CLASS}
          >
            <RefreshCwIcon className="size-4 text-muted-foreground" />
            รีเฟรชข้อมูลในหน้านี้
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command>
  );
}

function DeviceItem({
  d,
  onSelect,
}: {
  d: { deviceId: string; deviceModel: string; imei: string | null };
  onSelect: (href: string) => void;
}) {
  return (
    <Command.Item
      value={`อุปกรณ์ ${d.deviceId} ${d.deviceModel} ${d.imei ?? ""}`}
      onSelect={() => onSelect(`/devices/${encodeURIComponent(d.deviceId)}`)}
      className={ITEM_CLASS}
    >
      <BoxIcon className="size-4 text-muted-foreground" />
      <span className="font-instrument">{d.deviceId}</span>
      <span className="ml-auto text-xs text-muted-foreground">
        {d.deviceModel}
      </span>
    </Command.Item>
  );
}
