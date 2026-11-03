#!/bin/bash
# Runs once, on first start with an empty data volume.
# Creates the non-superuser role the web app uses and gives it the database.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE talkfront_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
  ALTER DATABASE talkfront OWNER TO talkfront_app;
  ALTER SCHEMA public OWNER TO talkfront_app;
EOSQL
