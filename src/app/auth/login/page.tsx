// src/app/auth/login/page.tsx
import LoginForm from "@/components/login-form";

export default function Page() {
  return (
    <div className="min-h-screen bg-[#f0fdf7] relative overflow-hidden flex items-center justify-center p-6 md:p-10">
      {/* aurora-glow effect for consistency */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/30 via-white/80 to-white pointer-events-none" />
      <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-emerald-200/10 blur-[120px] rounded-full pointer-events-none animate-aurora" />
      <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-blue-100/5 blur-[120px] rounded-full pointer-events-none animate-aurora" style={{ animationDelay: '-3s' }} />

      <div className="w-full max-w-sm relative z-10">
        <LoginForm />
      </div>
    </div>
  );
}
