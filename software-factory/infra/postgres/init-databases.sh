#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v pg_password="$POSTGRES_PASSWORD" <<-'EOSQL'
  SELECT format('CREATE ROLE hatchet LOGIN PASSWORD %L', :'pg_password')
  WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hatchet')
  \gexec

  SELECT format('CREATE ROLE phoenix LOGIN PASSWORD %L', :'pg_password')
  WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'phoenix')
  \gexec

  SELECT 'CREATE DATABASE hatchet OWNER hatchet'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hatchet')
  \gexec

  SELECT 'CREATE DATABASE phoenix OWNER phoenix'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'phoenix')
  \gexec
EOSQL
