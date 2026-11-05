-- Emulación mínima de lo que Supabase aporta, para poder validar las migraciones
-- en un PostgreSQL limpio.
create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
-- Supabase concede esto de serie a anon/authenticated; el stub debe imitarlo.
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
