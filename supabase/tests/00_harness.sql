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
-- auth.uid() leíble desde una variable de sesión, para poder suplantar
-- usuarios en las pruebas: `set session "test.uid" = '<uuid>'`.
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
-- Supabase concede esto de serie a anon/authenticated; el stub debe imitarlo.
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- =============================================================================
-- Privilegios por defecto de Supabase sobre el esquema `public`
--
-- POR QUÉ ESTO ES IMPRESCINDIBLE EN EL HARNESS
-- Supabase no deja `public` tal y como lo deja PostgreSQL: concede `usage` del
-- esquema a `anon` y `authenticated` y, sobre todo, fija ALTER DEFAULT
-- PRIVILEGES para que CADA TABLA, SECUENCIA Y FUNCIÓN NUEVA nazca con todos
-- los privilegios concedidos a esos dos roles. Sobre eso se apoya toda la
-- arquitectura: la frontera real es RLS, no los privilegios de tabla.
--
-- Sin emularlo aquí, las pruebas corrían con `authenticated` sin privilegios
-- de tabla. Eso las volvía optimistas en un sentido y ciegas en otro: ciegas
-- a cualquier `revoke` mal puesto, porque el rol ya no tenía nada que perder.
-- Así se escapó el fallo real de `app.has_work_capability`, cuyo EXECUTE se
-- revocaba a `public` sin devolvérselo a `authenticated`: en producción
-- rompió el resumen y la ficha de trabajo, y aquí ninguna de las 31 pruebas
-- lo notó. Corregido en la migración 0007.
--
-- Las migraciones corren como `postgres`, así que los defaults se fijan para
-- ese rol, igual que en Supabase.
-- =============================================================================
grant usage on schema public to anon, authenticated;

alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated;
