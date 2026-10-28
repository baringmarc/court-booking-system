-- T11.6: the venue's color theme, one of the Plotline presets (RESEARCH M11 "Theme presets"; the user approved the
-- list on 2026-10-27). Expand only. Admins set it through the existing venue_settings UPDATE policy (update is granted
-- table-wide); everyone can read it, like the other settings. The frontend starts reading it in T11.7.
alter table public.venue_settings
  add column theme text not null default 'plotline'
  constraint venue_settings_theme_preset check (theme in ('plotline', 'court-green', 'ocean', 'plum', 'sunset'));

comment on column public.venue_settings.theme is 'Color preset for the venue''s site and admin area (T11.6).';
