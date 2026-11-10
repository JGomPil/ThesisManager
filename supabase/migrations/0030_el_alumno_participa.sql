-- =============================================================================
-- 0030 · El alumno participa en su trabajo
--
-- QUE CAMBIA, Y POR QUE
-- El modelo trataba al estudiante como alguien a quien se le planifica: podia
-- cambiar el estado de SU tarea, moverla de columna y poco mas. Todo lo demas
-- —escribir los pasos de su propio trabajo, convocar una reunion, poner sus
-- hitos, corregir la metodologia que ha escrito el— pasaba por pedirselo a la
-- direccion. Para una tesis de cuatro anos eso no es una salvaguarda: es un
-- cuello de botella que convierte la herramienta en algo que solo usa quien
-- dirige.
--
-- LO QUE NO SE TOCA, Y ES LO IMPORTANTE DE ESTA MIGRACION:
--   · El PROGRESO ACADEMICO sigue siendo de la direccion. La columna dice
--     literalmente «a juicio del supervisor»: un alumno que se pone el 100 %
--     convierte el dato en ruido.
--   · El ESTADO DEL TRABAJO, las fechas, el tipo, el programa y el curso,
--     tambien. Son el expediente, no el contenido.
--   · El RESPONSABLE de una tarea lo decide quien planifica. Asignarse trabajo
--     a uno mismo es planificar.
--   · ARCHIVAR una tarea, igual.
--   · Las NOTAS PRIVADAS de supervision siguen invisibles para el estudiante
--     (`can_see_private_notes` se fuerza a falso si alguna funcion activa es de
--     estudiante). Esta migracion no las roza.
--
-- Las cuatro cosas que se conceden —puntos de lista y edicion de la tarea
-- propia, reuniones, hitos y contenido academico— son del TRABAJO DE UNO: no
-- dan acceso a nada ajeno, porque todas las funciones de abajo comprueban el
-- trabajo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ¿Soy el alumno de este trabajo?
--
-- Se mira la FUNCION ACADEMICA (`work_roles.is_student`), no el rol
-- administrativo: ser administrador del grupo no te hace alumno de nada, y al
-- reves, el alumno de un trabajo no tiene nada que hacer en otro. La condicion
-- de `end_date` es la misma que usa `app.has_work_capability`: una relacion
-- academica terminada deja de dar derechos sin tener que borrar la fila, que es
-- lo que conserva el historial.
-- -----------------------------------------------------------------------------
create or replace function app.is_work_student(work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from work_members wm
      join work_roles r on r.id = wm.work_role_id
     where wm.work_id = work
       and wm.user_id = auth.uid()
       and wm.status = 'ACTIVE'
       and r.is_student
       and (wm.end_date is null or wm.end_date >= current_date)
  );
$$;
revoke all on function app.is_work_student(uuid) from public;
revoke all on function app.is_work_student(uuid) from anon;
grant execute on function app.is_work_student(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Las reuniones del trabajo
--
-- UNA FUNCION Y NO LA CONDICION REPETIDA TRES VECES. La 0011 existe justamente
-- porque `meetings_write` admitia administracion y las politicas de
-- participantes y acuerdos no: un administrador creaba una reunion y despues no
-- podia anadirle a nadie. Incoherencia, no decision. Con las tres politicas
-- mirando al mismo sitio, eso no puede volver a pasar.
-- -----------------------------------------------------------------------------
create or replace function app.can_manage_meetings(work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.is_work_supervisor(work)
      or app.is_admin_of_work(work)
      or app.is_work_student(work);
$$;
revoke all on function app.can_manage_meetings(uuid) from public;
revoke all on function app.can_manage_meetings(uuid) from anon;
grant execute on function app.can_manage_meetings(uuid) to authenticated;

alter policy meetings_write on meetings
  using (app.can_manage_meetings(work_id))
  with check (app.can_manage_meetings(work_id));

alter policy mparts_write on meeting_participants
  using (exists (
    select 1 from meetings m where m.id = meeting_id and app.can_manage_meetings(m.work_id)
  ))
  with check (exists (
    select 1 from meetings m where m.id = meeting_id and app.can_manage_meetings(m.work_id)
  ));

alter policy agreements_write on meeting_agreements
  using (app.can_manage_meetings(work_id))
  with check (app.can_manage_meetings(work_id));

-- -----------------------------------------------------------------------------
-- 3. Los hitos
--
-- Un hito es una fecha que hay que cumplir —deposito, defensa, envio de un
-- articulo—, y quien la cumple es el alumno. Que tuviera que pedir que le
-- apunten la suya era el ejemplo mas claro del cuello de botella.
-- -----------------------------------------------------------------------------
alter policy milestones_write on milestones
  using (app.can_manage_plan(work_id) or app.is_work_student(work_id))
  with check (app.can_manage_plan(work_id) or app.is_work_student(work_id));

-- -----------------------------------------------------------------------------
-- 4. Los puntos de la lista de comprobacion
--
-- Un punto es una subtarea (`tasks.parent_task_id`), asi que crear uno es un
-- INSERT en `tasks`, que exigia `can_manage_plan`. Resultado: el alumno podia
-- MARCAR los puntos de su tarea desde la 0009, pero no escribirlos, que es lo
-- que se hace con una lista de comprobacion.
--
-- `t.work_id = work` NO SOBRA: sin esa comprobacion, quien tenga una tarea
-- asignada podria insertar una fila con el `work_id` de otro trabajo y el
-- `parent_task_id` de la suya, y la fila aparecerian en el plan ajeno. La
-- politica solo mira lo que se le pide que mire.
-- -----------------------------------------------------------------------------
create or replace function app.is_checklist_point_of_mine(parent uuid, work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select parent is not null
     and exists (
       select 1 from tasks t
        where t.id = parent
          and t.assignee_id = auth.uid()
          and t.work_id = work
          and t.deleted_at is null
     );
$$;
revoke all on function app.is_checklist_point_of_mine(uuid, uuid) from public;
revoke all on function app.is_checklist_point_of_mine(uuid, uuid) from anon;
grant execute on function app.is_checklist_point_of_mine(uuid, uuid) to authenticated;

alter policy tasks_insert on tasks
  with check (
    app.can_manage_plan(work_id)
    or app.is_checklist_point_of_mine(parent_task_id, work_id)
  );

-- `tasks_delete` NO se toca: el borrado definitivo sigue siendo de quien
-- planifica. Quitar un punto de la lista no pasa por ahi —se archiva, y la
-- papelera de la 0025 lo devuelve—, asi que lo decide el disparador de abajo.

-- -----------------------------------------------------------------------------
-- 5. Que puede cambiar cada cual de una tarea
--
-- Cuarta version de este disparador (0003, 0024, 0025, 0026). RLS decide SI se
-- puede tocar la fila; esto, QUE COLUMNAS. El reparto queda asi:
--
--   quien planifica          todo
--   el responsable           todo menos el responsable y archivar la tarea
--   un punto de MI tarea     lo mismo: escribirlo y corregirlo, no quitarlo
--   cualquier otro           el estado y su sitio en el tablero
--
-- La linea nueva es la segunda. Antes de la 0030 el responsable solo cambiaba
-- el estado, la fecha y el sitio en el tablero: el titulo, la descripcion, la
-- prioridad y el color eran del plan. Era defendible mientras el plan lo
-- escribiera la direccion de arriba abajo, pero la tarjeta es donde el alumno
-- cuenta lo que esta haciendo, y no poder corregir su propio titulo le obligaba
-- a pedirlo por correo.
--
-- El orden de las comprobaciones importa: lo que NUNCA cambia va primero y para
-- a todo el mundo, de modo que los permisos de abajo no pueden ensancharlo sin
-- querer.
--
-- POR QUE EL ALUMNO NO QUITA UN PUNTO DE SU PROPIA LISTA, que es lo que parecia
-- natural al escribir esto. Quitar un punto no lo borra: lo ARCHIVA (0025). Y
-- `tasks_select`, desde esa misma migracion, solo ensena lo archivado a quien
-- tiene `can_manage_plan`. O sea que un punto archivado por el alumno caeria en
-- una papelera que el alumno NO PUEDE ABRIR: una accion irreversible para quien
-- la hace, que es justo lo que la 0025 vino a quitar de en medio.
--
-- No es una conjetura: PostgreSQL lo rechaza por su cuenta. La fila resultante
-- deja de ser visible para quien la escribe y el UPDATE muere con «new row
-- violates row-level security policy». Lo destapo la prueba [45].
--
-- Las dos salidas serian ensenarle su papelera —pero la papelera es de quien
-- planifica, y eso lo decidio la 0025 a proposito— o darle un borrado de
-- verdad, irreversible, que es peor. Asi que un punto se escribe y se corrige,
-- y quitarlo lo hace quien planifica. Una errata se arregla renombrando.
-- -----------------------------------------------------------------------------
create or replace function app.enforce_task_update_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if app.can_manage_plan(new.work_id) then
    return new;
  end if;

  -- De quien es la tarea y donde vive: de la direccion, para todos los demas.
  -- Asignarse trabajo a uno mismo, o mudar una tarea de trabajo, es planificar.
  if (new.assignee_id, new.work_id, new.parent_task_id)
     is distinct from
     (old.assignee_id, old.work_id, old.parent_task_id)
  then
    raise exception 'El responsable de una tarea y el trabajo al que pertenece los decide quien planifica';
  end if;

  -- Mi tarea, o un punto de la lista de una tarea mia: todo menos archivarlo.
  -- Lo de archivar se explica largo arriba; en corto: lo archivado solo lo ve
  -- quien planifica, asi que dejarlo aqui seria dar una accion sin vuelta
  -- atras a quien no puede deshacerla.
  if old.assignee_id = auth.uid() or app.is_parent_task_assignee(old.parent_task_id) then
    if new.deleted_at is distinct from old.deleted_at then
      raise exception 'Archivar una tarea o un punto de su lista es cosa de quien planifica';
    end if;
    return new;
  end if;

  -- Cualquier otro: el estado y su sitio en el tablero, como hasta ahora.
  if (new.title, new.description, new.priority, new.start_date, new.due_date,
      new.milestone_id, new.deleted_at, new.color)
     is distinct from
     (old.title, old.description, old.priority, old.start_date, old.due_date,
      old.milestone_id, old.deleted_at, old.color)
  then
    raise exception 'Solo puede actualizarse el estado de la tarea y su sitio en el tablero';
  end if;

  return new;
end;
$$;
revoke all on function app.enforce_task_update_scope() from public;

-- -----------------------------------------------------------------------------
-- 6. El contenido academico del trabajo
--
-- `works_update` admite ahora tambien al alumno, y un disparador limita a que
-- columnas. El reparto es el mismo que hace la pantalla: «Contenido academico»
-- —descripcion, objetivos, hipotesis, metodologia y palabras clave— es lo que
-- escribe quien hace el trabajo; el expediente —estado, fechas, tipo, programa,
-- curso y el progreso a juicio de la direccion— es de quien lo dirige.
--
-- SE COMPARA POR LISTA BLANCA, no por lista negra, y es a proposito. El
-- disparador de las tareas enumera las columnas PROTEGIDAS, y por eso la 0026
-- tuvo que anadir una autocomprobacion de que `color` seguia en la lista: una
-- columna nueva nace desprotegida y nadie se acuerda. Aqui se enumeran las
-- columnas LIBRES y se compara el resto con `to_jsonb(...) - array[...]`, de
-- modo que cualquier columna que se anada manana a `academic_works` nace
-- protegida. Es la unica diferencia de fondo entre los dos, y va en esta
-- direccion porque `academic_works` tiene veinticinco columnas y crece.
--
-- `updated_at` va en la lista de libres porque lo escribe el disparador
-- `academic_works_updated_at`, que es tambien `before update` y se ejecuta
-- ANTES que este (PostgreSQL los ordena por nombre, y «a» va antes que «e»).
-- Sin eso, cualquier edicion del alumno fallaria por una columna que no ha
-- tocado.
-- -----------------------------------------------------------------------------
alter policy works_update on academic_works
  using (
    app.is_org_admin(organization_id)
    or app.is_work_supervisor(id)
    or app.is_work_student(id)
  )
  with check (
    app.is_org_admin(organization_id)
    or app.is_work_supervisor(id)
    or app.is_work_student(id)
  );

create or replace function app.enforce_work_update_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if app.is_org_admin(new.organization_id) or app.is_work_supervisor(new.id) then
    return new;
  end if;

  if (to_jsonb(new) - array['description','objectives','hypothesis','methodology','keywords','updated_at'])
     is distinct from
     (to_jsonb(old) - array['description','objectives','hypothesis','methodology','keywords','updated_at'])
  then
    raise exception 'De tu trabajo puedes cambiar el contenido academico: descripcion, objetivos, hipotesis, metodologia y palabras clave'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;
revoke all on function app.enforce_work_update_scope() from public;

drop trigger if exists enforce_work_update_scope on academic_works;
create trigger enforce_work_update_scope
  before update on academic_works
  for each row execute function app.enforce_work_update_scope();

-- -----------------------------------------------------------------------------
-- 7. Autocomprobaciones
-- -----------------------------------------------------------------------------
do $$
declare v_def text;
begin
  -- Las funciones nuevas, ejecutables por quien debe y por nadie mas.
  if not has_function_privilege('authenticated', 'app.is_work_student(uuid)', 'execute')
  or not has_function_privilege('authenticated', 'app.can_manage_meetings(uuid)', 'execute')
  or not has_function_privilege('authenticated', 'app.is_checklist_point_of_mine(uuid,uuid)', 'execute') then
    raise exception '0030: authenticated no puede ejecutar las funciones nuevas';
  end if;
  if has_function_privilege('anon', 'app.is_work_student(uuid)', 'execute')
  or has_function_privilege('anon', 'app.can_manage_meetings(uuid)', 'execute')
  or has_function_privilege('anon', 'app.is_checklist_point_of_mine(uuid,uuid)', 'execute') then
    raise exception '0030: anon puede ejecutar una funcion de app';
  end if;

  -- El disparador del trabajo, puesto.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.academic_works'::regclass
       and tgname = 'enforce_work_update_scope'
  ) then
    raise exception '0030: falta el disparador enforce_work_update_scope';
  end if;

  -- Y lo que esta migracion NO concede, que es lo que hay que vigilar: el
  -- progreso y el estado del trabajo siguen fuera de la lista blanca.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enforce_work_update_scope';
  if v_def like '%progress_override%' or v_def like '%status_id%' then
    raise exception '0030: el progreso o el estado del trabajo han entrado en la lista blanca';
  end if;

  -- El disparador de las tareas sigue protegiendo al responsable y el archivado.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enforce_task_update_scope';
  if v_def not like '%assignee_id%' or v_def not like '%deleted_at%' then
    raise exception '0030: enforce_task_update_scope ha perdido el responsable o el archivado';
  end if;

  raise notice '0030 OK: el alumno participa en su trabajo, y el expediente sigue siendo de la direccion.';
end $$;
