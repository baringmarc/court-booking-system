// T15.4: site-review wiring. The behavior of validateReview/isLikelyBot is covered in siteForms.test.ts.
import { describe, expect, it } from 'vitest'
import siteReviewSource from '../site-review/index.ts?raw'
import config from '../../config.toml?raw'

describe('site-review wiring', () => {
  const src: string = siteReviewSource

  it('validates with validateReview and drops bots with isLikelyBot', () => {
    expect(src).toMatch(/import\s*{[^}]*\bvalidateReview\b[^}]*}\s*from\s*'\.\.\/_shared\/siteForms\.ts'/)
    expect(src).toMatch(/import\s*{[^}]*\bisLikelyBot\b[^}]*}\s*from\s*'\.\.\/_shared\/siteForms\.ts'/)
    expect(src).toMatch(/isLikelyBot\s*\(/)
    expect(src).toMatch(/validateReview\s*\(/)
  })

  it("inserts into 'reviews' and never sets or marks approved", () => {
    expect(src).toMatch(/\.from\('reviews'\)\s*\.insert/)
    expect(src).not.toMatch(/approved/)
  })

  it('uses the thank-you message and a 400 for invalid input', () => {
    expect(src).toContain('Thank you! Your review will appear once we have checked it.')
    expect(src).toMatch(/400/)
    expect(src).toMatch(/500/)
  })

  it('is public: verify_jwt is false in config.toml', () => {
    const start = config.indexOf('[functions.site-review]')
    expect(start).toBeGreaterThan(-1)
    const rest = config.slice(start + 1)
    const next = rest.indexOf('\n[')
    const section = rest.slice(0, next === -1 ? undefined : next)
    expect(section).toMatch(/verify_jwt\s*=\s*false/)
  })
})
