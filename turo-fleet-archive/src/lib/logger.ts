import { createClient } from './supabase'

export async function log(
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown> = {}
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('activity_log').insert({
    user_id: user.id,
    user_email: user.email!,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  })
}
