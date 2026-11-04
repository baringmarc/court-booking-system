import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { useVenueSettings } from '../catalog/hooks'
import { OnlinePaymentsStatus } from './OnlinePaymentsStatus'
import { PaymentAccountsSection } from './PaymentAccountsSection'
import { PaymentInstructionsForm } from './SettingsPage'
import { SettingsCategoryPage } from './SettingsCategoryPage'

export function PaymentSettingsPage() {
  const settings = useVenueSettings()
  return <SettingsCategoryPage title="Payment Setup">
    {settings.isPending ? <PageLoader /> : settings.isError ? <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} /> : <div className="page-sections">
      <PaymentAccountsSection />
      <PaymentInstructionsForm initial={settings.data} />
      <OnlinePaymentsStatus enabled={settings.data.online_payments_enabled} />
    </div>}
  </SettingsCategoryPage>
}
