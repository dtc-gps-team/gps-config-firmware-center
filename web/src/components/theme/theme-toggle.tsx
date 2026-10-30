"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

const subscribe = () => () => {};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // resolvedTheme รู้ค่าจริงหลัง hydrate เท่านั้น — กัน icon กระพริบ/mismatch
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const dark = mounted && resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "สลับเป็นธีมสว่าง" : "สลับเป็นธีมมืด"}
      title={dark ? "ธีมสว่าง" : "ธีมมืด"}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
