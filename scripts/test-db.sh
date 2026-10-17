#!/bin/sh
# Database tests (pgTAP) against the LOCAL Supabase Postgres. Never touches the linked project.
# Starts the local database if needed and applies pending local migrations first.
set -e
cd "$(dirname "$0")/.."

if ! supabase status >/dev/null 2>&1 && ! docker ps --format '{{.Names}}' | grep -q '^supabase_db_'; then
  echo "Starting local Supabase database…"
  supabase db start
fi

supabase migration up --local >/dev/null
supabase test db
