-- =============================================================================
-- 0013 · Cuentas creadas a mano: hacerlas visibles para poder autorizarlas
--
-- EL PROBLEMA
-- `profiles_select` dice: «veo mi perfil, y veo los perfiles de quien comparte
-- organización conmigo». Es la invariante correcta y no se toca.
--
-- Pero tiene una consecuencia que no se había pensado. Cuando alguien crea un
-- usuario a mano en Authentication → Users del panel de Supabase, el disparador
-- `on_auth_user_created` le crea su fila en `profiles`, y nada más: la
-- pertenencia a la organización es un acto administrativo explícito y no se
-- deduce del registro (y eso está bien: sin ella, el usuario entra y no ve
-- nada). El resultado es que esa cuenta existe pero **no comparte organización
-- con nadie**, así que NO LA VE NADIE, tampoco la administración. El
-- administrador no puede autorizar desde la aplicación a alguien que la
-- aplicación no le deja ver, y se queda sin más salida que escribir a mano en
-- `organization_members` desde el panel de Supabase.
--
-- La cola de invitaciones (0005) cubre el camino previsto —invitar y que el
-- alta se haga sola al aceptar—, pero no este, que es el que se usa cuando se
-- crea la cuenta directamente.
--
-- LA SOLUCIÓN, Y POR QUÉ NO ES UNA POLÍTICA MÁS AMPLIA
-- La tentación es añadir a `profiles_select` algo como «...o soy administrador
-- y el perfil no tiene organización». Funcionaría, pero ensancha la lectura
-- general de `profiles` para siempre y en todas las consultas: cualquier
-- `select * from profiles` de cualquier pantalla empezaría a devolver cuentas
-- ajenas, y el día que alguien añada un filtro mal puesto no se notaría.
--
-- En su lugar se expone UNA función que devuelve exactamente lo que hace falta
-- y nada más: las cuentas sin ninguna pertenencia activa, solo si quien
-- pregunta es administrador de alguna organización. `profiles_select` sigue
-- igual de estrecha, y la excepción está en un sitio único, con nombre, que se
-- puede leer y probar.
--
-- LIMITACIÓN CONOCIDA, escrita a propósito
-- Si algún día este despliegue alojara VARIAS organizaciones independientes,
-- cualquier administrador vería las cuentas pendientes de todas, porque una
-- cuenta sin organización no tiene nada que la vincule a una. Hoy el
-- despliegue es de un solo grupo y el caso no se da. Si se diera, la forma de
-- acotarlo es cruzar con `invitations` por correo y mostrar solo las cuentas
-- cuyo correo tenga una invitación de esa organización; se deja apuntado aquí
-- para no tener que volver a razonarlo.
-- =============================================================================

create or replace function app.is_any_org_admin()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from organization_members m
    where m.user_id = auth.uid()
      and m.is_active
      and m.role in ('OWNER', 'ADMIN')
  );
$$;

/**
 * Cuentas que existen pero no pertenecen a ninguna organización.
 *
 * Va en `public` porque PostgREST no expone el esquema `app` y la interfaz
 * tiene que poder llamarla.
 */
create or replace function public.pending_accounts()
returns table (id uuid, full_name text, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Quien no administra nada no recibe un error, recibe una lista vacía. Un
  -- error diría «aquí hay algo que no puedes ver», que es más de lo que hace
  -- falta contar. Y la comprobación va DENTRO de la función porque es
  -- `security definer`: sin ella, el `grant` a `authenticated` dejaría la lista
  -- de correos de las cuentas nuevas al alcance de cualquier usuario.
  if not app.is_any_org_admin() then
    return;
  end if;

  return query
    select p.id, p.full_name, p.email, p.created_at
    from profiles p
    where not exists (
      select 1 from organization_members m
      where m.user_id = p.id and m.is_active
    )
    order by p.created_at desc
    limit 200;
end;
$$;

-- Privilegios: el `revoke` en bloque del esquema `app` (ver la cabecera de la
-- 0012) y, para la función de `public`, uno explícito. Todo lo que vive en
-- `public` lo ve PostgREST, y por tanto también `anon`.
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

revoke all on function public.pending_accounts() from public;
revoke all on function public.pending_accounts() from anon;
grant execute on function public.pending_accounts() to authenticated;

-- -----------------------------------------------------------------------------
-- Comprobaciones de la propia migración
-- -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.pending_accounts()', 'execute') then
    raise exception 'anon no debe poder listar las cuentas pendientes.';
  end if;
  if not has_function_privilege('authenticated', 'public.pending_accounts()', 'execute') then
    raise exception 'authenticated debe poder listar las cuentas pendientes.';
  end if;

  -- `profiles_select` NO debe haberse ensanchado: es el punto de todo esto.
  if pg_get_expr(
       (select polqual from pg_policy where polname = 'profiles_select'),
       (select polrelid from pg_policy where polname = 'profiles_select')
     ) not like '%shares_organization%' then
    raise exception 'profiles_select ha cambiado de forma inesperada.';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception 'Alguna función de app es ejecutable por anon.';
  end if;

  raise notice 'Migracion 0013 correcta: cuentas pendientes visibles solo para la administracion.';
end;
$$;
