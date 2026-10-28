-- T11.8: venue_settings.maps_url, the Google Maps link players open from the address (RESEARCH M11 "Google Maps
-- links"; the user approved the plan and db:push on 2026-10-28). Expand only: maps_query stays until the contract
-- migration (T11.15), so the deployed frontend keeps working. No new grants or policies: the table-wide update grant
-- and the admin UPDATE policy cover the new column, and everyone can read it like the other settings.

-- Percent-encodes every UTF-8 byte outside the URL-unreserved set (A-Z a-z 0-9 - _ . ~). Postgres has none built in.
create function private.url_encode(p_text text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(string_agg(
    case
      when b between 48 and 57 or b between 65 and 90 or b between 97 and 122 or b in (45, 46, 95, 126) then chr(b)
      else '%' || upper(lpad(to_hex(b), 2, '0'))
    end, '' order by i), '')
  from (
    select i, get_byte(convert_to(p_text, 'UTF8'), i) as b
    from generate_series(0, octet_length(convert_to(p_text, 'UTF8')) - 1) as i
  ) bytes
$$;

-- A Maps search link for a place or address: '' when there's nothing to search, or when the encoded link wouldn't fit
-- the 1000-character cap (only an address with 100+ accented letters; it then shows without a link).
create function private.maps_search_url(p_query text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when btrim(coalesce(p_query, '')) = '' then ''
    when char_length(url) > 1000 then ''
    else url
  end
  from (select 'https://www.google.com/maps/search/?api=1&query=' || private.url_encode(btrim(coalesce(p_query, ''))) as url) u
$$;

revoke all on function private.url_encode(text) from public;
revoke all on function private.maps_search_url(text) from public;

alter table public.venue_settings
  add column maps_url text not null default ''
  constraint venue_settings_maps_url_link check (
    maps_url = ''
    or (
      char_length(maps_url) <= 1000
      and maps_url ~ '^https://(www\.google\.com/maps|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl/maps)([/?#][^[:space:]]*)?$'
    )
  );

comment on column public.venue_settings.maps_url is
  'Google Maps link for the venue (T11.8): empty, or https on www.google.com/maps, maps.google.com, maps.app.goo.gl or goo.gl/maps.';

update public.venue_settings
set maps_url = private.maps_search_url(coalesce(nullif(btrim(maps_query), ''), address))
where maps_url = '';
