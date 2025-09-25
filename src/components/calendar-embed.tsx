"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Calendar, ExternalLink } from "lucide-react"

interface CalendarEmbedProps {
  embedUrl: string
  fallbackUrl?: string
  title?: string
}

export default function CalendarEmbed({
  embedUrl,
  fallbackUrl,
  title = "Schedule Your Credit Audit",
}: CalendarEmbedProps) {
  const handleOpenExternal = () => {
    window.open(fallbackUrl || embedUrl, "_blank", "noopener,noreferrer")
  }

  return (
    <Card className="bg-white border-slate-200 mt-6">
      <CardHeader>
        <CardTitle className="text-slate-900 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-emerald-600" />
            {title}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenExternal}
            className="border-slate-300 text-slate-700 hover:bg-slate-100"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Calendar
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-slate-600 text-sm">
            Select a convenient time for your 30-minute credit repairing audit with one of our certified financial
            advisors.
          </p>

          {/* Calendar iframe */}
          <div className="relative bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
            <div style={{ minHeight: "600px" }}>
              <iframe
                src={embedUrl}
                className="w-full h-full"
                style={{ minHeight: "600px" }}
                frameBorder="0"
                title={title}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            </div>
          </div>

          {/* Fallback message */}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-800 text-sm">
              <strong>Having trouble?</strong> Click "Open Calendar" above to schedule directly on our booking page.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
