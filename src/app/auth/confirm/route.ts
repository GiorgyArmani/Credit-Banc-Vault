// src/app/auth/confirm/route.ts
import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest } from 'next/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server' // Usa tu helper que ya incluye cookies

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/dashboard'

  if (!token_hash || !type) {
    return redirect('/auth/error?error=Missing token or type')
  }

  const supabase = await createClient() // Este ya maneja cookies correctamente

  // Verifica el OTP Y guarda la sesión en la cookie automáticamente
  const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash, type })

  if (verifyError) {
    return redirect(`/auth/error?error=${verifyError.message}`)
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return redirect('/auth/error?error=Could not fetch user')
  }

  // Insertar perfil si no existe
  await supabase.rpc('insert_user_profile', {
    user_id: user.id,
    email: user.email,
    full_name: user.user_metadata?.full_name || '',
    role: 'free',
  })

  // Crear business_profiles si no existe
 const { error: bpError } = await supabase
  .from('business_profiles')
  .insert({ user_id: user.id })

if (bpError && bpError.code !== '23505') {
  console.error('business_profiles insert error:', bpError.message)
}

  return redirect(next)
}
