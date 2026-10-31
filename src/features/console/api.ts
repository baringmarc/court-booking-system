import type { Tables } from '../../lib/database.types'
import { unwrap } from '../../lib/queryClient'
import { supabase } from '../../lib/supabase'

/** Whether the user is a platform admin (RLS lets them read only their own `platform_admins` row). */
export async function fetchIsPlatformAdmin(userId: string): Promise<boolean> {
  const row = unwrap(await supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle())
  return row !== null
}

export type Lead = Tables<'leads'>
export type LeadStatus = 'new' | 'talking' | 'won' | 'lost'

/** Leads, newest first. RLS lets only platform admins read them. */
export async function fetchLeads(status: LeadStatus | 'all'): Promise<Lead[]> {
  let query = supabase.from('leads').select('*').order('created_at', { ascending: false })
  if (status !== 'all') query = query.eq('status', status)
  return unwrap(await query)
}

/** Platform admins may change only `status` and `notes` (column grant). */
export async function updateLead(id: string, patch: { status?: LeadStatus; notes?: string | null }): Promise<void> {
  unwrap(await supabase.from('leads').update(patch).eq('id', id))
}
