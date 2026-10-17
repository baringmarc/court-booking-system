// Client-side checks for the checkout contact form. They mirror create_booking's rules so users
// get instant feedback; the server still validates everything.

export type Contact = { name: string; email: string; phone: string }
export type ContactErrors = Partial<Record<keyof Contact, string>>

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Guests must give all three. Logged-in players need a name; email comes from their account. */
export function validateContact(contact: Contact, { isGuest }: { isGuest: boolean }): ContactErrors {
  const errors: ContactErrors = {}
  const name = contact.name.trim()
  const email = contact.email.trim()
  const phone = contact.phone.trim()

  if (!name) errors.name = 'Please enter your name.'
  else if (name.length > 100) errors.name = 'Please use at most 100 characters.'

  if (isGuest) {
    if (!email) errors.email = 'Please enter your email.'
    else if (!EMAIL.test(email) || email.length > 254) errors.email = 'Please enter a valid email address.'
  }

  if (isGuest && !phone) errors.phone = 'Please enter your phone number.'
  else if (phone && (phone.replace(/\D/g, '').length < 7 || phone.length > 30)) errors.phone = 'Please enter a valid phone number.'

  return errors
}
