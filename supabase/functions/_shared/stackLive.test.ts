import { describe, expect, it } from 'vitest'
import { parseStackLiveBody, stackLiveFailure } from './stackLive.ts'

describe('parseStackLiveBody', () => {
  it('accepts courts and a title, ignoring turnstileToken', () => {
    expect(parseStackLiveBody({ turnstileToken: 't', courts: 4, title: 'Friday paddle' })).toEqual({ ok: true, courts: 4, title: 'Friday paddle' })
  })
  it('accepts a body without a title as title null', () => {
    expect(parseStackLiveBody({ turnstileToken: 't', courts: 2 })).toEqual({ ok: true, courts: 2, title: null })
  })
  it('accepts a body without a turnstileToken (siteHttp checks it)', () => {
    expect(parseStackLiveBody({ courts: 2 })).toEqual({ ok: true, courts: 2, title: null })
  })
  it.each([1, 12])('accepts courts %i (the bounds)', (courts) => {
    expect(parseStackLiveBody({ courts })).toEqual({ ok: true, courts, title: null })
  })
  it.each([[0], [13], [-1], [1.5], [Number.NaN], [Infinity], ['2'], [true], [null], [undefined], [[2]], [{}]])('rejects courts %j', (courts) => {
    expect(parseStackLiveBody({ turnstileToken: 't', courts })).toEqual({ ok: false })
  })
  it('rejects a body with no courts', () => {
    expect(parseStackLiveBody({ turnstileToken: 't', title: 'x' })).toEqual({ ok: false })
  })
  it('trims the title', () => {
    expect(parseStackLiveBody({ courts: 2, title: '   Spaced out  ' })).toEqual({ ok: true, courts: 2, title: 'Spaced out' })
  })
  it.each(['', '   ', '\n\t '])('turns the blank title %j into null', (title) => {
    expect(parseStackLiveBody({ courts: 2, title })).toEqual({ ok: true, courts: 2, title: null })
  })
  it('accepts a title of exactly 60 characters', () => {
    const title = 'a'.repeat(60)
    expect(parseStackLiveBody({ courts: 2, title })).toEqual({ ok: true, courts: 2, title })
  })
  it('accepts 60 characters plus surrounding spaces (length is counted after trimming)', () => {
    const title = 'b'.repeat(60)
    expect(parseStackLiveBody({ courts: 2, title: `  ${title}  ` })).toEqual({ ok: true, courts: 2, title })
  })
  it('rejects a title of 61 characters', () => {
    expect(parseStackLiveBody({ courts: 2, title: 'a'.repeat(61) })).toEqual({ ok: false })
  })
  it.each([[42], [true], [['x']], [{}]])('rejects the non-string title %j', (title) => {
    expect(parseStackLiveBody({ courts: 2, title })).toEqual({ ok: false })
  })
  it.each([[null], [undefined], ['courts'], [2], [true], [[]], [[{ courts: 2 }]]])('rejects the non-object body %j', (raw) => {
    expect(parseStackLiveBody(raw)).toEqual({ ok: false })
  })
})

describe('stackLiveFailure', () => {
  it('maps invalid_input to 400', () => {
    expect(stackLiveFailure('invalid_input')).toEqual({ status: 400, error: 'invalid_input' })
  })
  it('maps busy to 409', () => {
    expect(stackLiveFailure('busy')).toEqual({ status: 409, error: 'busy' })
  })
  it.each([['forbidden'], ['not_found'], [''], [null], [undefined], ['INVALID_INPUT']])('maps %j to 500 server_error', (hint) => {
    expect(stackLiveFailure(hint)).toEqual({ status: 500, error: 'server_error' })
  })
})
