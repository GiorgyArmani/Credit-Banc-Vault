'use client'
import { useState } from 'react'

export default function ReportUploader() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setLoading(true)

    const creditText = `Paste the full credit report text here, or fetch it from chat context if available.`;

    const res = await fetch('/api/generate-report', {
      method: 'POST',
      body: JSON.stringify({ creditText }),
      headers: { 'Content-Type': 'application/json' },
    })

    const data = await res.json()
    setPdfUrl(data.pdfUrl)
    setLoading(false)
  }

  return (
    <div className="mt-8">
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        {loading ? 'Generating...' : 'Generate PDF Report'}
      </button>

      {pdfUrl && (
        <>
          <a
            href={pdfUrl}
            download
            className="mt-4 block underline text-blue-700"
          >
            Download PDF
          </a>

          <iframe
            src={pdfUrl}
            width="100%"
            height="600px"
            className="mt-4 border"
          />
        </>
      )}
    </div>
  )
}
