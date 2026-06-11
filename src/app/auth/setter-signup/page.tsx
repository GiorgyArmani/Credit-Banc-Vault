// src/app/auth/setter-signup/page.tsx
import { SetterSignUpForm } from "@/components/setter-sign-up-form";

export default function Page() {
    return (
        <div className="min-h-screen bg-emerald-50/30 relative overflow-hidden flex items-center justify-center p-6 md:p-10">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/40 via-white to-white pointer-events-none" />
            <div className="absolute top-0 right-0 w-[60%] h-[60%] bg-emerald-200/20 blur-[130px] rounded-full pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[50%] h-[50%] bg-teal-100/10 blur-[130px] rounded-full pointer-events-none" />

            <div className="w-full max-w-4xl mx-auto relative z-10">
                <SetterSignUpForm />
            </div>
        </div>
    );
}
