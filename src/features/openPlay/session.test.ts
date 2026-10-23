import { describe, expect, it } from 'vitest'
import { isHttpsUrl, linksFromRows, sessionTimeLabel, toLinks } from './session'

describe('isHttpsUrl', () => {
  it('accepts https addresses with a host only', () => {
    expect(isHttpsUrl('https://forms.gle/abc')).toBe(true)
    expect(isHttpsUrl('https://reclub.co/m/x?ref=1')).toBe(true)
    expect(isHttpsUrl('http://forms.gle/abc')).toBe(false)
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpsUrl('/relative')).toBe(false)
    expect(isHttpsUrl('https://localhost')).toBe(false)
  })
})

describe('toLinks', () => {
  it('keeps labelled https links and drops anything else', () => {
    expect(toLinks([
      { label: ' RSVP ', url: 'https://forms.gle/abc' },
      { label: 'Bad', url: 'javascript:alert(1)' },
      { label: '', url: 'https://a.test' },
      'junk',
    ])).toEqual([{ label: 'RSVP', url: 'https://forms.gle/abc' }])
    expect(toLinks(null)).toEqual([])
  })
})

describe('linksFromRows', () => {
  it('skips empty rows and trims', () => {
    expect(linksFromRows([{ label: ' RSVP ', url: ' https://forms.gle/abc ' }, { label: '', url: '' }]))
      .toEqual({ links: [{ label: 'RSVP', url: 'https://forms.gle/abc' }], error: null })
  })

  it('reports a half-filled or non-https row', () => {
    expect(linksFromRows([{ label: '', url: 'https://a.test' }]).error).toBe('Link 1 needs a label.')
    expect(linksFromRows([{ label: '', url: '' }, { label: 'RSVP', url: 'http://a.test' }]).error)
      .toBe('Link 2 needs an address starting with https://.')
  })
})

describe('sessionTimeLabel', () => {
  it('shows the start date and the hour range in the venue zone', () => {
    // 2030-01-05 (a Saturday) 13:00–15:00 Manila
    expect(sessionTimeLabel('2030-01-05T05:00:00.000Z', '2030-01-05T07:00:00.000Z', 'Asia/Manila')).toBe('Sat, Jan 5 · 1 PM – 3 PM')
    expect(sessionTimeLabel('2030-01-05T14:00:00.000Z', '2030-01-05T16:00:00.000Z', 'Asia/Manila')).toBe('Sat, Jan 5 · 10 PM – 12 AM')
    expect(sessionTimeLabel('2030-01-05T14:00:00.000Z', '2030-01-05T18:00:00.000Z', 'Asia/Manila')).toBe('Sat, Jan 5 · 10 PM – 2 AM (next day)')
  })
})
