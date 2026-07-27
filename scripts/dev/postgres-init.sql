-- BidRide local dev — runs once on first Postgres container init.
-- Creates the parallel test database used by *.integration.spec.ts
-- (TEST_DATABASE_URL). The main `bidride` database is created by POSTGRES_DB.
CREATE DATABASE bidride_test;
GRANT ALL PRIVILEGES ON DATABASE bidride_test TO bidride;
