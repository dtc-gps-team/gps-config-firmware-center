import { LoginForm } from "@/components/auth/login-form";
import { LoginBackground } from "@/components/auth/login-background";

export const metadata = {
  title: "เข้าสู่ระบบ | GPS Config Center",
};

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <LoginBackground />
      <div className="relative">
        <LoginForm />
      </div>
    </div>
  );
}
