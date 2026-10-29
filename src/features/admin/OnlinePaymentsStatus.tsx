/** The venue's online payments switch (T11.22), read-only: Plotline turns it on once the venue's PayMongo is ready. */
export function OnlinePaymentsStatus({ enabled }: { enabled: boolean }) {
  return (
    <section className="card stack" aria-labelledby="online-payments-heading">
      <h2 id="online-payments-heading">Online payments</h2>
      <p>Online payments (PayMongo): {enabled ? 'On' : 'Off'}. Managed by Plotline.</p>
    </section>
  )
}
