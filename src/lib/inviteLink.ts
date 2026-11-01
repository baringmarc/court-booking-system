// An owner invite (`auth.admin.inviteUserByEmail`) or the resend that follows it (an admin-generated magic link, T14.5d)
// can only be sent as an implicit-flow link: the session arrives in the URL hash. The client is PKCE (Google, sign-up), and a PKCE client rejects such a hash, so the invitee would land
// signed out. The client is told to ignore invite hashes, and `consumeInviteLink` signs the invitee in before render.

type InviteParams = Record<string, string | undefined>

const LINK_TYPES = ['invite', 'magiclink']

/** The tokens of an invite or sign-in link's hash, or null for any other hash. */
export function parseInviteHash(hash: string): { accessToken: string; refreshToken: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!LINK_TYPES.includes(params.get('type') ?? '') || !accessToken || !refreshToken) return null
  return { accessToken, refreshToken }
}

/** True for the URL params of an invite link, which the client must leave alone (`consumeInviteLink` handles it). */
export function isInviteCallback(params: InviteParams): boolean {
  return LINK_TYPES.includes(params.type ?? '') && Boolean(params.access_token && params.refresh_token)
}

type AuthLike = { auth: { setSession(tokens: { access_token: string; refresh_token: string }): Promise<unknown> } }
type LocationLike = { hash: string; pathname: string; search: string }
type HistoryLike = { replaceState(data: unknown, unused: string, url: string): void }

/** Signs in with an invite link's tokens, then removes them from the address bar. Never throws. */
export async function consumeInviteLink(
  client: AuthLike,
  location: LocationLike = window.location,
  history: HistoryLike = window.history,
): Promise<void> {
  const tokens = parseInviteHash(location.hash)
  if (!tokens) return
  history.replaceState(null, '', location.pathname + location.search)
  try {
    await client.auth.setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken })
  } catch (e) {
    console.error('Could not sign in from the invite link', e)
  }
}
