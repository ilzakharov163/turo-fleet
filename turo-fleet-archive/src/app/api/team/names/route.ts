import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) return NextResponse.json({ names: {} })

  const names: Record<string, string> = {}
  for (const u of data.users) {
    if (u.email) names[u.email] = u.user_metadata?.full_name || ''
  }
  return NextResponse.json({ names })
}
