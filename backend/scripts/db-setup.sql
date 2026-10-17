-- Creates the FightScore role and databases. Run as a PostgreSQL superuser via `npm run db:setup`.
-- The role password comes from the FIGHTSCORE_DB_PASSWORD environment variable (set by the script from .env).
\set ON_ERROR_STOP on
\getenv app_password FIGHTSCORE_DB_PASSWORD

SELECT format('CREATE ROLE fightscore LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fightscore') \gexec

SELECT format('ALTER ROLE fightscore LOGIN PASSWORD %L', :'app_password') \gexec

SELECT 'CREATE DATABASE fightscore OWNER fightscore ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fightscore') \gexec

SELECT 'CREATE DATABASE fightscore_test OWNER fightscore ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'fightscore_test') \gexec

\echo 'FightScore role and databases are ready.'
