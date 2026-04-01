'use client'

import { useState, useEffect } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from '@/components/ui/button'
import { Download, FileText, Loader2, X, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface DocumentPreviewModalProps {
    isOpen: boolean
    onClose: () => void
    docName: string
    storagePath: string
    fileType?: string
}

export default function DocumentPreviewModal({
    isOpen,
    onClose,
    docName,
    storagePath,
    fileType
}: DocumentPreviewModalProps) {
    const [signedUrl, setSignedUrl] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const supabase = createClient()

    useEffect(() => {
        if (isOpen && storagePath) {
            fetchSignedUrl()
        } else if (!isOpen) {
            // Reset URL when closing to ensure fresh one next time
            setSignedUrl(null)
        }
    }, [isOpen, storagePath])

    async function fetchSignedUrl() {
        setIsLoading(true)
        try {
            // Sanitize: Supabase storage paths should not start with a leading slash
            const sanitizedPath = storagePath.replace(/^\//, '')
            
            const { data, error } = await supabase.storage
                .from('user-documents')
                .createSignedUrl(sanitizedPath, 3600) // 1 hour

            if (error) throw error
            setSignedUrl(data.signedUrl)
        } catch (err) {
            console.error('Error fetching signed URL:', err)
        } finally {
            setIsLoading(false)
        }
    }

    const isImage = fileType?.startsWith('image/') || 
                   docName.toLowerCase().endsWith('.png') || 
                   docName.toLowerCase().endsWith('.jpg') || 
                   docName.toLowerCase().endsWith('.jpeg') ||
                   docName.toLowerCase().endsWith('.webp')

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
                        {signedUrl && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="bg-white/5 border-white/10 text-white hover:bg-white/10 h-9 px-4 rounded-xl font-bold text-[10px] uppercase tracking-widest"
                                asChild
                            >
                                <a href={signedUrl} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-3.5 w-3.5 mr-2" />
                                    Open Original
                                </a>
                            </Button>
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
                    {isLoading ? (
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-10 w-10 text-emerald-500 animate-spin" />
                            <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Generating secure preview...</p>
                        </div>
                    ) : signedUrl ? (
                        isImage ? (
                            <div className="w-full h-full p-4 flex items-center justify-center overflow-auto">
                                <img
                                    src={signedUrl}
                                    alt={docName}
                                    className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
                                />
                            </div>
                        ) : (
                            <iframe
                                src={`${signedUrl}#toolbar=0`}
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
