'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/hooks/use-toast'
import { Trash2, Star, Download } from 'lucide-react'
import { AppHeader } from '@/components/layout/app-header'

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
}

export default function DocumentManager() {
  const supabase = createClient()
  const { toast } = useToast()

  const [documents, setDocuments] = useState<UserDocument[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchDocuments()
  }, [])

  const fetchDocuments = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('user_documents')
        .select('*')
        .eq('user_id', user.id)
        .order('upload_date', { ascending: false })

      if (error) throw error
      setDocuments(data || [])
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async (doc: UserDocument) => {
    try {
      const { data, error } = await supabase.storage
        .from('user-documents')
        .download(doc.storage_path)

      if (error) throw error
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

  const handleDelete = async (doc: UserDocument) => {
    try {
      // Remove from storage
      await supabase.storage.from('user-documents').remove([doc.storage_path])

      // Remove from DB
      const { error } = await supabase.from('user_documents').delete().eq('id', doc.id)
      if (error) throw error

      setDocuments((prev) => prev.filter((d) => d.id !== doc.id))
      toast({ title: 'Deleted', description: `${doc.name} has been deleted` })
    } catch (err: any) {
      toast({ title: 'Delete error', description: err.message, variant: 'destructive' })
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
        prev.map((d) =>
          d.id === doc.id ? { ...d, is_favorite: !doc.is_favorite } : d
        )
      )
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    }
  }

  return (
    <div className="p-4 bg-white rounded-lg shadow-sm max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <AppHeader 
        title="My Documents" 
        subtitle="Manage, download and organize your files" 
      />

      {loading ? (
        <p className="text-gray-500">Loading documents...</p>
      ) : documents.length === 0 ? (
        <p className="text-gray-500">No documents uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium text-gray-900">
                  {doc.custom_label || doc.name}{' '}
                  {doc.is_favorite && <span className="text-yellow-500">★</span>}
                </p>
                <p className="text-sm text-gray-500">
                  {doc.category || 'Uncategorized'} • {(doc.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleFavorite(doc)}
                  className="p-2 rounded hover:bg-gray-100"
                  title={doc.is_favorite ? 'Unmark favorite' : 'Mark favorite'}
                >
                  <Star
                    className={`h-5 w-5 ${doc.is_favorite ? 'text-yellow-500 fill-yellow-500' : 'text-gray-400'}`}
                  />
                </button>
                <button
                  onClick={() => handleDownload(doc)}
                  className="p-2 rounded hover:bg-gray-100"
                  title="Download"
                >
                  <Download className="h-5 w-5 text-emerald-600" />
                </button>
                <button
                  onClick={() => handleDelete(doc)}
                  className="p-2 rounded hover:bg-gray-100"
                  title="Delete"
                >
                  <Trash2 className="h-5 w-5 text-red-600" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
