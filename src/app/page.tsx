// creditbanc-agent/src/app/page.tsx
import { AuthButton } from "@/components/auth-button"
import { ThemeSwitcher } from "@/components/theme-switcher"
import Link from "next/link"
import { LandingPage } from "@/components/landing-page"

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
       

        {/* Landing content */}
        <div className="w-full">
          <LandingPage />
        </div>

       
      </div>
    </main>
  )
}
