'use client'
import { useState, useEffect, type ReactNode } from 'react'
import OnboardingModal from './onboarding-modal'
import { useOnboardingStatus } from './use-onboarding-status'

type OnboardingGateProps = { children: ReactNode }

export default function OnboardingGate({ children }: OnboardingGateProps) {
  const { needsOnboarding, dataVaultCompleted, loading } = useOnboardingStatus()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (loading) return
    const skipped = sessionStorage.getItem('skipOnboarding') === 'true'
    setOpen(needsOnboarding && !skipped)
  }, [needsOnboarding, loading])

  // Lock del body solo mientras el modal está abierto
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      {children}
      <OnboardingModal
        open={open}
        onClose={() => setOpen(false)}
        dataVaultCompleted={dataVaultCompleted}
      />
    </>
  )
}
