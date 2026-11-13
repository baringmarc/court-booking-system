import { useState } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { errorMessage } from '../../lib/errors'
import { AccountForm } from '../admin/PaymentAccountForm'
import { SortableList } from '../admin/SortableList'
import type { PlatformPaymentAccount } from './api'
import {
  useDeletePlatformPaymentAccount, usePlatformPaymentAccounts, usePlatformQrUrl, useReorderPlatformPaymentAccounts, useSavePlatformPaymentAccount,
} from './hooks'

/** The platform_payment_accounts limit (T26.3's trigger). */
export const PLATFORM_ACCOUNTS_MAX = 5

/**
 * The console's Billing page (T26.5): where venues pay Plotline. These accounts, with their QR codes, are printed on
 * every invoice PDF, and the invoice-pdf function refuses to send until one exists (`billing_details_missing`).
 */
export function BillingPage() {
  const accounts = usePlatformPaymentAccounts()
  const save = useSavePlatformPaymentAccount()
  const add = useSavePlatformPaymentAccount() // its own, so an open edit form never shows the add form's state
  const remove = useDeletePlatformPaymentAccount()
  const move = useReorderPlatformPaymentAccounts()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addKey, setAddKey] = useState(0) // bumped after adding, so the add form empties

  function startEdit(id: string | null) {
    save.reset()
    setEditingId(id)
  }

  function handleDelete(account: PlatformPaymentAccount) {
    if (window.confirm(`Delete ${account.label}? It will no longer appear on invoices.`)) remove.mutate(account)
  }

  return (
    <div className="stack console-page">
      <h1>Billing</h1>
      <section className="card stack" aria-labelledby="platform-accounts-heading">
        <h2 id="platform-accounts-heading">Plotline payment accounts</h2>
        <p className="muted small">
          Where venues pay Plotline. These accounts appear, in this order, on every invoice PDF, with their QR codes.
          Sending an invoice is blocked until at least one account exists.
        </p>
        {accounts.isPending ? (
          <PageLoader />
        ) : accounts.isError ? (
          <ErrorMessage error={accounts.error} onRetry={() => accounts.refetch()} />
        ) : (
          <>
            {accounts.data.length === 0 ? (
              <p className="muted">No payment accounts yet. Invoices cannot be sent until you add one.</p>
            ) : (
              <SortableList
                className="list order-list"
                label="Payment accounts in order"
                items={accounts.data}
                disabled={editingId !== null}
                onReorder={(ids) => move.mutate(ids)}
                renderItem={(a) => editingId === a.id ? (
                  <EditAccount key={a.id} account={a} saving={save.isPending} error={save.error}
                    onCancel={() => startEdit(null)}
                    onSave={(input, qr) => save.mutate({ existing: a, input, qr }, { onSuccess: () => setEditingId(null) })} />
                ) : (
                  <span className="list-row">
                    <span className="account-summary">
                      <strong>{a.label}</strong>
                      <span className="muted small">{[a.account_name, a.account_number].filter(Boolean).join(' · ') || 'No account details'}</span>
                      {a.qr_path && <span className="badge">QR</span>}
                    </span>
                    <span className="list-row-end">
                      <button type="button" className="btn btn-small btn-outline" aria-label={`Edit ${a.label}`}
                        disabled={editingId !== null} onClick={() => startEdit(a.id)}>Edit</button>
                      <button type="button" className="btn btn-small btn-ghost" aria-label={`Delete ${a.label}`}
                        disabled={remove.isPending} onClick={() => handleDelete(a)}>Delete</button>
                    </span>
                  </span>
                )}
              />
            )}
            {(remove.error || move.error) && <p className="form-error" role="alert">{errorMessage(remove.error ?? move.error)}</p>}
            <h3>Add an account</h3>
            {accounts.data.length >= PLATFORM_ACCOUNTS_MAX ? (
              <p className="muted">You can list up to {PLATFORM_ACCOUNTS_MAX} accounts. Delete one to add another.</p>
            ) : (
              <AccountForm key={addKey} dirtyKey="platform-accounts:add" initial={null} label="New payment account" saving={add.isPending} error={add.error}
                onSave={(input, qr) => add.mutate({ existing: null, input, qr }, { onSuccess: () => { add.reset(); setAddKey((k) => k + 1) } })} />
            )}
          </>
        )}
      </section>
    </div>
  )
}

/** The edit form, with the saved QR shown through a signed URL (the bucket is private). */
function EditAccount({ account, ...props }: Omit<Parameters<typeof AccountForm>[0], 'initial' | 'label' | 'dirtyKey' | 'qrSrc'> & { account: PlatformPaymentAccount }) {
  const qrUrl = usePlatformQrUrl(account.qr_path)
  return (
    <AccountForm {...props} initial={account} label={`Edit ${account.label}`} dirtyKey={`platform-accounts:edit:${account.id}`}
      qrSrc={qrUrl.data ?? null} />
  )
}
