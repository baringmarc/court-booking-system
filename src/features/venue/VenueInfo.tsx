import { AtSign, Globe, MapPin, MessageCircle, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { SimpleMarkdown } from '../../components/SimpleMarkdown'
import { shownAmenities } from './amenities'
import type { Amenity, InfoSection, SocialLink } from './api'
import { useAmenities, useInfoSections, useSocialLinks } from './hooks'
import { MAPS_EMBED_KEY, mapEmbedUrl, mapQueryOf, mapsSearchUrl } from './map'
import { infoSectionAnchor } from './sections'
import { SOCIAL_PLATFORMS, type SocialPlatform } from './social'

// Player-side venue info (T9.11i). Each part renders nothing while loading, on error or when empty: it's
// extra information around the booking flow, never something that blocks it.

export function AmenityChips() {
  const amenities = useAmenities()
  return amenities.data && amenities.data.length > 0 ? <AmenityList rows={amenities.data} /> : null
}

export function AmenityList({ rows }: { rows: Amenity[] }) {
  return (
    <section className="venue-block" aria-labelledby="amenities-title">
      <h2 id="amenities-title">Amenities</h2>
      <ul className="amenity-chips">
        {shownAmenities(rows).map(({ id, label, icon: Icon }) => (
          <li key={id} className="amenity-chip"><Icon className="amenity-icon" aria-hidden="true" />{label}</li>
        ))}
      </ul>
    </section>
  )
}

/** The address, an embedded map (lazy) and "Open in Google Maps", plus the social links. Hidden with no address. */
export function VenueLocation({ venueName, address, mapsQuery }: { venueName: string; address: string; mapsQuery: string }) {
  const socials = useSocialLinks()
  const query = mapQueryOf({ address, maps_query: mapsQuery })
  if (!query) return null
  return (
    <section className="card stack venue-block" aria-labelledby="location-title">
      <h2 id="location-title">Location</h2>
      {address.trim() && (
        <p className="venue-address"><MapPin className="amenity-icon" aria-hidden="true" /><span className="pre-line">{address.trim()}</span></p>
      )}
      <iframe className="map-frame" title={`Map of ${venueName}`} src={mapEmbedUrl(query, MAPS_EMBED_KEY)} loading="lazy" />
      <div className="form-actions">
        <a className="btn btn-outline" href={mapsSearchUrl(query)} target="_blank" rel="noopener noreferrer">
          Open in Google Maps{' '}<span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      {socials.data && socials.data.length > 0 && <SocialLinkList links={socials.data} />}
    </section>
  )
}

const SOCIAL_ICONS: Record<SocialPlatform, LucideIcon> = {
  facebook: AtSign, instagram: AtSign, tiktok: AtSign, youtube: AtSign, x: AtSign, messenger: MessageCircle, website: Globe,
}

/** Labelled links in the platforms' fixed order (brand logos aren't used: generic icons, readable names). */
export function SocialLinkList({ links, className = 'social-links' }: { links: SocialLink[]; className?: string }) {
  const shown = SOCIAL_PLATFORMS.filter(({ platform }) => links.some((l) => l.platform === platform))
  return (
    <ul className={className} aria-label="Social links">
      {shown.map(({ platform, label }) => {
        const Icon = SOCIAL_ICONS[platform]
        return (
          <li key={platform}>
            <a href={links.find((l) => l.platform === platform)!.url} target="_blank" rel="noopener noreferrer">
              <Icon className="social-icon" aria-hidden="true" />{label}{' '}<span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/** The footer's social links, on every public page. */
export function FooterSocials() {
  const socials = useSocialLinks()
  return socials.data && socials.data.length > 0 ? <SocialLinkList links={socials.data} className="social-links footer-socials" /> : null
}

export function InfoSections() {
  const sections = useInfoSections()
  return sections.data && sections.data.length > 0 ? <InfoSectionList sections={sections.data} /> : null
}

/** Expandable panels at the bottom of the home page. A link to "#info-<id>" opens that panel and scrolls to it. */
export function InfoSectionList({ sections }: { sections: InfoSection[] }) {
  const { hash } = useLocation()
  const target = hash.slice(1)

  useEffect(() => {
    if (!target.startsWith('info-')) return
    const scroll = () => document.getElementById(target)?.scrollIntoView({ block: 'start' })
    scroll()
    // A cold load (a new tab from checkout): photos above can still push it down, so again once the page has loaded.
    if (document.readyState === 'complete') return
    window.addEventListener('load', scroll, { once: true })
    return () => window.removeEventListener('load', scroll)
  }, [target])

  return (
    <section className="venue-block stack" aria-labelledby="info-title">
      <h2 id="info-title">Good to know</h2>
      {sections.map((s) => {
        const anchor = infoSectionAnchor(s.id)
        return (
          <details key={s.id} id={anchor} className="card info-panel" open={anchor === target || undefined}>
            <summary>{s.title}</summary>
            {s.body.trim() ? <div className="info-body"><SimpleMarkdown text={s.body} /></div> : null}
          </details>
        )
      })}
    </section>
  )
}

/**
 * Checkout's link to the cancellation and refund policy (a new tab keeps the form): the first section whose title
 * mentions "cancel" (the admin page says so). None, no link.
 */
export function CancellationPolicyLink() {
  const sections = useInfoSections()
  const policy = sections.data?.find((s) => /cancel/i.test(s.title))
  if (!policy) return null
  return (
    <p className="small">
      <a href={`/#${infoSectionAnchor(policy.id)}`} target="_blank" rel="noopener noreferrer">
        {policy.title}{' '}<span className="sr-only">(opens in a new tab)</span>
      </a>
    </p>
  )
}
