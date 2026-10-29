import { useState, type FormEvent } from 'react'
import { normalizePhMobile } from '../../lib/phone'
import { validateContact, type Contact, type ContactErrors } from './contact'

type Props = {
  initial: Contact
  /** Guests type their email; logged-in players see their account email, read-only. */
  isGuest: boolean
  pending: boolean
  /** The venue's waiver (T11.20); blank (the default) means none to accept. */
  waiverText?: string
  onSubmit: (contact: Contact, waiverAccepted: boolean) => void
}

export function CheckoutForm({ initial, isGuest, pending, waiverText = '', onSubmit }: Props) {
  const [contact, setContact] = useState<Contact>(initial)
  const [errors, setErrors] = useState<ContactErrors>({})
  const hasWaiver = waiverText.trim() !== ''
  const [accepted, setAccepted] = useState(false)
  const [waiverError, setWaiverError] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const next = validateContact(contact, { isGuest })
    setErrors(next)
    const waiverMissing = hasWaiver && !accepted
    setWaiverError(waiverMissing)
    if (Object.keys(next).length === 0 && !waiverMissing) {
      // validateContact refused 'invalid', so this is the stored 09… form or blank.
      onSubmit({ name: contact.name.trim(), email: contact.email.trim(), phone: normalizePhMobile(contact.phone) ?? '' }, hasWaiver && accepted)
    }
  }

  const field = (key: keyof Contact) => ({
    id: `checkout-${key}`,
    value: contact[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setContact((c) => ({ ...c, [key]: e.target.value })),
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `checkout-${key}-error` : undefined,
  })

  // Errors sit outside the <label> so they don't become part of the field's accessible name.
  const error = (key: keyof Contact) =>
    errors[key] && <p id={`checkout-${key}-error`} className="form-error">{errors[key]}</p>

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="checkout-name">Name</label>
        <input autoComplete="name" {...field('name')} />
        {error('name')}
      </div>
      <div className="field">
        <label htmlFor="checkout-email">Email</label>
        {isGuest ? (
          <input type="email" autoComplete="email" inputMode="email" {...field('email')} />
        ) : (
          <input id="checkout-email" type="email" value={contact.email} readOnly aria-readonly="true" />
        )}
        {error('email')}
      </div>
      <div className="field">
        <label htmlFor="checkout-phone">Mobile number (optional)</label>
        <input type="tel" autoComplete="tel" inputMode="tel" {...field('phone')}
          aria-describedby={['checkout-phone-hint', errors.phone && 'checkout-phone-error'].filter(Boolean).join(' ')} />
        <p id="checkout-phone-hint" className="muted small">
          The venue uses it only to reach you about your booking.{!isGuest && ' Leave blank to use the number on your profile.'}
        </p>
        {error('phone')}
      </div>
      {hasWaiver && (
        <section className="stack" aria-labelledby="checkout-waiver-heading">
          <h3 id="checkout-waiver-heading">Waiver</h3>
          <p className="prewrap">{waiverText}</p>
          <label className="check">
            <input type="checkbox" checked={accepted}
              aria-invalid={waiverError ? true : undefined} aria-describedby={waiverError ? 'checkout-waiver-error' : undefined}
              onChange={(e) => { setAccepted(e.target.checked); if (e.target.checked) setWaiverError(false) }} />
            <span>I have read and accept the waiver</span>
          </label>
          {waiverError && <p id="checkout-waiver-error" className="form-error">Tick the box to accept the waiver.</p>}
        </section>
      )}
      <button type="submit" className="btn btn-block" disabled={pending}>
        {pending ? 'Reserving…' : 'Confirm booking'}
      </button>
    </form>
  )
}
