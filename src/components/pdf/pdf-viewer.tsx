'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, FileText } from 'lucide-react'

interface PDFViewerProps {
  title: string
  pdfUrl: string
}

export default function PDFViewer({ title, pdfUrl }: PDFViewerProps) {
  const [isVisible, setIsVisible] = useState(false)

  return (
    <div className="space-y-4">
      {/* Título e info */}
      <Card className="bg-slate-50 border border-slate-200">
        <CardContent className="p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-800 font-medium text-sm">
              <FileText className="h-4 w-4 text-slate-600" />
              {title}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsVisible(!isVisible)}
              >
                {isVisible ? 'Hide PDF' : 'View PDF'}
              </Button>
              <Button
                size="sm"
                variant="default"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                asChild
              >
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer" download>
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </a>
              </Button>
            </div>
          </div>

          {/* PDF viewer toggle */}
          {isVisible && (
            <iframe
              src={pdfUrl}
              className="w-full h-[600px] border rounded-md mt-4"
              title={title}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
