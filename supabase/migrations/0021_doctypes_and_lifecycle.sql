-- =============================================================================
-- 0021 · Tipos de documento y ciclo de vida por tipo de trabajo, administrables
--
-- QUÉ FALTABA
-- Eran los dos últimos catálogos sin política de escritura y sin pantalla:
--
--   `document_types`      · qué clases de entregable existen (memoria, plan,
--                           estado del arte, póster, anexo de datos…).
--   `work_type_statuses`  · qué estados aplican a cada tipo de trabajo. Es la
--                           regla que permite que la Academia de Alumnos
--                           Internos no pase por «Pendiente de depósito» ni por
--                           «Defendido» sin que eso esté escrito en el código:
--                           un tipo SIN filas aquí admite todos los estados
--                           activos; con filas, solo esos (DATABASE.md §3.2).
--
-- Con esto, la Fase 1 queda cerrada de verdad: su punto 5 pedía administrar
-- desde la interfaz «tipos de trabajo (con sus reglas), estados, roles,
-- titulaciones, líneas y cursos», y el ciclo de vida por tipo era «sus reglas».
--
-- -----------------------------------------------------------------------------
-- LO QUE NO SE PUEDE HACER, Y POR QUÉ
--
-- 1. BORRAR UN TIPO DE DOCUMENTO GLOBAL. `documents.document_type_id` y
--    `template_documents.document_type_id` son `on delete set null`: borrar un
--    tipo **no da error**, deja en blanco el tipo de todos los documentos que lo
--    usaban y no queda rastro de cuál era. En un grupo de investigación eso es
--    perder información histórica sin enterarse. Para los tipos de la propia
--    organización el borrado se permite —la pantalla dice a cuántos documentos
--    afecta antes de hacerlo, como en las líneas de investigación— pero para los
--    globales, que los comparten todas las organizaciones, no: ahí solo se puede
--    RETIRAR (`is_active = false`), que desaparece de los formularios y conserva
--    lo que ya estaba escrito.
--
-- 2. MOVER UN TIPO DE DOCUMENTO DE ORGANIZACIÓN. Esto SÍ necesita un
--    disparador, y el motivo merece quedar escrito porque es fácil de creer al
--    revés: en un UPDATE se evalúa el USING sobre la fila vieja y el WITH CHECK
--    sobre la nueva, de modo que con UNA política cuyas dos condiciones piden lo
--    mismo, cambiar `organization_id` dejaría de cumplir una de las dos. Pero
--    aquí hay DOS políticas permisivas, y PostgreSQL combina con OR los USING
--    entre sí y los WITH CHECK entre sí, **por separado**. Un tipo propio que
--    pasa a global cumple el USING de `doctypes_write` (era propio) y el WITH
--    CHECK de `doctypes_update_global` (ahora es global), así que pasa. Lo
--    comprobó la prueba [152], que fallaba mientras esto se dejaba a las
--    políticas.
--
-- UNA LIMITACIÓN QUE SE DICE, igual que en la 0020: los tipos de documento
-- globales y el ciclo de vida de los tipos de trabajo globales los comparten
-- todas las organizaciones. Hoy hay una —el grupo—, y por eso se admite que su
-- administración los toque.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos de documento
-- -----------------------------------------------------------------------------

-- 1.a Los de la propia organización: crear, editar, retirar y borrar.
drop policy if exists doctypes_write on document_types;
create policy doctypes_write on document_types for all to authenticated
  using (organization_id is not null and app.is_org_admin(organization_id))
  with check (organization_id is not null and app.is_org_admin(organization_id));

-- 1.b Los globales: solo UPDATE. Renombrar y retirar, sí; borrar, no (ver arriba).
drop policy if exists doctypes_update_global on document_types;
create policy doctypes_update_global on document_types for update to authenticated
  using (organization_id is null and app.is_any_org_admin())
  with check (organization_id is null and app.is_any_org_admin());

-- 1.c Y la organización de un tipo de documento es inmutable.
--     Ver el punto 2 de la cabecera: con dos políticas permisivas esto NO lo
--     puede impedir el WITH CHECK.
create or replace function app.enforce_doctype_org_inmutable()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id
     and coalesce(current_setting('app.migracion_catalogos', true), '') <> 'on' then
    raise exception 'La organizacion de un tipo de documento no se puede cambiar: un tipo global lo comparten todas, y uno propio es de quien lo creo';
  end if;
  return new;
end;
$$;

revoke all on function app.enforce_doctype_org_inmutable() from public;
revoke all on function app.enforce_doctype_org_inmutable() from anon;

drop trigger if exists doctypes_org_inmutable on document_types;
create trigger doctypes_org_inmutable
  before update on document_types
  for each row execute function app.enforce_doctype_org_inmutable();

-- -----------------------------------------------------------------------------
-- 2. Ciclo de vida por tipo de trabajo
--
-- Quién puede: la administración de la organización del tipo de trabajo, y para
-- los tipos GLOBALES —que son los del catálogo inicial: TFG, TFM, TESIS,
-- ACADEMIA— la administración de cualquiera, por lo dicho arriba.
--
-- No hay nada «descriptivo» que proteger aquí: una fila de esta tabla no
-- concede acceso a nada, solo decide qué opciones salen en un desplegable.
-- Equivocarse es visible al instante y se arregla quitando la fila.
-- -----------------------------------------------------------------------------
create or replace function app.can_manage_work_type(wt uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from work_types t
     where t.id = wt
       and case
             when t.organization_id is null then app.is_any_org_admin()
             else app.is_org_admin(t.organization_id)
           end
  );
$$;

revoke all on function app.can_manage_work_type(uuid) from public;
revoke all on function app.can_manage_work_type(uuid) from anon;
grant execute on function app.can_manage_work_type(uuid) to authenticated;

drop policy if exists wtstatuses_write on work_type_statuses;
create policy wtstatuses_write on work_type_statuses for all to authenticated
  using (app.can_manage_work_type(work_type_id))
  with check (app.can_manage_work_type(work_type_id));

-- -----------------------------------------------------------------------------
-- 3. Comprobaciones
-- -----------------------------------------------------------------------------
do $$
declare v_n int; v_definer boolean; v_id uuid;
begin
  -- 3.1 Las políticas están.
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and policyname in ('doctypes_write','doctypes_update_global','wtstatuses_write');
  if v_n <> 3 then
    raise exception '0021: faltan politicas de escritura (hay %)', v_n;
  end if;

  -- 3.2 Y la de los globales es SOLO de update: con un `for all` se podrian
  --     borrar, que es justo lo que no debe poder hacerse.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and policyname = 'doctypes_update_global' and cmd = 'UPDATE';
  if v_n <> 1 then
    raise exception '0021: doctypes_update_global deberia ser solo de UPDATE';
  end if;

  -- 3.3 `anon` no ejecuta la función nueva, y es `security definer` a propósito
  --     (lee `work_types`, que el llamante puede no ver entera).
  if has_function_privilege('anon', 'app.can_manage_work_type(uuid)', 'execute') then
    raise exception '0021: anon no debe poder ejecutar app.can_manage_work_type';
  end if;
  select prosecdef into v_definer from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'can_manage_work_type';
  if not coalesce(v_definer, false) then
    raise exception '0021: app.can_manage_work_type debe ser security definer';
  end if;

  -- 3.4 La regla del modelo sigue siendo la que dice DATABASE.md: un tipo sin
  --     filas admite todos los estados. Si el catálogo inicial dejara de tener
  --     la restricción de ACADEMIA, esta migración no es el problema, pero
  --     conviene que salte aquí y no en una pantalla.
  select id into v_id from work_types where code = 'ACADEMIA' and organization_id is null;
  if v_id is not null then
    select count(*) into v_n from work_type_statuses where work_type_id = v_id;
    if v_n = 0 then
      raise warning '0021: ACADEMIA no tiene ciclo de vida propio; admitira todos los estados';
    else
      raise notice 'CORRECTO: 0021 ACADEMIA conserva su ciclo de vida (% estados)', v_n;
    end if;
  end if;

  -- 3.5 Que el disparador de la organizacion muerda, probado de verdad y con los
  --     privilegios del propietario, que es el caso mas favorable.
  select id into v_id from document_types where organization_id is null limit 1;
  if v_id is not null then
    begin
      update document_types
         set organization_id = '00000000-0000-0000-0000-000000000000'
       where id = v_id;
      raise exception '0021: el disparador NO impidio mover un tipo de documento de organizacion';
    exception
      when others then
        if position('no se puede cambiar' in sqlerrm) = 0 then raise; end if;
    end;
    raise notice 'CORRECTO: 0021 la organizacion de un tipo de documento es inmutable';
  end if;

  raise notice '0021 aplicada: tipos de documento y ciclo de vida por tipo, administrables.';
end $$;
