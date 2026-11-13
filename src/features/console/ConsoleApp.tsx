import { Navigate, Route, Routes } from 'react-router-dom'
import { BillingPage } from './BillingPage'
import { ConsoleGuard } from './ConsoleGuard'
import { ConsoleLayout } from './ConsoleLayout'
import { InvoicesPage } from './InvoicesPage'
import { LeadsPage } from './LeadsPage'
import { ReviewsPage } from './ReviewsPage'
import { VenuesPage } from './VenuesPage'

/** The platform console's routes (T17.19). The router itself comes from `mountConsole` (tests use a MemoryRouter). */
export function ConsoleApp() {
  return (
    <ConsoleGuard>
      <Routes>
        <Route element={<ConsoleLayout />}>
          <Route path="leads" element={<LeadsPage />} />
          <Route path="venues" element={<VenuesPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="*" element={<Navigate to="/leads" replace />} />
        </Route>
      </Routes>
    </ConsoleGuard>
  )
}
