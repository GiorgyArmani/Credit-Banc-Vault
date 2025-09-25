'use client'

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ArrowLeft, Settings } from "lucide-react"
import Link from "next/link"

interface AppHeaderProps {
  title: string
  subtitle?: string
  showBackButton?: boolean
  onBackClick?: () => void
  showProfileButton?: boolean
  onProfileClick?: () => void
  profileCompletion?: number
}

export function AppHeader({
  title,
  subtitle,
  showBackButton = true,
  onBackClick,
  showProfileButton = false,
  onProfileClick,
  profileCompletion = 0,
}: AppHeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 px-4 py-4 sm:px-6 shadow-sm">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {showBackButton && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onBackClick}
                className="text-slate-600 hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            )}

            <div>
              <h1 className="text-lg sm:text-xl font-bold text-gray-900">{title}</h1>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
          </div>

          {showProfileButton && profileCompletion > 0 && (
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-medium text-gray-900">
                  {profileCompletion}% Complete
                </div>
                <Progress value={profileCompletion} className="w-24 h-2" />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onProfileClick}
                className="text-gray-700 border-gray-300 hover:bg-gray-50"
              >
                <Settings className="h-4 w-4 mr-2" />
                Profile
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
