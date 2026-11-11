-- T20.2: two new venue theme presets, `slate` and `midnight` (T20.1, RESEARCH "Milestone 20"). Expand only: the check
-- is widened, no row changes and the default stays 'plotline'. The deployed frontend falls back to the default for a
-- key it doesn't know (isThemePreset in src/lib/themes.ts), so this ships before any frontend that offers the new keys.
-- venue_settings has one row per venue, so the ACCESS EXCLUSIVE lock and the re-validation are brief.
alter table public.venue_settings drop constraint venue_settings_theme_preset;

alter table public.venue_settings
  add constraint venue_settings_theme_preset
  check (theme in ('plotline', 'court-green', 'ocean', 'plum', 'sunset', 'slate', 'midnight'));
