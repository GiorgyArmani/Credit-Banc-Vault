"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Download, FileText, Eye } from "lucide-react"

interface PDFDownloadProps {
  pdfUrl: string
  title: string
}

export default function PDFDownload({ pdfUrl, title }: PDFDownloadProps) {
  const handleDownload = () => {
    // In a real app, this would trigger the actual download
    console.log("Downloading PDF:", pdfUrl)

    // Create a temporary link element and trigger download
    const link = document.createElement("a")
    link.href = pdfUrl
    link.download = title + ".pdf"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handlePreview = () => {
    // Open PDF in new tab for preview
    window.open(pdfUrl, "_blank")
  }

  return (
    <div className="space-y-4">
      <Card className="bg-slate-50 border-slate-200">
        <CardContent className="p-8">
          <div className="text-center">
            <div className="h-20 w-20 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <FileText className="h-10 w-10 text-red-700" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900 mb-2">{title}</h3>
            <p className="text-slate-600 mb-6">Comprehensive guide with actionable strategies and templates</p>
            <div className="flex justify-center space-x-4">
              <Button
                onClick={handlePreview}
                variant="outline"
                className="border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                <Eye className="h-4 w-4 mr-2" />
                Preview
              </Button>
              <Button onClick={handleDownload} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Download className="h-4 w-4 mr-2" />
                Download PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PDF Preview/Info */}
      <Card className="bg-slate-50 border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-900 text-lg">What's included</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-slate-900 font-medium">Key Topics</h4>
              <ul className="text-slate-600 text-sm space-y-1">
                <li>• Asset allocation strategies</li>
                <li>• Risk tolerance assessment</li>
                <li>• Portfolio rebalancing</li>
                <li>• Tax-efficient investing</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="text-slate-900 font-medium">Resources</h4>
              <ul className="text-slate-600 text-sm space-y-1">
                <li>• Downloadable templates</li>
                <li>• Calculation worksheets</li>
                <li>• Reference charts</li>
                <li>• Action checklists</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
