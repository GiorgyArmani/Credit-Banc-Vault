'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/hooks/use-toast'
import { AppHeader } from '@/components/layout/app-header'

export default function DocumentUploader() {
  const supabase = createClient()
  const { toast } = useToast()

  const [files, setFiles] = useState<FileList | null>(null)
  const [category, setCategory] = useState<string>('')
  const [label, setLabel] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [isFavorite, setIsFavorite] = useState<boolean>(false)
  const [uploading, setUploading] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFiles(e.target.files)
  }

  const handleUpload = async () => {
    if (!files || files.length === 0) return

    setUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("User not logged in")

      for (const file of Array.from(files)) {
        const filePath = `${user.id}/${Date.now()}-${file.name}`

        // Upload to Supabase Storage (bucket "user-documents")
        const { error: uploadError } = await supabase.storage
          .from('user-documents')
          .upload(filePath, file)

        if (uploadError) throw uploadError

        // Insert metadata into table
        const { error: insertError } = await supabase
          .from('user_documents')
          .insert({
            user_id: user.id,
            name: file.name,
            size: file.size,
            type: file.type,
            category,
            custom_label: label || file.name,
            description,
            is_favorite: isFavorite,
            storage_path: filePath,
            metadata: { lastModified: file.lastModified }
          })

        if (insertError) throw insertError
      }

      toast({ title: "Success", description: "Documents uploaded successfully ✅" })
      setFiles(null)
      setCategory('')
      setLabel('')
      setDescription('')
      setIsFavorite(false)
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="p-4 border rounded-lg bg-white shadow-sm space-y-4 max-w-lg mx-auto">
      {/* App Header */}
      <AppHeader 
        title="Data Room" 
        subtitle="Upload and manage your business documents" 
      />

      <input
        type="file"
        multiple
        onChange={handleFileChange}
        className="w-full border p-2 rounded"
      />

      <input
        type="text"
        placeholder="Custom label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="w-full border p-2 rounded"
      />

      <textarea
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full border p-2 rounded"
      />

      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="w-full border p-2 rounded"
      >
        <option value="">Select category</option>
        <option value="invoice">Invoice</option>
        <option value="contract">Contract</option>
        <option value="payment">Payment Receipt</option>
        <option value="other">Other</option>
      </select>

      <label className="flex items-center space-x-2">
        <input
          type="checkbox"
          checked={isFavorite}
          onChange={(e) => setIsFavorite(e.target.checked)}
        />
        <span>Mark as favorite ⭐</span>
      </label>

      <button
        onClick={handleUpload}
        disabled={uploading}
        className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700"
      >
        {uploading ? "Uploading..." : "Upload Documents"}
      </button>
    </div>
  )
}
