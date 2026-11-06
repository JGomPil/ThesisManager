-- =============================================================================
-- 0008 · El archivado de un trabajo queda reservado a la administración
--
-- POR QUÉ
-- Archivar un trabajo se implementa como `update academic_works set deleted_at
-- = now()`, y la política `works_update` permite actualizar a los directores
-- del trabajo además de a la administración. Es decir: tal cual, un director
-- podía hacer desaparecer un trabajo de todas las listas.
--
-- La política `works_delete` (borrado físico) sí estaba reservada a la
-- administración, así que las dos vías no coincidían. Este disparador las
-- alinea: tocar `deleted_at` exige ser administrador de la organización.
--
-- Se hace con un disparador y no con una política porque una política no puede
-- distinguir QUÉ columna ha cambiado: `works_update` tendría que negar toda
-- actualización a los directores, y eso les quitaría la edición legítima del
-- trabajo. Es el mismo patrón que `app.enforce_task_update_scope()`, que
-- limita al estudiante a la columna `status` de sus tareas.
--
-- La interfaz esconde además el botón para quien no es administrador, pero eso
-- es comodidad, no seguridad: la frontera real es esta.
-- =============================================================================

create or replace function app.enforce_soft_delete_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and not app.is_org_admin(new.organization_id) then
    raise exception 'Solo la administración puede archivar o restaurar un trabajo'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_soft_delete_scope on academic_works;
create trigger enforce_soft_delete_scope
  before update on academic_works
  for each row execute function app.enforce_soft_delete_scope();

-- Coherente con la 0007: las funciones de `app` no son ejecutables por nadie
-- salvo concesión explícita, y las de disparador no la necesitan.
revoke all on function app.enforce_soft_delete_scope() from public;
revoke all on function app.enforce_soft_delete_scope() from anon;


-- -----------------------------------------------------------------------------
-- SEGUNDA PARTE: la administración debe VER lo archivado
--
-- Al escribir las pruebas apareció un problema de diseño que no era evidente.
-- La política de SELECT era:
--     using (deleted_at is null and (...))
-- y PostgreSQL exige que, tras un UPDATE, la fila resultante siga siendo
-- visible para quien lo ejecuta. Comprobado en PostgreSQL 16.15: el
-- `update academic_works set deleted_at = now()` fallaba con «new row
-- violates row-level security policy», y bastaba quitar `deleted_at is null`
-- de la política de SELECT para que pasara. Es decir: archivar era imposible
-- por construcción, y ninguna prueba lo cubría porque ninguna archivaba.
--
-- La consecuencia era aún peor que el fallo: si se hubiera conseguido
-- archivar, el trabajo habría quedado invisible para TODO EL MUNDO, también
-- para la administración, y por tanto irrecuperable desde la aplicación. Un
-- archivado del que no se puede volver no es un archivado, es un borrado.
--
-- Así que la política pasa a dejar ver lo archivado a la administración y solo
-- a ella. Los listados normales siguen limpios porque el repositorio filtra
-- `deleted_at is null` explícitamente, y la administración gana una vista de
-- archivados desde la que restaurar.
-- -----------------------------------------------------------------------------
alter policy works_select on academic_works
  using (
    app.is_org_admin(organization_id)
    or (deleted_at is null and id in (select app.accessible_work_ids()))
  );

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'enforce_soft_delete_scope'
      and tgrelid = 'public.academic_works'::regclass
  ) then
    raise exception 'El disparador enforce_soft_delete_scope no se ha creado';
  end if;
  raise notice 'Archivado restringido a la administración.';
end $$;
