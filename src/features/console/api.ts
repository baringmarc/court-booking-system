import { unwrap } from '../../lib/queryClient'
import { supabase } from '../../lib/supabase'

/** Whether the user is a platform admin (RLS lets them read only their own `platform_admins` row). */
export async function fetchIsPlatformAdmin(userId: string): Promise<boolean> {
  const row = unwrap(await supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle())
  return row !== null
}
