// Guest links carry the private token in the URL fragment (`#token=…`), which browsers never send to
// servers, so it stays out of hosting logs and analytics (SPEC §6, RESEARCH "Guest token flow hardening").
// Links handed out before M5 used `?token=…`; those still work and are rewritten to the fragment.

export type GuestToken = {
  /** The token, '' for a cut-off link (still read as a guest, so it shows "not found"), or null for none. */
  token: string | null
  /** Set when the token came from the legacy query string: where to redirect so it moves to the fragment. */
  rewriteTo: { search: string; hash: string } | null
}

export function readGuestToken(search: string, hash: string): GuestToken {
  const fromHash = new URLSearchParams(hash.replace(/^#/, '')).get('token')
  const query = new URLSearchParams(search)
  const fromQuery = query.get('token')

  if (fromQuery === null) return { token: fromHash, rewriteTo: null }

  // Drop the token from the query either way; the fragment wins when both are present.
  query.delete('token')
  const token = fromHash ?? fromQuery
  const rest = query.toString()
  return { token, rewriteTo: { search: rest ? `?${rest}` : '', hash: tokenHash(token) } }
}

export function tokenHash(token: string) {
  return `#token=${encodeURIComponent(token)}`
}

/** The private link a guest saves: `/booking/CB-XXXXXX#token=…`. */
export function guestBookingPath(referenceCode: string, token: string) {
  return `/booking/${referenceCode}${tokenHash(token)}`
}
