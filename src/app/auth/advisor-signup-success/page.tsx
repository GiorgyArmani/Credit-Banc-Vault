"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";

/**
 * Advisor Signup Success Page
 * Displays confirmation message after successful advisor account creation
 * Prompts user to check email for verification
 */
export default function AdvisorSignUpSuccess() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {/* Success Icon */}
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
          </div>
          
          <CardTitle className="text-2xl">Advisor Account Created!</CardTitle>
          <CardDescription className="text-base">
            Your advisor account has been created successfully
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Instructions */}
          <div className="rounded-lg bg-muted p-4 text-sm">
            <p className="font-medium mb-2">Next Steps:</p>
            <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
              <li>Check your email inbox for a verification link</li>
              <li>Click the verification link to activate your account</li>
              <li>Once verified, log in to access your advisor dashboard</li>
            </ol>
          </div>

          {/* Additional Information */}
          <div className="text-sm text-muted-foreground">
            <p>
              <strong>Note:</strong> You won't be able to log in until you verify your email address.
              If you don't see the email, check your spam folder.
            </p>
          </div>

          {/* Action Button */}
          <Link href="/auth/login" className="block">
            <Button className="w-full">
              Go to Login
            </Button>
          </Link>

          {/* Help Link */}
          <div className="text-center text-sm text-muted-foreground">
            Need help?{" "}
            <Link 
              href="/support" 
              className="underline underline-offset-4 hover:text-primary"
            >
              Contact Support
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}