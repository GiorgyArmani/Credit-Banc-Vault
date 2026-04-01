'use client'

import React from 'react'

interface InlinePDFViewerProps {
    url: string
    title?: string
    className?: string
}

/**
 * InlinePDFViewer
 * 
 * A lightweight, non-modal PDF viewer that renders an iframe.
 * Ideal for embedding PDF previews directly into a page without Dialog overhead.
 */
export function InlinePDFViewer({ url, title, className = "" }: InlinePDFViewerProps) {
    if (!url) return null;

    return (
        <div className={`w-full aspect-[4/3] min-h-[500px] bg-slate-900/5 rounded-xl overflow-hidden border border-emerald-100 shadow-inner group ${className}`}>
            <iframe
                src={`${url}#toolbar=0`}
                className="w-full h-full"
                title={title || "PDF Preview"}
            />
        </div>
    )
}

export default InlinePDFViewer;
