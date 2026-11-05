-- =============================================================================
-- 0006_harden_anon_grants.sql
--
-- PROBLEMA DETECTADO EN PRODUCCIÓN (5 de noviembre de 2026)
--
-- La migración 0003 termina con `revoke all on all tables in schema public
-- from anon`, pero esa sentencia solo afecta a las tablas que EXISTEN en ese
-- momento. Supabase define privilegios por defecto (ALTER DEFAULT PRIVILEGES)
-- que conceden a `anon` permisos sobre cada tabla nueva del esquema public,
-- así que `invitations` (creada en 0005) acabó con SELECT para `anon`.
--
-- No había fuga de datos: su política RLS exige ser administrador de la
-- organización y devolvía 0 filas. Pero dejaba la seguridad dependiendo de una
-- sola capa. En una tabla que contiene correos de personas que todavía no son
-- usuarias, eso no es aceptable: un error futuro en la política quedaría
-- expuesto directamente a Internet.
--
-- Esta migración hace tres cosas:
--   1. Revoca de nuevo los privilegios de `anon` sobre TODAS las tablas,
--      dejando solo la lectura de `keepalive`. Es idempotente.
--   2. Cambia los privilegios POR DEFECTO para que ninguna tabla futura los
--      herede. Esto es lo que evita que el problema se repita.
--   3. Deja una comprobación que falla si algo se ha escapado.
-- =============================================================================

-- --- 1. Revocar de nuevo, TODAS las tablas sin excepción --------------------
-- `keepalive` incluida: se creó en 0004, también después del revoke de 0003, y
-- por tanto heredó privilegios de escritura que nunca debió tener. RLS los
-- bloqueaba (0 filas afectadas), pero el privilegio de tabla sobraba.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

revoke all on all functions in schema public from anon;

-- Y ahora se concede, de forma mínima y explícita, lo único que `anon` necesita:
--   · leer la fila técnica de mantenimiento,
--   · invocar la RPC que actualiza su marca de tiempo.
grant select on table keepalive to anon;
grant execute on function public.keepalive_ping() to anon;

-- --- 2. Que ninguna tabla futura herede privilegios de anon -----------------
-- Afecta a los objetos que cree en adelante el rol que ejecuta esta migración,
-- que es el mismo con el que se aplican todas las demás.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- --- 3. Comprobación: si queda algo, la migración falla ---------------------
do $$
declare
  leaked text;
begin
  -- Lo único admisible es SELECT sobre keepalive. Cualquier otra combinación
  -- de tabla y privilegio para `anon` hace fallar la migración.
  select string_agg(distinct table_name || ':' || privilege_type, ', ')
  into leaked
  from information_schema.role_table_grants
  where grantee = 'anon'
    and table_schema = 'public'
    and not (table_name = 'keepalive' and privilege_type = 'SELECT');

  if leaked is not null then
    raise exception 'El rol anon conserva privilegios indebidos: %', leaked;
  end if;

  raise notice 'Correcto: anon solo puede hacer SELECT sobre keepalive.';
end $$;

-- --- 4. Y que RLS siga activo en todo, incluidas las tablas nuevas ----------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

do $$
declare
  sin_rls text;
begin
  select string_agg(tablename, ', ')
  into sin_rls
  from pg_tables
  where schemaname = 'public' and not rowsecurity;

  if sin_rls is not null then
    raise exception 'Tablas sin RLS: %', sin_rls;
  end if;

  raise notice 'Correcto: RLS activo en todas las tablas de public.';
end $$;
