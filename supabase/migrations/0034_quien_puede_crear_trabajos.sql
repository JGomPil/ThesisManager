-- =============================================================================
-- 0034 · Quien puede crear un trabajo
--
-- EL CASO REAL: se da de alta a una profesora y quiere crear el TFG que va a
-- dirigir. No puede: `works_insert` (0003) exige `app.is_org_admin`, de modo
-- que en un grupo entero solo crean trabajos quienes administran la aplicacion,
-- y toda la carga de dar de alta los trabajos de los demas cae en una persona.
--
-- Y LA SALIDA FACIL ERA MALA: hacerla administradora. Administrar no es dirigir
-- -lo dice la propia ficha de persona-, y un administrador VE TODOS LOS
-- TRABAJOS DEL GRUPO, notas privadas de supervision incluidas. Repartir la
-- carga de crear trabajos no puede costar la privacidad de las tutorias de los
-- demas.
--
-- LA DECISION (de la direccion del grupo): una casilla por persona. Nace
-- APAGADA para todo el mundo, asi que esta migracion no cambia por si sola lo
-- que puede nadie, y la enciende quien administra, desde la ficha de la
-- persona. Lo que se descarto a proposito: que pudiera cualquiera del grupo
-- -los alumnos tambien estan en el grupo, y un TFG creandose su propio trabajo
-- y dirigiendolo no es lo que se quiere-, y deducirlo de dirigir ya algun
-- trabajo, que deja a la recien llegada sin poder empezar.
--
-- POR QUE ADEMAS HACE FALTA UNA FUNCION, Y NO BASTA CON ABRIR LA POLITICA.
-- UN TRABAJO NO ES UNA FILA: es una fila MAS SU DIRECCION. `works_select` solo
-- ensena los trabajos de los que eres miembro (o todos, si administras), y
-- `wm_write` solo deja anadir participantes a quien ya administra ESE trabajo o
-- tiene en el `can_manage_members`. O sea que si se abriera `works_insert` a
-- secas, la profesora insertaria el trabajo y acto seguido NO PODRIA ANADIRSE
-- como directora -no es miembro todavia- y el trabajo quedaria invisible para
-- ella misma: una fila huerfana que solo un administrador podria rescatar. Por
-- eso crear un trabajo es UNA operacion transaccional: o entra con su
-- direccion, o no entra. De paso desaparece un defecto conocido del formulario,
-- que hacia el alta en dos pasos y, si el segundo fallaba, dejaba el trabajo
-- sin participantes (estaba escrito en el codigo: «hacerlo atomico exigiria una
-- funcion en la base de datos»).
--
-- `works_insert` NO SE ABRE, y es defensa en profundidad: el camino directo
-- sigue siendo solo de quien administra, y el camino nuevo es esta funcion, que
-- comprueba por dentro lo que tiene que comprobar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La casilla
--
-- Va en `organization_members` y no en `profiles` porque es un permiso DENTRO
-- DE UN GRUPO, no un rasgo de la persona: la misma cuenta podria pertenecer
-- manana a dos organizaciones y no tiene por que poder crear en las dos.
-- Quien la cambia lo decide `org_members_write` (0003), que es solo de la
-- administracion, asi que nadie se la puede poner a si mismo.
-- -----------------------------------------------------------------------------
alter table organization_members
  add column if not exists can_create_works boolean not null default false;

comment on column organization_members.can_create_works is
  'Puede crear trabajos academicos en este grupo sin ser administrador (0034). '
  'Quien administra no la necesita: la funcion pregunta por las dos cosas.';

-- -----------------------------------------------------------------------------
-- 2. Quien puede crear
--
-- Una funcion y no la condicion repetida: la usan la funcion de alta, la
-- autocomprobacion y, el dia que haga falta, cualquier politica. Quien
-- administra entra sin casilla, porque ya podia antes de esta migracion y
-- quitarselo seria una regresion.
-- -----------------------------------------------------------------------------
create or replace function app.puede_crear_trabajos(org uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from organization_members m
     where m.user_id = auth.uid()
       and m.organization_id = org
       and m.is_active
       and (m.role in ('OWNER','ADMIN') or m.can_create_works)
  );
$$;
revoke all on function app.puede_crear_trabajos(uuid) from public;
revoke all on function app.puede_crear_trabajos(uuid) from anon;
grant execute on function app.puede_crear_trabajos(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Crear el trabajo con su direccion, de una vez
--
-- `security definer`, o sea que se salta RLS: la puerta es la comprobacion de
-- la primera linea, y de ahi que sea lo primero que hace.
--
-- QUIEN CREA, DIRIGE -salvo que administre el grupo-. Sin esa regla, cualquiera
-- con la casilla podria crear un trabajo a nombre de otra persona: se quedaria
-- sin verlo (no seria miembro) y le habria adjudicado la direccion de un
-- trabajo a un colega sin que este dijera nada. Quien administra si puede, por
-- lo mismo que puede todo lo demas, y es lo que permite seguir dando de alta
-- los trabajos de los demas cuando toca.
--
-- LAS FUNCIONES ACADEMICAS SE ELIGEN POR SUS PROPIEDADES Y NO POR SU CODIGO:
-- `work_roles` es un catalogo editable -se pueden renombrar y anadir funciones-,
-- asi que la direccion es «la supervisora que gestiona participantes» y el
-- alumno es «la que es de estudiante». Es la misma regla que usa el formulario,
-- y buscar por `code = 'PRIMARY_SUPERVISOR'` se habria roto el dia que alguien
-- editara el catalogo.
-- -----------------------------------------------------------------------------
create or replace function app.crear_trabajo(
  p_organization_id   uuid,
  p_title             text,
  p_work_type_id      uuid,
  p_status_id         uuid,
  p_program_id        uuid     default null,
  p_academic_year_id  uuid     default null,
  p_research_line_id  uuid     default null,
  p_start_date        date     default null,
  p_expected_end_date date     default null,
  p_actual_end_date   date     default null,
  p_defense_date      date     default null,
  p_progress_override smallint default null,
  p_description       text     default null,
  p_objectives        text     default null,
  p_hypothesis        text     default null,
  p_methodology       text     default null,
  p_keywords          text[]   default '{}',
  p_supervisor_id     uuid     default null,
  p_student_id        uuid     default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_admin     boolean;
  v_director  uuid;
  v_rol_dir   uuid;
  v_rol_alu   uuid;
  v_id        uuid;
begin
  if v_uid is null then
    raise exception 'Hay que haber entrado para crear un trabajo'
      using errcode = 'insufficient_privilege';
  end if;

  if not app.puede_crear_trabajos(p_organization_id) then
    raise exception 'No puedes crear trabajos en este grupo. Quien lo administra puede darte permiso desde tu ficha de persona'
      using errcode = 'insufficient_privilege';
  end if;

  v_admin    := app.is_org_admin(p_organization_id);
  v_director := coalesce(p_supervisor_id, v_uid);

  if not v_admin and v_director <> v_uid then
    raise exception 'El trabajo que creas lo diriges tu. Para ponerle otra direccion, anadela despues como codirectora, o que lo cree quien administra el grupo'
      using errcode = 'insufficient_privilege';
  end if;

  -- La direccion y el alumno, del grupo. Sin esto se podria meter en el
  -- trabajo a cualquier cuenta de la base de datos.
  if not exists (
    select 1 from organization_members m
     where m.organization_id = p_organization_id and m.user_id = v_director and m.is_active
  ) then
    raise exception 'La direccion elegida no pertenece a este grupo';
  end if;

  if p_student_id is not null and not exists (
    select 1 from organization_members m
     where m.organization_id = p_organization_id and m.user_id = p_student_id and m.is_active
  ) then
    raise exception 'El alumno elegido no pertenece a este grupo';
  end if;

  select id into v_rol_dir
    from work_roles
   where is_supervisory and can_manage_members and is_active
   order by display_order, name
   limit 1;
  if v_rol_dir is null then
    raise exception 'El catalogo de funciones no tiene ninguna direccion que pueda gestionar participantes';
  end if;

  insert into academic_works (
    organization_id, work_type_id, status_id, program_id, academic_year_id,
    research_line_id, title, description, objectives, hypothesis, methodology,
    keywords, start_date, expected_end_date, actual_end_date, defense_date,
    progress_override, created_by
  ) values (
    p_organization_id, p_work_type_id, p_status_id, p_program_id, p_academic_year_id,
    p_research_line_id, p_title, p_description, p_objectives, p_hypothesis, p_methodology,
    coalesce(p_keywords, '{}'), p_start_date, p_expected_end_date, p_actual_end_date,
    p_defense_date, p_progress_override, v_uid
  ) returning id into v_id;

  insert into work_members (work_id, user_id, work_role_id, is_primary, created_by)
  values (v_id, v_director, v_rol_dir, true, v_uid);

  if p_student_id is not null then
    select id into v_rol_alu
      from work_roles
     where is_student and is_active
     order by display_order, name
     limit 1;
    if v_rol_alu is null then
      raise exception 'El catalogo de funciones no tiene ninguna funcion de estudiante';
    end if;
    insert into work_members (work_id, user_id, work_role_id, is_primary, created_by)
    values (v_id, p_student_id, v_rol_alu, true, v_uid);
  end if;

  return v_id;
end;
$$;
revoke all on function app.crear_trabajo(uuid,text,uuid,uuid,uuid,uuid,uuid,date,date,date,date,smallint,text,text,text,text,text[],uuid,uuid) from public;
revoke all on function app.crear_trabajo(uuid,text,uuid,uuid,uuid,uuid,uuid,date,date,date,date,smallint,text,text,text,text,text[],uuid,uuid) from anon;
grant execute on function app.crear_trabajo(uuid,text,uuid,uuid,uuid,uuid,uuid,date,date,date,date,smallint,text,text,text,text,text[],uuid,uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. La puerta para la aplicacion
--
-- PostgREST solo publica `public`, asi que el esquema `app` no se puede llamar
-- desde el navegador. El envoltorio no decide nada: delega.
-- -----------------------------------------------------------------------------
create or replace function public.crear_trabajo(
  p_organization_id   uuid,
  p_title             text,
  p_work_type_id      uuid,
  p_status_id         uuid,
  p_program_id        uuid     default null,
  p_academic_year_id  uuid     default null,
  p_research_line_id  uuid     default null,
  p_start_date        date     default null,
  p_expected_end_date date     default null,
  p_actual_end_date   date     default null,
  p_defense_date      date     default null,
  p_progress_override smallint default null,
  p_description       text     default null,
  p_objectives        text     default null,
  p_hypothesis        text     default null,
  p_methodology       text     default null,
  p_keywords          text[]   default '{}',
  p_supervisor_id     uuid     default null,
  p_student_id        uuid     default null
) returns uuid
language sql security definer
set search_path = public, pg_temp
as $$
  select app.crear_trabajo(
    p_organization_id, p_title, p_work_type_id, p_status_id, p_program_id,
    p_academic_year_id, p_research_line_id, p_start_date, p_expected_end_date,
    p_actual_end_date, p_defense_date, p_progress_override, p_description,
    p_objectives, p_hypothesis, p_methodology, p_keywords, p_supervisor_id,
    p_student_id
  );
$$;
revoke all on function public.crear_trabajo(uuid,text,uuid,uuid,uuid,uuid,uuid,date,date,date,date,smallint,text,text,text,text,text[],uuid,uuid) from public;
revoke all on function public.crear_trabajo(uuid,text,uuid,uuid,uuid,uuid,uuid,date,date,date,date,smallint,text,text,text,text,text[],uuid,uuid) from anon;
grant execute on function public.crear_trabajo(uuid,text,uuid,uuid,uuid,uuid,uuid,date,date,date,date,smallint,text,text,text,text,text[],uuid,uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Autocomprobaciones
-- -----------------------------------------------------------------------------
do $$
declare v_def text; v_n int;
begin
  -- La casilla nace apagada: esta migracion no concede nada por si sola.
  if exists (
    select 1 from organization_members where can_create_works
  ) then
    raise notice '0034 AVISO: ya hay % persona(s) con la casilla encendida',
      (select count(*) from organization_members where can_create_works);
  end if;

  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'organization_members'
         and column_name = 'can_create_works') is distinct from 'false' then
    raise exception '0034: la casilla de crear trabajos no nace apagada';
  end if;

  -- Las dos funciones, ejecutables por quien debe y por nadie mas.
  if not has_function_privilege('authenticated', 'app.puede_crear_trabajos(uuid)', 'execute') then
    raise exception '0034: authenticated no puede preguntar quien crea trabajos';
  end if;
  if has_function_privilege('anon', 'app.puede_crear_trabajos(uuid)', 'execute') then
    raise exception '0034: anon puede ejecutar una funcion de app';
  end if;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'crear_trabajo' and n.nspname in ('app','public');
  if v_n <> 2 then
    raise exception '0034: faltan la funcion de alta o su puerta publica (encontradas %)', v_n;
  end if;

  if has_function_privilege('anon',
       'public.crear_trabajo(uuid,text,uuid,uuid,uuid,uuid,uuid,date,date,date,date,smallint,text,text,text,text,text[],uuid,uuid)',
       'execute') then
    raise exception '0034: anon puede crear trabajos';
  end if;

  -- Y lo que esta migracion NO abre: el camino directo sigue siendo de quien
  -- administra, y el borrado tambien.
  if (select coalesce(with_check,'') from pg_policies
       where schemaname = 'public' and tablename = 'academic_works'
         and policyname = 'works_insert') not like '%is_org_admin%' then
    raise exception '0034: works_insert ha dejado de exigir administracion del grupo';
  end if;
  if (select coalesce(qual,'') from pg_policies
       where schemaname = 'public' and tablename = 'academic_works'
         and policyname = 'works_delete') not like '%is_org_admin%' then
    raise exception '0034: el borrado de trabajos ha dejado de ser de quien administra';
  end if;

  -- Quien crea, dirige: la regla vive dentro de la funcion.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'crear_trabajo';
  if v_def not like '%v_director <> v_uid%' then
    raise exception '0034: la funcion de alta ya no exige que quien crea dirija';
  end if;
  if v_def not like '%work_members%' then
    raise exception '0034: la funcion de alta no anade la direccion: el trabajo naceria huerfano';
  end if;

  raise notice '0034 OK: crear un trabajo es un permiso propio, y nace con su direccion.';
end $$;
