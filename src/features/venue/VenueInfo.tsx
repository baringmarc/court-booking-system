import { MapPin } from 'lucide-react'
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { SocialIcon } from '../../components/BrandIcons'
import { SimpleMarkdown } from '../../components/SimpleMarkdown'
import { shownAmenities } from './amenities'
import type { Amenity, InfoSection, SocialLink } from './api'
import { useAmenities, useInfoSections, useSocialLinks } from './hooks'
import { MAPS_EMBED_KEY, mapEmbedUrl, mapQueryOf, mapsSearchUrl } from './map'
import { infoSectionAnchor } from './sections'
import { SOCIAL_PLATFORMS } from './social'

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

/** The address, an embedded map (lazy) and "Open in Google Maps". Hidden with no address. The social links are in
    the footer's "Stay connected" band (T11.4). */
export function VenueLocation({ venueName, address, mapsQuery }: { venueName: string; address: string; mapsQuery: string }) {
  const query = mapQueryOf({ address, maps_query: mapsQuery })
  if (!query) return null
  return (
    <section className="card stack venue-block" aria-labelledby="location-title">
      <h2 id="location-title" className="card-head">Location</h2>
      {address.trim() && (
        <p className="venue-address"><MapPin className="amenity-icon" aria-hidden="true" /><span className="pre-line">{address.trim()}</span></p>
      )}
      <iframe className="map-frame" title={`Map of ${venueName}`} src={mapEmbedUrl(query, MAPS_EMBED_KEY)} loading="lazy" />
      <div className="form-actions">
        <a className="btn btn-outline" href={mapsSearchUrl(query)} target="_blank" rel="noopener noreferrer">
          Open in Google Maps{' '}<span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
    </section>
  )
}

/** A card per link in the platforms' fixed order: the platform's logo in a round chip, then its name. */
export function SocialLinkList({ links }: { links: SocialLink[] }) {
  const shown = SOCIAL_PLATFORMS.filter(({ platform }) => links.some((l) => l.platform === platform))
  return (
    <ul className="social-cards" aria-label="Social links">
      {shown.map(({ platform, label }) => (
        <li key={platform}>
          <a className="social-card" href={links.find((l) => l.platform === platform)!.url} target="_blank" rel="noopener noreferrer">
            <span className="social-chip"><SocialIcon platform={platform} className="social-icon" /></span>
            {label}{' '}<span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

/** The "Stay connected" band at the top of the footer, on every public page (T11.4). Nothing without links. */
export function StayConnected() {
  const socials = useSocialLinks()
  if (!socials.data || socials.data.length === 0) return null
  return (
    <section className="connect" aria-labelledby="connect-title">
      <p className="connect-eyebrow">Stay connected</p>
      <h2 id="connect-title">Connect with us</h2>
      <p className="connect-lead">Follow us on social media for schedules, events, announcements and community updates.</p>
      <SocialLinkList links={socials.data} />
    </section>
  )
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
    <section className="venue-block stack info-list" aria-labelledby="info-title">
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
