"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ExternalLink, Maximize2 } from "lucide-react"

interface ExternalEmbedProps {
  title: string
  description: string
  embedUrl: string
  fallbackUrl?: string
}

export default function ExternalEmbed({ title, description, embedUrl, fallbackUrl }: ExternalEmbedProps) {
  const handleOpenExternal = () => {
    window.open(fallbackUrl || embedUrl, "_blank", "noopener,noreferrer")
  }

  return (
    <div className="space-y-4">
      <Card className="bg-slate-50 border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-900 flex items-center justify-between">
            {title}
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenExternal}
              className="border-slate-300 text-slate-700 hover:bg-slate-100"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in New Tab
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-slate-600 text-sm mb-4">{description}</p>

          {/* Embedded iframe */}
          <div className="relative bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="aspect-video">
              <iframe
                src={embedUrl}
                className="w-full h-full"
                frameBorder="0"
                allowFullScreen
                title={title}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            </div>

            {/* Overlay for better UX */}
            <div className="absolute top-2 right-2">
              <Button variant="secondary" size="sm" onClick={handleOpenExternal} className="bg-white/90 hover:bg-white">
                <Maximize2 className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Fallback message */}
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-800 text-sm">
              <strong>Note:</strong> If the tool doesn't load properly, click "Open in New Tab" above to access it
              directly.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
