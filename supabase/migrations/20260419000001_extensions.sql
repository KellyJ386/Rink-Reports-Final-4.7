-- 20260419000001_extensions.sql
-- Foundational extensions. Idempotent.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists citext with schema extensions;
