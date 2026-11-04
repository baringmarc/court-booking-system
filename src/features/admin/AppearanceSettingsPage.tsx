import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { useVenueSettings } from '../catalog/hooks'
import { AmenitiesSection } from './AmenitiesSection'
import { BannerSection } from './BannerSection'
import { InfoSectionsSection } from './InfoSectionsSection'
import { SettingsCategoryPage } from './SettingsCategoryPage'
import { SportOrderSection } from './SportOrderSection'
import { ThemePicker } from './ThemePicker'

export function AppearanceSettingsPage() {
  const settings = useVenueSettings()
  return <SettingsCategoryPage title="Website Appearance">
    {settings.isPending ? <PageLoader /> : settings.isError ? <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} /> : <div className="page-sections">
      <ThemePicker settings={settings.data} />
      <BannerSection settings={settings.data} />
      <AmenitiesSection />
      <InfoSectionsSection />
      <SportOrderSection settings={settings.data} />
    </div>}
  </SettingsCategoryPage>
}
