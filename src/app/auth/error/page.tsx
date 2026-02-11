// src/app/auth/error/page.tsx
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="min-h-screen bg-[#f0fdf7] relative overflow-hidden flex items-center justify-center p-6 md:p-10">
      {/* aurora-glow effect for consistency */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-100/30 via-white/80 to-white pointer-events-none" />
      <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-emerald-200/10 blur-[120px] rounded-full pointer-events-none animate-aurora" />
      <div className="absolute bottom-0 left-0 w-[40%] h-[40%] bg-blue-100/5 blur-[120px] rounded-full pointer-events-none animate-aurora" style={{ animationDelay: '-3s' }} />

      <Card className="max-w-md w-full shadow-2xl border-emerald-50 rounded-[3rem] overflow-hidden relative z-10 bg-white/80 backdrop-blur-xl">
        <CardHeader className="p-10 text-center">
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-red-50 border border-red-100 shadow-inner">
            <AlertCircle className="h-10 w-10 text-red-500" />
          </div>
          <CardTitle className="text-3xl font-black text-emerald-950 uppercase tracking-tighter mb-2 leading-tight">Something Went Wrong</CardTitle>
          <CardDescription className="text-sm font-bold text-emerald-900/40 uppercase tracking-widest mt-2">
            Authentication Error
          </CardDescription>
        </CardHeader>
        <CardContent className="p-10 pt-0 space-y-8">
          <div className="bg-red-50 rounded-[2.5rem] p-8 border border-red-100">
            <p className="text-sm font-bold text-red-800 leading-relaxed text-center">
              {params?.error ? (
                <>Error Code: <span className="font-black">{params.error}</span></>
              ) : (
                "An unspecified authentication error occurred. Please try again or contact support."
              )}
            </p>
          </div>

          <Link href="/auth/login" className="block">
            <Button className="w-full h-14 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-95">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Return to Login
            </Button>
          </Link>

          <div className="text-center">
            <p className="text-sm font-bold text-emerald-900/30">
              Need assistance?{" "}
              <Link href="/support" className="text-emerald-500 hover:underline">
                Contact Support
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
