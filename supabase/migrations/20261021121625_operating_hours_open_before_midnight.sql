-- Milestone 9, T9.11 review: a day can't open at 24:00 (it would start on the next date, so its slots would be
-- listed under the wrong day). set_operating_hours already refuses it; this holds direct writes to the same rule,
-- since direct UPDATE stays granted while production's schedule editor (before T9.10) saves rows one by one.
alter table public.operating_hours
  add constraint operating_hours_open_before_midnight check (open_time < '24:00');
