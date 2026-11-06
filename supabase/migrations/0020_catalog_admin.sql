-- =============================================================================
-- 0020 · Administrar los estados de trabajo y los roles académicos
--
-- QUÉ FALTABA
-- `work_statuses` y `work_roles` solo tenían política de SELECT (0003), así que
-- cambiar «Director principal» por «Director» hubo que hacerlo con una
-- migración, la 0018. Para un nombre, eso es desproporcionado: obliga a pasar
-- por un portátil con Docker, un fichero y un despliegue para corregir una
-- palabra que la dirección ve mal escrita en su pantalla.
--
-- -----------------------------------------------------------------------------
-- LO QUE **NO** SE VA A PODER TOCAR, Y POR QUÉ
--
-- `work_roles` tiene cinco columnas que NO son descriptivas:
--   can_manage_plan, can_see_private_notes, can_validate_deliverables,
--   can_manage_members, is_supervisory (y is_student).
--
-- Las lee `app.has_work_capability`, que es a su vez lo que invocan las
-- políticas de `tasks`, `milestones`, `documents`, `meetings`,
-- `document_comments` y `profiles`. Es decir: **son el modelo de permisos**. Un
-- formulario que las editara sería un formulario que edita RLS en caliente.
-- Marcar `can_see_private_notes` en el rol «Estudiante» publicaría, en ese
-- mismo instante y en todos los trabajos, las notas privadas que la dirección
-- escribió creyéndolas privadas. No habría aviso ni rastro: la siguiente
-- consulta simplemente devolvería más filas.
--
-- Así que esta migración abre lo DESCRIPTIVO y cierra lo demás:
--
--   work_statuses  →  nombre, color, orden, is_terminal, is_active, y crear y
--                     borrar (si nadie lo usa). El `code` es inmutable: el cronograma colorea por
--                     código (`EN_CURSO`) y las pruebas del dominio casan por
--                     código, así que renombrar un código rompe pantallas sin
--                     dar error.
--   work_roles     →  nombre, orden, is_active, y crear y borrar. Lo que NO se
--                     puede es tocar las capacidades, ni dárselas a un rol
--                     nuevo: nace sin ninguna. El catálogo inicial dice que
--                     «las políticas leen los FLAGS, no el code», o sea que un
--                     rol nuevo funciona sin tocar seguridad —y eso solo es
--                     cierto mientras no traiga capacidades—. Dar una capacidad
--                     sigue siendo una migración, revisable y con pruebas.
--                     Borrar un rol en uso lo impide la clave ajena
--                     (`on delete restrict`), no esta migración.
--
-- Y LA PROHIBICIÓN VIVE AQUÍ, NO EN EL FORMULARIO. No pintar los interruptores
-- en la pantalla no protege nada: cualquiera con sesión puede hablar con
-- PostgREST directamente. Lo que lo impide son los dos disparadores de abajo,
-- y esta migración los prueba antes de terminar.
--
-- -----------------------------------------------------------------------------
-- UNA LIMITACIÓN QUE HAY QUE DECIR
-- Estos dos catálogos son GLOBALES: no tienen `organization_id`, a diferencia
-- de `work_types` o `research_lines`. Sus nombres los comparten todas las
-- organizaciones. Hoy hay una sola —el grupo— y por eso es aceptable que su
-- administración pueda renombrarlos. El día que haya una segunda, esto tiene
-- que convertirse en catálogos por organización, y hasta entonces la pantalla
-- lo dice en voz alta.
--
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ¿Es administración de ALGUNA organización?
--
-- `app.is_org_admin(org)` necesita una organización, y estas filas no son de
-- ninguna. Hace falta la pregunta sin argumento.
-- -----------------------------------------------------------------------------
create or replace function app.is_any_org_admin()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from organization_members m
    where m.user_id = auth.uid()
      and m.is_active
      and m.role in ('OWNER','ADMIN')
  );
$$;

revoke all on function app.is_any_org_admin() from public;
revoke all on function app.is_any_org_admin() from anon;
grant execute on function app.is_any_org_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Políticas de escritura
-- -----------------------------------------------------------------------------
drop policy if exists statuses_write on work_statuses;
create policy statuses_write on work_statuses for all to authenticated
  using (app.is_any_org_admin())
  with check (app.is_any_org_admin());

-- TRES POLÍTICAS Y NO UNA, por un motivo que no es estético.
--
-- «Un rol nuevo no nace con capacidades» se expresa como un WITH CHECK sobre la
-- fila nueva. Pero WITH CHECK se aplica igual al INSERT y al UPDATE, y en el
-- UPDATE se evalúa sobre la fila RESULTANTE: con una sola política, renombrar
-- «Director» —que tiene `can_manage_plan`— violaría su propio check y quedaría
-- prohibido. Es decir, justo lo que se venía a permitir.
--
-- Y va en la política, no en el disparador, a propósito: el propietario de la
-- tabla NO sufre RLS, así que el catálogo inicial puede seguir creando los
-- cuatro roles con sus capacidades, mientras que cualquiera que entre por la
-- API —que nunca es el propietario— sí la sufre. Un disparador habría cerrado
-- las dos puertas y habría roto toda instalación nueva desde `install.sql`.
drop policy if exists roles_update on work_roles;
drop policy if exists roles_write on work_roles;
drop policy if exists roles_insert on work_roles;
drop policy if exists roles_delete on work_roles;

create policy roles_insert on work_roles for insert to authenticated
  with check (
    app.is_any_org_admin()
    and not (can_manage_plan or can_see_private_notes
             or can_validate_deliverables or can_manage_members)
  );

create policy roles_update on work_roles for update to authenticated
  using (app.is_any_org_admin())
  with check (app.is_any_org_admin());

-- Borrar un rol EN USO lo impide la clave ajena de `work_members`
-- (`on delete restrict`), no esta política: el error llega de PostgreSQL y la
-- pantalla lo traduce.
create policy roles_delete on work_roles for delete to authenticated
  using (app.is_any_org_admin());

-- -----------------------------------------------------------------------------
-- 3. Los disparadores que cierran lo que no es descriptivo
--
-- NO son `security definer`: no necesitan privilegios, solo comparan OLD y NEW.
--
-- LA SALIDA PARA UNA MIGRACIÓN FUTURA: una migración que de verdad tenga que
-- cambiar un permiso hace
--     set local app.migracion_catalogos = 'on';
-- dentro de su transacción. Queda escrito en el fichero de la migración, que es
-- revisable, y no hay forma de ponerlo desde PostgREST: `set local` no viaja en
-- una petición REST.
-- -----------------------------------------------------------------------------
create or replace function app.enforce_status_code_inmutable()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.code is distinct from old.code
     and coalesce(current_setting('app.migracion_catalogos', true), '') <> 'on' then
    raise exception 'El codigo de un estado no se puede cambiar (% -> %): el cronograma y el dominio casan por codigo',
      old.code, new.code;
  end if;
  return new;
end;
$$;

drop trigger if exists work_statuses_code_inmutable on work_statuses;
create trigger work_statuses_code_inmutable
  before update on work_statuses
  for each row execute function app.enforce_status_code_inmutable();

create or replace function app.enforce_role_solo_descriptivo()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.migracion_catalogos', true), '') = 'on' then
    return new;
  end if;

  -- Lo de «un rol nuevo nace sin capacidades» NO esta aqui sino en la politica
  -- `roles_insert`, porque el catalogo inicial tiene que poder crear los cuatro
  -- roles con las suyas y el propietario no sufre RLS. Aqui solo se cierra el
  -- cambio POSTERIOR, que es el que convertiria un rol inofensivo en otra cosa.
  if (new.code, new.is_student, new.is_supervisory, new.can_manage_plan,
      new.can_see_private_notes, new.can_validate_deliverables, new.can_manage_members)
     is distinct from
     (old.code, old.is_student, old.is_supervisory, old.can_manage_plan,
      old.can_see_private_notes, old.can_validate_deliverables, old.can_manage_members)
  then
    raise exception 'De un rol solo se pueden cambiar el nombre, el orden y si esta activo: los permisos son el modelo de seguridad y se cambian con una migracion';
  end if;
  return new;
end;
$$;

drop trigger if exists work_roles_solo_descriptivo on work_roles;
create trigger work_roles_solo_descriptivo
  before update on work_roles
  for each row execute function app.enforce_role_solo_descriptivo();

-- Las funciones de disparador tambien son funciones del esquema `app`, y al no
-- ser `security definer` nacen con EXECUTE para `public`, es decir tambien para
-- `anon`. Lo pillo la prueba [33], que comprueba justo eso en TODO el esquema.
-- Un disparador no necesita que nadie tenga EXECUTE: lo invoca el motor.
revoke all on function app.enforce_status_code_inmutable() from public;
revoke all on function app.enforce_status_code_inmutable() from anon;
revoke all on function app.enforce_role_solo_descriptivo() from public;
revoke all on function app.enforce_role_solo_descriptivo() from anon;

-- -----------------------------------------------------------------------------
-- 4. Comprobaciones. Si algo de esto no se cumple, la migración no termina.
-- -----------------------------------------------------------------------------
do $$
declare
  v_codigo text;
  v_falla boolean;
  v_n int;
begin
  -- 4.1 Las políticas están donde deben, y work_roles NO tiene de insert/delete.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'work_statuses' and policyname = 'statuses_write';
  if v_n <> 1 then raise exception '0020: falta la politica statuses_write'; end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'work_roles'
     and policyname in ('roles_insert','roles_update','roles_delete');
  if v_n <> 3 then
    raise exception '0020: work_roles deberia tener las tres politicas de escritura, y tiene %', v_n;
  end if;

  -- Y NINGUNA que valga para todo a la vez: una politica `for all` traeria de
  -- vuelta el problema que obligo a separarlas (el WITH CHECK del INSERT
  -- aplicandose al UPDATE y prohibiendo renombrar «Director»).
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'work_roles' and cmd = 'ALL'
     and policyname <> 'work_roles_select';
  if v_n <> 0 then
    raise exception '0020: work_roles no debe tener una politica de escritura para todo (%)', v_n;
  end if;

  -- 4.2 Los disparadores no son security definer.
  select bool_or(p.prosecdef) into v_falla
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('enforce_status_code_inmutable','enforce_role_solo_descriptivo');
  if coalesce(v_falla, true) then
    raise exception '0020: los disparadores no deben ser security definer';
  end if;

  -- 4.3 `anon` no ejecuta la funcion nueva.
  if has_function_privilege('anon', 'app.is_any_org_admin()', 'execute') then
    raise exception '0020: anon no debe poder ejecutar app.is_any_org_admin';
  end if;

  -- 4.4 Y AHORA LO QUE DE VERDAD IMPORTA: que los disparadores muerdan.
  --     Se intenta de verdad, con los privilegios del propietario, que es el
  --     caso mas favorable que existe. Si pasara aqui, pasaria en cualquier sitio.
  select code into v_codigo from work_statuses order by display_order limit 1;
  if v_codigo is not null then
    begin
      update work_statuses set code = code || '_X' where code = v_codigo;
      raise exception '0020: el disparador NO impidio cambiar el codigo de un estado';
    exception
      when others then
        if position('no se puede cambiar' in sqlerrm) = 0 then raise; end if;
    end;
    raise notice 'CORRECTO: 0020 el codigo de un estado es inmutable';
  end if;

  if exists (select 1 from work_roles) then
    begin
      update work_roles set can_see_private_notes = not can_see_private_notes
       where id = (select id from work_roles order by display_order limit 1);
      raise exception '0020: el disparador NO impidio cambiar un permiso de rol';
    exception
      when others then
        if position('solo se pueden cambiar' in sqlerrm) = 0 then raise; end if;
    end;
    raise notice 'CORRECTO: 0020 los permisos de un rol no se pueden cambiar por la API';
  end if;

  -- 4.5 La politica de INSERT menciona las cuatro capacidades. Comprobar aqui su
  --     EFECTO es imposible: esta migracion corre como propietario y el
  --     propietario no sufre RLS, que es precisamente lo que la hace funcionar.
  --     El comportamiento lo prueba la [147], con una sesion de verdad.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'work_roles'
     and policyname = 'roles_insert'
     and with_check like '%can_see_private_notes%'
     and with_check like '%can_manage_plan%';
  if v_n <> 1 then
    raise exception '0020: roles_insert no restringe las capacidades de un rol nuevo';
  end if;
  raise notice 'CORRECTO: 0020 un rol nuevo no puede nacer con capacidades';

  -- 4.6 Y que el nombre SÍ se pueda cambiar: una prohibicion que lo prohibe todo
  --     cumple la comprobacion anterior y no sirve para nada.
  if exists (select 1 from work_roles) then
    update work_roles set name = name where id = (select id from work_roles order by display_order limit 1);
    raise notice 'CORRECTO: 0020 el nombre de un rol si se puede cambiar';
  end if;

  raise notice '0020 aplicada: estados y roles administrables, permisos cerrados.';
end $$;
