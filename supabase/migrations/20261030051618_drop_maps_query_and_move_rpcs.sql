-- T11.15: the contract step for M11. The frontend that reads maps_url and reorders with reorder_courts and
-- reorder_info_sections has been live since the merge into master, so what it replaced can go:
--   * venue_settings.maps_query (T11.8 copied it into maps_url; the embedded map is gone),
--   * the move-by-one RPCs move_court and move_info_section (T11.5a),
--   * the two helpers that only served the maps_url backfill.
-- Dropping maps_query deletes its data for good. maps_url already holds the backfilled links.

drop function public.move_court(uuid, smallint);
drop function public.move_info_section(uuid, smallint);

alter table public.venue_settings drop column maps_query;

drop function private.maps_search_url(text);
drop function private.url_encode(text);
