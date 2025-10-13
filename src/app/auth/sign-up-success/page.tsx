// src/app/auth/sign-up-success/page.tsx
"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Mail, Lock, ArrowRight, Copy, Check } from "lucide-react";

// Separate component that uses useSearchParams
function SuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get("email");
  const [copied, set_copied] = useState(false);

  const default_password = "CBvault2025!";

  const copy_password = async () => {
    await navigator.clipboard.writeText(default_password);
    set_copied(true);
    setTimeout(() => set_copied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50 flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full shadow-2xl border-0">
        <CardHeader className="text-center pb-8 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-t-lg">
          <div className="flex justify-center mb-4">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-600" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold">
            🎉 Account Created Successfully!
          </CardTitle>
          <p className="text-emerald-50 mt-2 text-lg">
            Welcome to Credit Banc Vault
          </p>
        </CardHeader>

        <CardContent className="pt-8 space-y-6">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6">
            <h3 className="text-lg font-bold text-blue-900 mb-4 flex items-center gap-2">
              <Lock className="w-6 h-6" />
              Your Login Credentials
            </h3>
            
            <div className="space-y-4">
              <div className="bg-white rounded-lg p-4 border border-blue-200">
                <Label className="text-sm font-semibold text-gray-600 flex items-center gap-2 mb-2">
                  <Mail className="w-4 h-4" />
                  Email Address
                </Label>
                <p className="text-lg font-mono text-gray-900">{email}</p>
              </div>

              <div className="bg-white rounded-lg p-4 border border-blue-200">
                <Label className="text-sm font-semibold text-gray-600 flex items-center gap-2 mb-2">
                  <Lock className="w-4 h-4" />
                  Temporary Password
                </Label>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-lg font-mono text-gray-900">{default_password}</p>
                  <Button
                    onClick={copy_password}
                    variant="outline"
                    size="sm"
                    className="border-emerald-600 text-emerald-600 hover:bg-emerald-50"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-1" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-1" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-6">
            <h3 className="text-lg font-bold text-yellow-900 mb-3 flex items-center gap-2">
              🔒 Important Security Notice
            </h3>
            <ul className="space-y-2 text-sm text-yellow-800">
              <li className="flex items-start gap-2">
                <span className="text-yellow-600 mt-0.5">•</span>
                <span>This is a <strong>temporary password</strong> for initial access</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-yellow-600 mt-0.5">•</span>
                <span>We strongly recommend changing your password after logging in</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-yellow-600 mt-0.5">•</span>
                <span>You can update your password anytime from your account settings</span>
              </li>
            </ul>
          </div>

          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl p-6">
            <h3 className="text-lg font-bold text-green-900 mb-3">✅ What's Next?</h3>
            <ol className="space-y-3 text-sm text-green-800">
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
                <span>Use the credentials above to log into your account</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
                <span>Complete your business profile and upload required documents</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
                <span>Track your funding application progress in real-time</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-xs font-bold">4</span>
                <span>Update your password from Settings for enhanced security</span>
              </li>
            </ol>
          </div>

          <Button
            onClick={() => router.push("/auth/login")}
            className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white py-6 text-lg shadow-lg"
          >
            Go to Login Page
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>

          <p className="text-center text-sm text-gray-500">
            Need help? Contact support at{" "}
            <a href="mailto:support@creditbanc.io" className="text-emerald-600 font-semibold hover:underline">
              support@creditbanc.io
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// Main page component with Suspense wrapper
export default function SignUpSuccessPage() {
  return (
    <Suspense 
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-emerald-600 mx-auto mb-4"></div>
            <p className="text-gray-600 text-lg font-medium">Loading your credentials...</p>
          </div>
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}