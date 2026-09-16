import { LoginForm } from "@/components/auth/login-form";
import { LoginHeroPanel } from "@/components/auth/login-hero-panel";

export const metadata = {
  title: "เข้าสู่ระบบ | GPS Config Center",
};

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <LoginHeroPanel />
      <div className="flex items-center justify-center bg-muted/30 p-4">
        <LoginForm />
      </div>
    </div>
  );
}
