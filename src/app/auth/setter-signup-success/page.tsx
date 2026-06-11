// src/app/auth/setter-signup-success/page.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Zap } from "lucide-react";

export default function SetterSignUpSuccessPage() {
    return (
        <div className="min-h-screen bg-emerald-50/30 flex items-center justify-center p-6 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/40 via-white to-white pointer-events-none" />
            <div className="absolute top-0 right-0 w-[60%] h-[60%] bg-emerald-200/20 blur-[130px] rounded-full pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[50%] h-[50%] bg-teal-100/10 blur-[130px] rounded-full pointer-events-none" />

            <div className="w-full max-w-2xl bg-white/90 backdrop-blur-xl border border-emerald-100 rounded-[3.5rem] p-12 text-center shadow-2xl relative z-10">
                <div className="mx-auto w-24 h-24 bg-emerald-950 rounded-[2rem] flex items-center justify-center mb-10 shadow-xl shadow-emerald-900/20">
                    <Zap className="h-12 w-12 text-emerald-400" />
                </div>

                <h1 className="text-4xl md:text-5xl font-black text-emerald-950 uppercase tracking-tighter mb-4 leading-tight">
                    Account Created
                </h1>
                <p className="text-emerald-900/40 font-bold text-lg mb-12 max-w-md mx-auto leading-relaxed">
                    Your setter account is ready. Log in to start creating clients on the fast-funding form.
                </p>

                <div className="grid gap-4 max-w-sm mx-auto">
                    <Link href="/auth/login" className="w-full">
                        <Button className="w-full h-16 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95 text-lg group">
                            <span>Continue to Login</span>
                            <ArrowRight className="ml-3 w-6 h-6 group-hover:translate-x-1 transition-transform" />
                        </Button>
                    </Link>
                </div>

                <div className="mt-12 pt-10 border-t border-emerald-50">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-900/20">
                        Internal Systems · Credit Banc Vault
                    </p>
                </div>
            </div>
        </div>
    );
}
