// src/app/auth/underwriting-signup-success/page.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ArrowRight, ShieldCheck } from "lucide-react";

export default function UnderwritingSignUpSuccessPage() {
    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 relative overflow-hidden">
            {/* Professional slate-glow effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-100/50 via-white to-white pointer-events-none" />
            <div className="absolute top-0 right-0 w-[60%] h-[60%] bg-slate-200/20 blur-[130px] rounded-full pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[50%] h-[50%] bg-emerald-100/10 blur-[130px] rounded-full pointer-events-none" />

            <div className="w-full max-w-2xl bg-white/90 backdrop-blur-xl border border-slate-200 rounded-[3.5rem] p-12 text-center shadow-2xl relative z-10">
                <div className="mx-auto w-24 h-24 bg-slate-900 rounded-[2rem] flex items-center justify-center mb-10 shadow-xl shadow-slate-900/20">
                    <ShieldCheck className="h-12 w-12 text-emerald-400" />
                </div>

                <h1 className="text-4xl md:text-5xl font-black text-slate-950 uppercase tracking-tighter mb-4 leading-tight">
                    Access Initialized
                </h1>
                <p className="text-slate-400 font-bold text-lg mb-12 max-w-md mx-auto leading-relaxed">
                    Your underwriting team credentials have been secured. You can now log in to the underwriting portal.
                </p>

                <div className="grid gap-4 max-w-sm mx-auto">
                    <Link href="/auth/login" className="w-full">
                        <Button className="w-full h-16 bg-slate-950 hover:bg-slate-900 text-white font-black rounded-2xl shadow-xl shadow-slate-950/20 transition-all active:scale-95 text-lg group">
                            <span>Continue to Login</span>
                            <ArrowRight className="ml-3 w-6 h-6 group-hover:translate-x-1 transition-transform" />
                        </Button>
                    </Link>
                </div>

                <div className="mt-12 pt-10 border-t border-slate-100">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">
                        Internal Systems · Credit Banc Vault
                    </p>
                </div>
            </div>
        </div>
    );
}
