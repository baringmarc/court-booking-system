// Social link platforms (T9.11g). The hosts mirror the venue_social_links_platform_host check in the database.
import type { Enums } from '../../lib/database.types'

export type SocialPlatform = Enums<'venue_social_platform'>

const PATH = '([/?#][^\\s<>"]*)?$'
const hostPattern = (hosts: string) => new RegExp(`^https://([a-z0-9-]+\\.)*(${hosts})${PATH}`, 'i')

export const SOCIAL_PLATFORMS: readonly { platform: SocialPlatform; label: string; example: string; pattern: RegExp }[] = [
  { platform: 'facebook', label: 'Facebook', example: 'https://www.facebook.com/yourpage', pattern: hostPattern('facebook\\.com|fb\\.com') },
  { platform: 'instagram', label: 'Instagram', example: 'https://www.instagram.com/yourpage', pattern: hostPattern('instagram\\.com') },
  { platform: 'tiktok', label: 'TikTok', example: 'https://www.tiktok.com/@yourpage', pattern: hostPattern('tiktok\\.com') },
  { platform: 'youtube', label: 'YouTube', example: 'https://www.youtube.com/@yourpage', pattern: hostPattern('youtube\\.com|youtu\\.be') },
  { platform: 'x', label: 'X', example: 'https://x.com/yourpage', pattern: hostPattern('x\\.com|twitter\\.com') },
  { platform: 'messenger', label: 'Messenger', example: 'https://m.me/yourpage', pattern: hostPattern('m\\.me|messenger\\.com') },
  { platform: 'website', label: 'Website', example: 'https://www.example.com', pattern: new RegExp(`^https://[a-z0-9-]+(\\.[a-z0-9-]+)+(:[0-9]{1,5})?${PATH}`, 'i') },
]

export const SOCIAL_URL_MAX = 500

/** Null when the URL is fine for that platform, otherwise what to fix. */
export function socialUrlProblem(platform: SocialPlatform, url: string): string | null {
  const entry = SOCIAL_PLATFORMS.find((p) => p.platform === platform)!
  if (url.length > SOCIAL_URL_MAX) return `${entry.label}: keep the link under ${SOCIAL_URL_MAX} characters.`
  if (!entry.pattern.test(url)) return `${entry.label}: use an https:// link like ${entry.example}.`
  return null
}
