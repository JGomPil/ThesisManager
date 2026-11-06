-- =============================================================================
-- 0007 · Permisos explícitos sobre las funciones auxiliares del esquema `app`
--
-- EL FALLO QUE CORRIGE
-- La migración 0003 terminaba con una línea suelta:
--     revoke all on function app.has_work_capability(uuid, text) from public;
-- que quitaba el EXECUTE al pseudo-rol `public` sin devolvérselo a
-- `authenticated`. Como esa función se invoca desde las políticas de RLS de
-- `tasks`, `milestones`, `documents` y `meetings`, cualquier consulta a esas
-- tablas abortaba con «permission denied for function has_work_capability» y
-- la pantalla se quedaba sin datos. Las demás funciones de `app` seguían
-- funcionando porque conservaban el EXECUTE por defecto de `public`, lo que
-- hacía el fallo desconcertante: los catálogos iban bien y el resumen no.
--
-- POR QUÉ NO BASTA CON BORRAR AQUEL `revoke`
-- La intención de aquella línea era buena, solo estaba a medias. Dejar estas
-- funciones ejecutables por `public` significa que también las puede ejecutar
-- `anon`. Hoy no es explotable porque PostgREST solo expone el esquema
-- `public` y estas viven en `app`, pero depender de eso es apoyarse en una
-- configuración que no controlamos. Así que se hace lo contrario: se revoca a
-- `public` y a `anon` en TODAS, y se concede a `authenticated` una por una.
--
-- Son SECURITY DEFINER: se ejecutan con los privilegios de su propietario y
-- con `search_path` fijado. Conceder EXECUTE a `authenticated` no abre nada
-- indebido, porque todas filtran internamente por `auth.uid()`.
--
-- Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- 1. El esquema. Supabase lo concede por su cuenta a los roles de la API, pero
--    no lo documenta como garantía, así que lo dejamos explícito. Sin esto el
--    error sería «permission denied for schema app», distinto y más temprano.
grant usage on schema app to authenticated;

-- 2. Punto de partida limpio: nadie por defecto.
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

-- 3. Y ahora, explícitamente, las que invocan las políticas de RLS.
grant execute on function app.uid()                              to authenticated;
grant execute on function app.is_org_admin(uuid)                 to authenticated;
grant execute on function app.is_admin_of_work(uuid)             to authenticated;
grant execute on function app.is_work_member(uuid)               to authenticated;
grant execute on function app.is_work_supervisor(uuid)           to authenticated;
grant execute on function app.has_work_capability(uuid, text)    to authenticated;
grant execute on function app.can_manage_plan(uuid)              to authenticated;
grant execute on function app.can_see_private_notes(uuid)        to authenticated;
grant execute on function app.accessible_work_ids()              to authenticated;
grant execute on function app.shares_organization(uuid)          to authenticated;
grant execute on function app.my_org_ids()                       to authenticated;

-- Las funciones de disparador (`app.enforce_task_update_scope`,
-- `app.handle_new_user`, `app.accept_invitation`) se quedan SIN conceder a
-- propósito: PostgreSQL no comprueba EXECUTE sobre la función de un trigger
-- cuando se ejecuta el INSERT/UPDATE que lo dispara, así que no hace falta, y
-- no concederlo evita que nadie las llame a mano. Verificado en las pruebas.

-- 4. Que las funciones futuras de `app` nazcan ya sin permisos para `anon`.
alter default privileges in schema app revoke all on functions from public;
alter default privileges in schema app revoke all on functions from anon;

-- =============================================================================
-- 5. Verificación: esta migración falla sola si queda algo mal.
-- =============================================================================
do $$
declare
  faltan text;
  sobran text;
begin
  -- Toda función invocada desde una política debe ser ejecutable por authenticated.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into faltan
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and p.prorettype <> 'trigger'::regtype
    and not has_function_privilege('authenticated', p.oid, 'execute');
  if faltan is not null then
    raise exception 'authenticated no puede ejecutar: %', faltan;
  end if;

  -- Y anon no debe poder ejecutar ninguna.
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into sobran
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and has_function_privilege('anon', p.oid, 'execute');
  if sobran is not null then
    raise exception 'anon puede ejecutar funciones de app: %', sobran;
  end if;

  if not has_schema_privilege('authenticated', 'app', 'usage') then
    raise exception 'authenticated no tiene USAGE sobre el esquema app';
  end if;
  if has_schema_privilege('anon', 'app', 'usage') then
    raise notice 'Aviso: anon tiene USAGE sobre el esquema app; sin EXECUTE no puede hacer nada, pero conviene revisarlo.';
  end if;

  raise notice 'Permisos del esquema app correctos.';
end $$;
