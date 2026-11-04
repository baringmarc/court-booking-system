import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { useVenueSettings } from '../catalog/hooks'
import { SettingsCategoryPage } from './SettingsCategoryPage'
import { WaiverSection } from './WaiverSection'

export function PoliciesSettingsPage() {
  const settings = useVenueSettings()
  return <SettingsCategoryPage title="Policies & Waivers">
    {settings.isPending ? <PageLoader /> : settings.isError ? <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} /> : <WaiverSection settings={settings.data} />}
  </SettingsCategoryPage>
}
