import { LoginForm } from "@/components/auth/login-form";
import { LoginBackground } from "@/components/auth/login-background";

export const metadata = {
  title: "เข้าสู่ระบบ | GPS Config Center",
};

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen flex-col justify-center overflow-hidden p-4">
      <LoginBackground />
      <div className="relative mx-auto w-full max-w-md">
        <LoginForm />
      </div>
    </div>
  );
}
