#!/usr/bin/env bash
# Applies every migration to a fresh database and runs the security regression suite.
# Usage: DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres scripts/test-db.sh
# The target database is dropped and recreated: never point this at a real project.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to a throwaway PostgreSQL server}"
cd "$(dirname "$0")/.."

TEST_DB="yani_security_test"
ADMIN_URL="$DATABASE_URL"
TEST_URL="${DATABASE_URL%/*}/${TEST_DB}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" "$ADMIN_URL" -c "DROP DATABASE IF EXISTS ${TEST_DB}" -c "CREATE DATABASE ${TEST_DB}"
"${PSQL[@]}" "$TEST_URL" -f supabase/tests/00_supabase_stub.sql

for migration in supabase/migrations/*.sql; do
  echo "apply ${migration}"
  if ! output=$("${PSQL[@]}" "$TEST_URL" -f "$migration" 2>&1); then
    echo "$output"
    echo "FAILED to apply ${migration}" >&2
    exit 1
  fi
done

"${PSQL[@]}" "$TEST_URL" -f supabase/tests/security_test.sql
