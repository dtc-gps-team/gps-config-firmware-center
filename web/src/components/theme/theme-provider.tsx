"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** สลับ light/dark ผ่านคลาส `.dark` (ตรงกับ @custom-variant dark ใน
 *  globals.css) จำค่าไว้ใน localStorage key "theme" ตามค่าเริ่มต้นของ
 *  next-themes · ค่าเริ่มต้นตามระบบเครื่อง */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
