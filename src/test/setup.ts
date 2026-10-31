import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { setCurrentVenue } from '../lib/currentVenue'

// jsdom has no <dialog> methods (T9.11d). Open and close it like a browser (opening focuses the first focusable
// element inside), minus focus trapping and the browser's own Escape, which the e2e flows cover in Chromium.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
    this.querySelector<HTMLElement>('[autofocus], button:not([disabled]), a[href], input, select, textarea')?.focus()
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}

// Pages run inside a resolved venue (VenueProvider, T13.3); tests start in this one.
beforeEach(() => {
  setCurrentVenue({ id: '00000000-0000-4000-8000-0000000000a1', slug: 'claudex-courts', status: 'active' })
})

afterEach(() => {
  cleanup()
})
