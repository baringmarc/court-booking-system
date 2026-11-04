import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { useVenueSettings } from '../catalog/hooks'
import { LocationSection } from './LocationSection'
import { CitySection } from './CitySection'
import { SettingsCategoryPage } from './SettingsCategoryPage'
import { SocialLinksSection } from './SocialLinksSection'
import { VenueProfileForm } from './SettingsPage'

export function VenueProfileSettingsPage() {
  const settings = useVenueSettings()
  return <SettingsCategoryPage title="Venue Profile">
    {settings.isPending ? <PageLoader /> : settings.isError ? <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} /> : <div className="page-sections">
      <VenueProfileForm initial={settings.data} />
      <CitySection key={settings.data.venue_id} settings={settings.data} />
      <LocationSection settings={settings.data} />
      <SocialLinksSection />
    </div>}
  </SettingsCategoryPage>
}
