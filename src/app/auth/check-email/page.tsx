// src/app/auth/check-email/page.tsx
export default function CheckEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-3xl font-bold">Check your email</h1>
        <p className="text-muted-foreground">
          We’ve sent a confirmation link to your inbox. <br />
          Click it to finish creating your account.
        </p>
        <p className="text-sm text-muted-foreground">
          Didn’t get the email? Make sure to check your spam folder.
        </p>
      </div>
    </div>
  )
}
