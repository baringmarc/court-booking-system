// PH mobile numbers (SPEC §10 2026-10-28, T11.17). Mirrors private.normalize_ph_mobile, which has the final say:
// a 11-digit 09XXXXXXXXX, from spaces, dots, dashes, brackets, +63/63 or a bare 10-digit 9… number.

export const PHONE_ERROR = 'Enter an 11-digit mobile number, like 09171234567.'

/** The stored form of a phone: `09…`, null when blank, or 'invalid' for anything the database would refuse. */
export function normalizePhMobile(input: string): string | null | 'invalid' {
  const v = input.replace(/[\s.()-]/g, '')
  if (v === '') return null
  if (/^09\d{9}$/.test(v)) return v
  const m = /^(?:\+?63)?(9\d{9})$/.exec(v)
  return m ? `0${m[1]}` : 'invalid'
}
