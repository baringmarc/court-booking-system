-- T12.3 follow-up: column defaults run as the inserting role, so the service role (Edge Functions, seeds, tests)
-- needs execute on the default function too.
grant execute on function private.default_venue_id() to service_role;
