"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowBigUpIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  UserIcon,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AnimatedLogoMark } from "@/components/brand/animated-logo-mark";
import { listItem, transition } from "@/lib/motion";
import { useAuth } from "./auth-provider";
import { useShouldPlayIntro } from "./login-intro";

/** ไทม์ไลน์เปิดหน้า (วินาที): การ์ดลอยขึ้นก่อน โลโก้ประกอบตัวต่อ แล้วข้อความกับช่องกรอก
 *  ตามเข้ามาทีละช่อง — ช่องกรอกใช้งานได้ตั้งแต่เฟรมแรก ไม่ต้องรอแอนิเมชันจบ */
const CARD_DELAY = 0.05;
const TEXT_DELAY = 0.6;
const FIELDS_DELAY = 0.7;

/** จำชื่อผู้ใช้ล่าสุดไว้ในเครื่อง (ไม่จำรหัสผ่านเด็ดขาด) ให้คนที่ใช้ทุกวันกรอกแค่รหัสผ่าน */
const LAST_USERNAME_KEY = "gps.lastUsername";

export function LoginForm() {
  const router = useRouter();
  const { isReady, isAuthenticated, login } = useAuth();
  const play = useShouldPlayIntro();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  // นับครั้งที่กรอกผิด เพื่อสั่นการ์ดใหม่ทุกครั้ง · leaving = เข้าสู่ระบบสำเร็จแล้ว
  const [failCount, setFailCount] = useState(0);
  const [leaving, setLeaving] = useState(false);

  // อ่านชื่อผู้ใช้ที่จำไว้หลัง mount (กัน hydration mismatch) แล้วย้ายโฟกัสไปช่องรหัสผ่าน —
  // storage ใช้ไม่ได้ก็ข้าม
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_USERNAME_KEY);
      if (saved) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUsername(saved);
        passwordRef.current?.focus();
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (isReady && isAuthenticated) {
      router.replace("/");
    }
  }, [isReady, isAuthenticated, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(username.trim(), password);
      try {
        localStorage.setItem(LAST_USERNAME_KEY, username.trim());
      } catch {}
      // การ์ดเลื่อนจางออกพร้อมเริ่มเปลี่ยนหน้า ไม่รอ (ไม่หน่วงผู้ใช้)
      setLeaving(true);
      router.replace("/");
    } catch (err) {
      setFailCount((n) => n + 1);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  // key เปลี่ยนเมื่อสลับ เล่น/ไม่เล่น (หลัง hydrate ผู้ที่เคยดูแล้ว) ให้ remount
  // ด้วย `initial` ที่ถูกต้อง
  const introKey = play ? "play" : "static";

  return (
    <motion.div
      key={introKey}
      initial={play ? { opacity: 0, y: 18, scale: 0.985 } : false}
      animate={
        leaving
          ? { opacity: 0, y: -10, scale: 0.985 }
          : { opacity: 1, y: 0, scale: 1 }
      }
      transition={
        leaving
          ? transition.base
          : { ...transition.page, delay: play ? CARD_DELAY : 0 }
      }
    >
      <motion.div
        key={failCount}
        animate={failCount > 0 ? { x: [0, -9, 8, -5, 3, 0] } : undefined}
        transition={{ duration: 0.42, ease: "easeOut" }}
      >
        <Card className="w-full ring-white/25 [--card-spacing:--spacing(6)] shadow-2xl">
          <CardHeader className="items-center gap-2 text-center">
            <AnimatedLogoMark
              play={play}
              className="mb-1 size-14 justify-self-center"
            />
            <motion.div
              className="contents"
              initial={play ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...transition.slow, delay: play ? TEXT_DELAY : 0 }}
            >
              <CardTitle className="text-2xl font-semibold">
                เข้าสู่ระบบ
              </CardTitle>
              <CardDescription className="text-base">
                GPS Config &amp; Firmware Center
              </CardDescription>
            </motion.div>
          </CardHeader>
          <CardContent>
            <motion.form
              className="flex flex-col gap-5"
              onSubmit={handleSubmit}
              initial={play ? "hidden" : false}
              animate="visible"
              variants={{
                hidden: {},
                visible: {
                  transition: {
                    staggerChildren: 0.07,
                    delayChildren: play ? FIELDS_DELAY : 0,
                  },
                },
              }}
            >
              <motion.div
                variants={listItem}
                className="flex flex-col gap-1.5"
              >
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    autoFocus
                    className="h-10 pl-9"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    disabled={isSubmitting}
                  />
                </div>
              </motion.div>
              <motion.div
                variants={listItem}
                className="flex flex-col gap-1.5"
              >
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <LockIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    ref={passwordRef}
                    onKeyDown={(event) =>
                      setCapsLock(event.getModifierState("CapsLock"))
                    }
                    onKeyUp={(event) =>
                      setCapsLock(event.getModifierState("CapsLock"))
                    }
                    onBlur={() => setCapsLock(false)}
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="h-10 px-9"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={isSubmitting}
                    aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground transition-colors duration-(--duration-fast) hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  >
                    {showPassword ? (
                      <EyeOffIcon className="size-4" />
                    ) : (
                      <EyeIcon className="size-4" />
                    )}
                  </button>
                </div>
              </motion.div>
              <AnimatePresence initial={false}>
                {capsLock ? (
                  <motion.p
                    key="caps"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={transition.fast}
                    className="-mt-2 flex items-center gap-1.5 text-xs text-warning-foreground"
                    role="status"
                  >
                    <ArrowBigUpIcon className="size-3.5" />
                    Caps Lock เปิดอยู่
                  </motion.p>
                ) : null}
              </AnimatePresence>
              <AnimatePresence initial={false}>
                {error ? (
                  <motion.p
                    key="error"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={transition.fast}
                    className="text-sm text-destructive"
                    role="alert"
                  >
                    {error}
                  </motion.p>
                ) : null}
              </AnimatePresence>
              <motion.div variants={listItem}>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  loading={isSubmitting}
                >
                  {isSubmitting ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
                </Button>
              </motion.div>
            </motion.form>
            <motion.p
              className="mt-5 text-center text-xs text-muted-foreground"
              initial={play ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ ...transition.slow, delay: play ? FIELDS_DELAY + 0.35 : 0 }}
            >
              ระบบภายในสำหรับเจ้าหน้าที่ที่ได้รับอนุญาตเท่านั้น
            </motion.p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
