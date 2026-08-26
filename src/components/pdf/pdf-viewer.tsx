'use client'

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from '@/components/ui/button'
import { Download, FileText, X, ExternalLink, Pencil } from 'lucide-react'
import { documentFileUrl, downloadDocument } from '@/lib/document-download'
import { OfficeFileViewer, detectOfficeKind } from '@/components/office-file-viewer'

interface DocumentPreviewModalProps {
    isOpen: boolean
    onClose: () => void
    docName: string
    /**
     * The `user_documents` row id. The browser no longer resolves a storage
     * path — GET /api/documents/[id]/file authorises the read server-side and
     * redirects to a short-lived signed URL.
     */
    documentId: string
    fileType?: string
    /** When provided, renders a "Rename" button in the header that calls this. */
    onRename?: () => void
}

export default function DocumentPreviewModal({
    isOpen,
    onClose,
    docName,
    documentId,
    fileType,
    onRename,
}: DocumentPreviewModalProps) {
    // There is nothing to mint client-side any more: the preview URL is a
    // stable app route that authorises the caller and 302s to a short-lived
    // signed URL. Keeping a fetch-then-setState here would only add a spinner
    // in front of a string we already know.
    const previewUrl = isOpen && documentId ? documentFileUrl(documentId) : null

    const isImage = fileType?.startsWith('image/') || 
                   docName.toLowerCase().endsWith('.png') || 
                   docName.toLowerCase().endsWith('.jpg') || 
                   docName.toLowerCase().endsWith('.jpeg') ||
                   docName.toLowerCase().endsWith('.webp')

    // Spreadsheets and Word files render in-app. Browsers cannot display them
    // in an iframe — the old path silently downloaded the file instead of
    // previewing it, which read as a broken button.
    const officeKind = detectOfficeKind(docName, fileType)

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 overflow-hidden border-none bg-slate-950/95 backdrop-blur-xl">
                <DialogHeader className="p-4 border-b border-white/10 flex flex-row items-center justify-between shrink-0 space-y-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                            <FileText className="h-5 w-5" />
                        </div>
                        <div>
                            <DialogTitle className="text-white text-base md:text-lg font-bold truncate max-w-[200px] md:max-w-md">
                                {docName}
                            </DialogTitle>
                            <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] mt-0.5">Document Preview</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {previewUrl && (
                            <div className="flex items-center gap-2">
                                {onRename && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={onRename}
                                        className="bg-white/5 border-white/10 text-white hover:bg-white/10 h-9 px-4 rounded-xl font-bold text-[10px] uppercase tracking-widest hidden sm:flex"
                                    >
                                        <Pencil className="h-3.5 w-3.5 mr-2" />
                                        Rename
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="bg-emerald-600 border-emerald-500 text-white hover:bg-emerald-700 h-9 px-4 rounded-xl font-bold text-[10px] uppercase tracking-widest hidden sm:flex"
                                    onClick={() => downloadDocument(documentId)}
                                >
                                    <Download className="h-3.5 w-3.5 mr-2" />
                                    Download
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="bg-white/5 border-white/10 text-white hover:bg-white/10 h-9 px-4 rounded-xl font-bold text-[10px] uppercase tracking-widest"
                                    asChild
                                >
                                    <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="h-3.5 w-3.5 mr-2" />
                                        Open Original
                                    </a>
                                </Button>
                            </div>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            className="text-slate-400 hover:text-white hover:bg-white/10 rounded-xl"
                        >
                            <X className="h-5 w-5" />
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 bg-slate-900/50 relative flex items-center justify-center overflow-hidden">
                    {previewUrl ? (
                        isImage ? (
                            <div className="w-full h-full p-4 flex items-center justify-center overflow-auto">
                                <img
                                    src={previewUrl}
                                    alt={docName}
                                    className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
                                />
                            </div>
                        ) : officeKind ? (
                            <OfficeFileViewer
                                kind={officeKind}
                                url={previewUrl}
                                name={docName}
                                downloadUrl={documentFileUrl(documentId, { download: true })}
                            />
                        ) : (
                            <iframe
                                src={`${previewUrl}#toolbar=0`}
                                className="w-full h-full border-none"
                                title={docName}
                            />
                        )
                    ) : (
                        <div className="text-center p-8">
                            <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Unable to load secure preview</p>
                            <p className="text-slate-500 text-sm mt-2">Try downloading the file directly.</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
