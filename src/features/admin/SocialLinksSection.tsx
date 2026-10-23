import { useState, type FormEvent } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { SaveStatus } from '../../components/SaveStatus'
import type { SocialLink } from '../venue/api'
import { useSocialLinks } from '../venue/hooks'
import { SOCIAL_PLATFORMS, SOCIAL_URL_MAX, socialUrlProblem, type SocialPlatform } from '../venue/social'
import { useSaveSocialLinks } from './hooks'

/** One optional link per platform (T9.11h). The database checks each platform's hosts too. */
export function SocialLinksSection() {
  const links = useSocialLinks()
  // Here, not in the form: the form remounts with the saved links, and "Saved" should outlive that.
  const save = useSaveSocialLinks()
  return (
    <section className="card stack" aria-labelledby="socials-heading">
      <h2 id="socials-heading">Social links</h2>
      <p className="muted small">Shown to players as links. Leave a platform empty to hide it.</p>
      {links.isPending ? (
        <PageLoader />
      ) : links.isError ? (
        <ErrorMessage error={links.error} onRetry={() => links.refetch()} />
      ) : (
        <SocialLinksForm key={links.dataUpdatedAt} initial={links.data} save={save} />
      )}
    </section>
  )
}

function byPlatform(value: (platform: SocialPlatform) => string): Record<SocialPlatform, string> {
  return Object.fromEntries(SOCIAL_PLATFORMS.map(({ platform }) => [platform, value(platform)])) as Record<SocialPlatform, string>
}

function SocialLinksForm({ initial, save }: { initial: SocialLink[]; save: ReturnType<typeof useSaveSocialLinks> }) {
  const [values, setValues] = useState(() => byPlatform((platform) => initial.find((l) => l.platform === platform)?.url ?? ''))
  const [problem, setProblem] = useState<{ platform: SocialPlatform; message: string } | null>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = byPlatform((platform) => values[platform].trim())
    for (const { platform } of SOCIAL_PLATFORMS) {
      const message = trimmed[platform] ? socialUrlProblem(platform, trimmed[platform]) : null
      if (message) {
        setProblem({ platform, message })
        return
      }
    }
    setProblem(null)
    save.mutate(trimmed)
  }

  return (
    <form className="stack" aria-label="Social links" onSubmit={handleSubmit}>
      <div className="form-grid">
        {SOCIAL_PLATFORMS.map(({ platform, label, example }) => (
          <label key={platform} className="field">
            <span>{label}</span>
            <input type="url" inputMode="url" maxLength={SOCIAL_URL_MAX} placeholder={example} value={values[platform]}
              aria-invalid={problem?.platform === platform || undefined}
              onChange={(e) => setValues((v) => ({ ...v, [platform]: e.target.value }))} />
          </label>
        ))}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save links'}</button>
        {problem ? <span className="form-error" role="alert">{problem.message}</span> : <SaveStatus isSuccess={save.isSuccess} error={save.error} />}
      </div>
    </form>
  )
}
