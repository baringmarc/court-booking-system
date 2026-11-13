import { useState } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { errorMessage } from '../../lib/errors'
import type { PaymentAccount } from '../venue/api'
import { usePaymentAccounts } from '../venue/hooks'
import { useDeletePaymentAccount, useReorderPaymentAccounts, useSavePaymentAccount } from './hooks'
import { AccountForm } from './PaymentAccountForm'
import { SortableList } from './SortableList'
import { useSettingsDirty } from './settingsDraft'

export const PAYMENT_ACCOUNTS_MAX = 10

/** Payment accounts with optional QR codes (T11.11): add, edit, delete and reorder. Players see them while paying. */
export function PaymentAccountsSection() {
  const accounts = usePaymentAccounts()
  const save = useSavePaymentAccount()
  const add = useSavePaymentAccount() // its own, so an open edit form never shows the add form's state
  const remove = useDeletePaymentAccount()
  const move = useReorderPaymentAccounts()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addKey, setAddKey] = useState(0) // bumped after adding, so the add form empties
  const setEditDirty = useSettingsDirty(`payment-accounts:edit:${editingId ?? ''}`)
  const setAddDirty = useSettingsDirty('payment-accounts:add')

  function startEdit(id: string | null) {
    save.reset()
    setEditingId(id)
  }

  function handleDelete(account: PaymentAccount) {
    if (window.confirm(`Delete ${account.label}? Players will no longer see it.`)) remove.mutate(account)
  }

  return (
    <section className="card stack" aria-labelledby="payment-accounts-heading">
      <h2 id="payment-accounts-heading">Payment accounts</h2>
      <p className="muted small">
        Where players send their payment, shown above the payment instructions in this order. Add a QR code so they can
        scan it in GCash, Maya or their bank app.
      </p>
      {accounts.isPending ? (
        <PageLoader />
      ) : accounts.isError ? (
        <ErrorMessage error={accounts.error} onRetry={() => accounts.refetch()} />
      ) : (
        <>
          {accounts.data.length === 0 ? (
            <p className="muted">No payment accounts yet. Players see only the payment instructions.</p>
          ) : (
            <SortableList
              className="list order-list"
              label="Payment accounts in order"
              items={accounts.data}
              disabled={editingId !== null}
              onReorder={(ids) => move.mutate(ids)}
              renderItem={(a) => editingId === a.id ? (
                <AccountForm key={a.id} dirtyKey={`payment-accounts:edit:${a.id}`} initial={a} label={`Edit ${a.label}`} saving={save.isPending} error={save.error}
                  onCancel={() => { setEditDirty(false); startEdit(null) }}
                  onSave={(input, qr) => save.mutate({ existing: a, input, qr }, { onSuccess: () => { setEditingId(null); setEditDirty(false) } })} />
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
          {accounts.data.length >= PAYMENT_ACCOUNTS_MAX ? (
            <p className="muted">You can list up to {PAYMENT_ACCOUNTS_MAX} accounts. Delete one to add another.</p>
          ) : (
            <AccountForm key={addKey} dirtyKey="payment-accounts:add" initial={null} label="New payment account" saving={add.isPending} error={add.error}
              onSave={(input, qr) => add.mutate({ existing: null, input, qr }, { onSuccess: () => { add.reset(); setAddKey((k) => k + 1); setAddDirty(false) } })} />
          )}
        </>
      )}
    </section>
  )
}
