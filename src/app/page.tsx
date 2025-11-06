// creditbanc-agent/src/app/page.tsx
import { AuthButton } from "@/components/auth-button"
import { ThemeSwitcher } from "@/components/theme-switcher"
import Link from "next/link"
import { LandingPage } from "@/components/landing-page"

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
        <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
          <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
            <div className="flex gap-5 items-center font-semibold">
              <Link href={"/"}>FRONT END TEST CB FLOW</Link>
              <div className="flex items-center gap-2"></div>
            </div>
            <AuthButton />
          </div>
        </nav>

        {/* Landing content */}
        <div className="w-full">
          <LandingPage />
        </div>

       
      </div>
    </main>
  )
}
