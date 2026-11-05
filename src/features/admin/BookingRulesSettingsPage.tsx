import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { useVenueSettings } from '../catalog/hooks'
import { BookingRulesForm } from './SettingsPage'
import { SettingsCategoryPage } from './SettingsCategoryPage'

export function BookingRulesSettingsPage() {
  const settings = useVenueSettings()
  return <SettingsCategoryPage title="Booking Rules">
    {settings.isPending ? <PageLoader /> : settings.isError ? <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} /> : <BookingRulesForm initial={settings.data} />}
  </SettingsCategoryPage>
}
