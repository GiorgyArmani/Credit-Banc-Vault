// src/app/auth/underwriting-signup/page.tsx
import { UnderwritingSignUpForm } from "@/components/underwriting-sign-up-form";

export default function Page() {
    return (
        <div className="min-h-screen bg-slate-50 relative overflow-hidden flex items-center justify-center p-6 md:p-10">
            {/* Professional slate-glow effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-100/50 via-white to-white pointer-events-none" />
            <div className="absolute top-0 right-0 w-[60%] h-[60%] bg-slate-200/20 blur-[130px] rounded-full pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[50%] h-[50%] bg-emerald-100/10 blur-[130px] rounded-full pointer-events-none" />

            <div className="w-full max-w-4xl mx-auto relative z-10">
                <UnderwritingSignUpForm />
            </div>
        </div>
    );
}
