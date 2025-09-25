// src/hooks/use-capital-readiness.ts
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type CheckedMap = Record<string, boolean>

export function useCapitalReadiness(itemIds: string[]) {
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [checked, setChecked] = useState<CheckedMap>({})
  const [userId, setUserId] = useState<string | null>(null)
  const previousPercentRef = useRef(0)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)

      const { data: { user } } = await supabase.auth.getUser()
      const uid = user?.id ?? null
      if (!mounted) return

      setUserId(uid)

      if (!uid) {
        setChecked({})
        previousPercentRef.current = 0
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('user_capital_readiness')
        .select('item_id, checked')
        .eq('user_id', uid)

      if (error) {
        console.error('readiness select error', error)
        setChecked({})
        previousPercentRef.current = 0
        setLoading(false)
        return
      }

      const map: CheckedMap = {}
      data?.forEach(r => { map[r.item_id] = r.checked })
      setChecked(map)

      const completed = Object.values(map).filter(Boolean).length
      const total = itemIds.length || 1
      previousPercentRef.current = Math.round((completed / total) * 100)

      setLoading(false)
    })()

    return () => { mounted = false }
    // ✅ solo refetch si cambia la CANTIDAD de ítems
  }, [supabase, itemIds.length])

  const setItemChecked = async (itemId: string, value: boolean) => {
    // Optimistic UI
    setChecked(prev => ({ ...prev, [itemId]: value }))

    if (!userId) return
    const { error } = await supabase
      .from('user_capital_readiness')
      .upsert(
        {
          user_id: userId,
          item_id: itemId,
          checked: value,
          checked_at: value ? new Date().toISOString() : null,
        },
        { onConflict: 'user_id,item_id' }
      )

    if (error) console.error('readiness upsert error', error)
  }

  const completedCount = Object.values(checked).filter(Boolean).length
  const totalCount = itemIds.length || 1
  const completionPercentage = Math.round((completedCount / totalCount) * 100)

  return {
    loading,
    checked,
    setItemChecked,
    completedCount,
    totalCount,
    completionPercentage,
    previousPercentRef,
  }
}
