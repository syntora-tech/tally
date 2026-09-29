#!/usr/bin/env sh
# Runs the pinned Supabase CLI with supabase/.env loaded and safe defaults, so that
# config.toml env() references resolve on a fresh clone (Google OAuth off unless configured).
set -eu
cd "$(dirname "$0")/.."
if [ -f supabase/.env ]; then
  set -a
  . ./supabase/.env
  set +a
fi
export SUPABASE_AUTH_GOOGLE_ENABLED="${SUPABASE_AUTH_GOOGLE_ENABLED:-false}"
export SUPABASE_AUTH_GOOGLE_CLIENT_ID="${SUPABASE_AUTH_GOOGLE_CLIENT_ID:-}"
export SUPABASE_AUTH_GOOGLE_SECRET="${SUPABASE_AUTH_GOOGLE_SECRET:-}"
exec pnpm exec supabase "$@"
