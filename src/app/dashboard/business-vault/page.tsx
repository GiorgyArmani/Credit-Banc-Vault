'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/hooks/use-toast'
import {
  Upload,
  Trash2,
  Star,
  Download,
  FileText,
  Folder,
  Heart,
  Pencil
} from 'lucide-react'
import clsx from 'clsx'

// Modal UI
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface UserDocument {
  id: string
  name: string
  size: number
  type: string
  category: string | null
  custom_label: string | null
  description: string | null
  is_favorite: boolean
  upload_date: string
  storage_path: string
  tags?: string[]
}

export default function DataRoomPage() {
  const supabase = createClient()
  const { toast } = useToast()

  const [userId, setUserId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<UserDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [activeTab, setActiveTab] = useState<
    'all' | 'favorites' | 'bank_statements' | 'invoices' | 'contracts' | 'tax_returns' | 'uncategorized'
  >('all')

  // Modal states
  const [showModal, setShowModal] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [fileCategory, setFileCategory] = useState<string>('uncategorized')
  const [fileName, setFileName] = useState<string>('')
  const [fileTags, setFileTags] = useState<string>('')

  // Modal edición existente
  const [editDoc, setEditDoc] = useState<UserDocument | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      fetchDocuments(user.id)
    }
    init()
  }, [])

  const fetchDocuments = async (uid: string) => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('user_documents')
        .select('*')
        .eq('user_id', uid)
        .order('upload_date', { ascending: false })
      if (error) throw error
      setDocuments(data || [])
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  // Step 1 → User selects file
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!userId || !e.target.files) return
    const file = e.target.files[0]
    if (!file) return

    setPendingFile(file)
    setFileName(file.name)
    setFileCategory('uncategorized')
    setFileTags('')
    setShowModal(true) // open modal
    e.target.value = ''
  }

  // Step 2 → Confirm modal
  const confirmUpload = async () => {
    if (!pendingFile || !userId) return

    setUploading(true)
    try {
      const filePath = `${userId}/${Date.now()}-${pendingFile.name}`
      const { error: uploadError } = await supabase.storage
        .from('user-documents')
        .upload(filePath, pendingFile)
      if (uploadError) throw uploadError

      const { data, error: dbError } = await supabase.from('user_documents').insert({
        user_id: userId,
        name: pendingFile.name,
        size: pendingFile.size,
        type: pendingFile.type,
        storage_path: filePath,
        category: fileCategory,
        custom_label: fileName,
        metadata: { tags: fileTags.split(',').map(t => t.trim()) }
      }).select('*').single()
      if (dbError) throw dbError

      setDocuments((prev) => [data, ...prev])
      toast({ title: 'Uploaded', description: 'Your document was uploaded successfully.' })
    } catch (err: any) {
      toast({ title: 'Upload error', description: err.message, variant: 'destructive' })
    } finally {
      setUploading(false)
      setShowModal(false)
      setPendingFile(null)
    }
  }

  // Edit existing doc
  const confirmEdit = async () => {
    if (!editDoc) return
    try {
      const { error } = await supabase
        .from('user_documents')
        .update({
          custom_label: editDoc.custom_label,
          category: editDoc.category,
          metadata: { tags: editDoc.tags }
        })
        .eq('id', editDoc.id)
      if (error) throw error

      setDocuments((prev) =>
        prev.map((d) => (d.id === editDoc.id ? editDoc : d))
      )
      toast({ title: 'Updated', description: 'Document updated successfully.' })
      setEditDoc(null)
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    }
  }

  const toggleFavorite = async (doc: UserDocument) => {
    try {
      const { error } = await supabase
        .from('user_documents')
        .update({ is_favorite: !doc.is_favorite })
        .eq('id', doc.id)
      if (error) throw error
      setDocuments((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, is_favorite: !doc.is_favorite } : d))
      )
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    }
  }

  const handleDelete = async (doc: UserDocument) => {
    try {
      await supabase.storage.from('user-documents').remove([doc.storage_path])
      await supabase.from('user_documents').delete().eq('id', doc.id)
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
      toast({ title: 'Deleted', description: `${doc.name} has been removed.` })
    } catch (err: any) {
      toast({ title: 'Delete error', description: err.message, variant: 'destructive' })
    }
  }

  const handleDownload = async (doc: UserDocument) => {
    try {
      const { data } = await supabase.storage.from('user-documents').download(doc.storage_path)
      if (!data) return
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      toast({ title: 'Download error', description: err.message, variant: 'destructive' })
    }
  }

  const filteredDocs = documents.filter((doc) => {
    if (activeTab === 'all') return true
    if (activeTab === 'favorites') return doc.is_favorite
    return doc.category === activeTab
  })

  return (
    <div className="p-8 w-full min-h-screen space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-emerald-600 rounded-lg flex items-center justify-center shadow">
          <Folder className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Business Vault</h2>
          <p className="text-gray-500">Upload, organize and manage your documents</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-3">
        {[
          { key: 'all', label: 'All', icon: Folder },
          { key: 'favorites', label: 'Favorites', icon: Heart },
          { key: 'bank_statements', label: 'Bank Statements', icon: FileText },
          { key: 'invoices', label: 'Invoices', icon: FileText },
          { key: 'contracts', label: 'Contracts', icon: FileText },
          { key: 'tax_returns', label: 'Tax Returns', icon: FileText },
          { key: 'uncategorized', label: 'Uncategorized', icon: FileText }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition',
              activeTab === tab.key
                ? 'bg-emerald-600 text-white shadow'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Upload Box */}
        <div className="bg-white border rounded-xl shadow p-10 flex flex-col items-center justify-center lg:col-span-1">
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-10 cursor-pointer hover:bg-gray-50 transition w-full">
            <Upload className="h-14 w-14 text-emerald-600 mb-3" />
            <span className="font-medium text-gray-700">Click or drag files here</span>
            <span className="text-sm text-gray-500">PDF, Word, Excel, Invoices and more</span>
            <input type="file" multiple onChange={handleUpload} className="hidden" />
          </label>
          {uploading && <p className="text-sm text-emerald-600 mt-3">Uploading...</p>}
        </div>

        {/* Docs */}
        <div className="bg-white border rounded-xl shadow p-6 lg:col-span-2">
          {loading ? (
            <p className="text-gray-500 text-center">Loading documents...</p>
          ) : filteredDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <FileText className="h-14 w-14 mb-3 text-gray-400" />
              <p>No documents found in this category.</p>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {filteredDocs.map((doc) => (
                <div key={doc.id} className="flex flex-col border rounded-lg p-4 bg-gray-50 hover:shadow-md transition">
                  <div className="flex justify-between items-start">
                    <p className="font-medium text-gray-900 truncate">{doc.custom_label || doc.name}</p>
                    <button onClick={() => toggleFavorite(doc)}>
                      <Star
                        className={clsx(
                          'h-5 w-5',
                          doc.is_favorite ? 'text-yellow-500 fill-yellow-500' : 'text-gray-400'
                        )}
                      />
                    </button>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {(doc.size / 1024).toFixed(1)} KB • {doc.category || 'Uncategorized'}
                  </p>
                  {doc.tags && doc.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {doc.tags.map((tag, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full text-xs">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => handleDownload(doc)}
                      className="flex-1 py-2 text-sm font-medium text-emerald-600 border rounded hover:bg-emerald-50"
                    >
                      <Download className="inline h-4 w-4 mr-1" /> Download
                    </button>
                    <button
                      onClick={() => setEditDoc(doc)}
                      className="flex-1 py-2 text-sm font-medium text-blue-600 border rounded hover:bg-blue-50"
                    >
                      <Pencil className="inline h-4 w-4 mr-1" /> Edit
                    </button>
                    <button
                      onClick={() => handleDelete(doc)}
                      className="flex-1 py-2 text-sm font-medium text-red-600 border rounded hover:bg-red-50"
                    >
                      <Trash2 className="inline h-4 w-4 mr-1" /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal for editing before upload */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Document Info</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="Custom file name"
            />
            <Select value={fileCategory} onValueChange={setFileCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_statements">Bank Statements</SelectItem>
                <SelectItem value="invoices">Invoices</SelectItem>
                <SelectItem value="contracts">Contracts</SelectItem>
                <SelectItem value="tax_returns">Tax Returns</SelectItem>
                <SelectItem value="uncategorized">Uncategorized</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={fileTags}
              onChange={(e) => setFileTags(e.target.value)}
              placeholder="Tags (comma separated)"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button onClick={confirmUpload} disabled={uploading}>
              {uploading ? 'Uploading...' : 'Save & Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal for editing existing documents */}
      <Dialog open={!!editDoc} onOpenChange={() => setEditDoc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Document</DialogTitle>
          </DialogHeader>
          {editDoc && (
            <div className="space-y-4">
              <Input
                value={editDoc.custom_label || ''}
                onChange={(e) => setEditDoc({ ...editDoc, custom_label: e.target.value })}
                placeholder="Custom file name"
              />
              <Select
                value={editDoc.category || 'uncategorized'}
                onValueChange={(val) => setEditDoc({ ...editDoc, category: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_statements">Bank Statements</SelectItem>
                  <SelectItem value="invoices">Invoices</SelectItem>
                  <SelectItem value="contracts">Contracts</SelectItem>
                  <SelectItem value="tax_returns">Tax Returns</SelectItem>
                  <SelectItem value="uncategorized">Uncategorized</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={editDoc.tags?.join(', ') || ''}
                onChange={(e) =>
                  setEditDoc({ ...editDoc, tags: e.target.value.split(',').map((t) => t.trim()) })
                }
                placeholder="Tags (comma separated)"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDoc(null)}>
              Cancel
            </Button>
            <Button onClick={confirmEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
