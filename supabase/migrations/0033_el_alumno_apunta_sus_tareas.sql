-- =============================================================================
-- 0033 · El alumno apunta sus propias tareas
--
-- EL CASO REAL: quien hace el trabajo sabe antes que nadie lo que le falta por
-- hacer. Desde la 0030 podia escribir su tarjeta entera, los puntos de su
-- lista, sus hitos y el contenido academico de su trabajo... pero no CREAR una
-- tarjeta: `tasks_insert` pedia `can_manage_plan`, y la unica rendija era
-- `app.is_checklist_point_of_mine`, o sea un punto colgado de una tarea que
-- alguien le hubiera asignado antes. Resultado: para apuntar «releer los tres
-- articulos de Smith» habia que pedirselo al director por otro canal, que es
-- justo el cuello de botella que la 0030 vino a quitar, y se dejo a medias.
--
-- LO QUE SE CONCEDE, Y SUS CUATRO LIMITES. El alumno de un trabajo puede
-- insertar en `tasks` si la fila dice:
--
--   1. SU trabajo            `app.is_work_student(work_id)` recibe el trabajo y
--                            mira la pertenencia activa con funcion de
--                            estudiante. Ser alumno de un trabajo no da nada en
--                            otro: el mismo limite que fija la prueba [185].
--   2. SUYA                  `assignee_id = app.uid()`. Apuntarse trabajo a uno
--                            mismo es hacer el trabajo; apuntarselo a OTRO es
--                            planificar, y eso sigue siendo de la direccion. Sin
--                            esta linea, un alumno podria crear tareas a nombre
--                            de su director -o dejarlas sin responsable, que en
--                            un tablero compartido es lo mismo que mandarselas a
--                            quien pase por alli-.
--   3. DE PRIMER NIVEL       `parent_task_id is null`. Colgar un punto de una
--                            tarea propia ya lo permite la rendija de la 0030,
--                            que ademas comprueba que el padre sea suyo; sin
--                            este limite, esta via nueva permitiria colgar
--                            puntos de la tarea de un tercero.
--   4. VIVA                  `deleted_at is null`. Una tarea que naciera
--                            archivada caeria en una papelera que el alumno no
--                            puede abrir (0025): invisible para quien la
--                            escribe, e imposible de recuperar sin pedirlo.
--
-- LO QUE NO SE CONCEDE, QUE ES LA PARTE QUE HAY QUE VIGILAR. Conceder es la
-- direccion peligrosa (SECURITY.md §5.2.tricies): un permiso de mas no da
-- ningun error y no se ve hasta que alguien ha cambiado lo que no debia.
--
--   · `tasks_delete` NO SE TOCA: el borrado definitivo sigue siendo de quien
--     planifica.
--   · ARCHIVAR TAMPOCO, y no por cautela: `app.enforce_task_update_scope`
--     protege `deleted_at`, y aunque no lo hiciera, `tasks_select` (0025) solo
--     ensena lo archivado a quien tiene `can_manage_plan`, de modo que
--     PostgreSQL rechaza el UPDATE porque la fila deja de ser visible para
--     quien la escribe. Es el mismo muro que encontro la 0030 con los puntos de
--     la lista, y la respuesta es la misma: SE CREA Y SE CORRIGE, Y QUITARLO LO
--     HACE QUIEN PLANIFICA. Una tarjeta sobrante se renombra o se completa; que
--     desaparezca lo decide el plan.
--   · EL RESPONSABLE, una vez creada, tampoco: el disparador de alcance lo
--     rechaza desde la 0003. Se crea suya y suya se queda hasta que la
--     direccion diga otra cosa.
--   · EL PROGRESO ACADEMICO sigue siendo el juicio del supervisor
--     (`progress_override`). Lo que si se mueve es el recuento mecanico de
--     tareas completadas, y eso es correcto: es un recuento, no una nota.
--
-- POR QUE NO HAY FUNCION NUEVA. Las tres condiciones de la rama nueva son
-- comprobaciones sobre la propia fila que se inserta -no hay que consultar
-- nada mas que `work_id` y el usuario-, asi que meterlas en una funcion solo
-- esconderia la politica en otro fichero. La 0030 creo `can_manage_meetings`
-- porque la MISMA condicion la necesitaban tres politicas distintas; aqui es
-- una sola.
-- =============================================================================

alter policy tasks_insert on tasks
  with check (
    app.can_manage_plan(work_id)
    or app.is_checklist_point_of_mine(parent_task_id, work_id)
    or (
      app.is_work_student(work_id)
      and parent_task_id is null
      and assignee_id = app.uid()
      and deleted_at is null
    )
  );

-- -----------------------------------------------------------------------------
-- Autocomprobaciones
--
-- Se mira el TEXTO de las politicas, que es lo unico que se puede mirar sin
-- usuarios de verdad; las pruebas [196]-[199] hacen el resto con sesiones
-- reales. Lo que se vigila no es que la rama nueva este -si no estuviera, la
-- pantalla fallaria y se veria el mismo dia-, sino que las dos condiciones que
-- la acotan no se caigan en un futuro `alter policy`.
-- -----------------------------------------------------------------------------
do $$
declare v_check text; v_del text; v_def text;
begin
  select with_check into v_check
    from pg_policies
   where schemaname = 'public' and tablename = 'tasks' and policyname = 'tasks_insert';

  if v_check is null or v_check not like '%is_work_student%' then
    raise exception '0033: el alumno no puede crear tareas en su trabajo';
  end if;
  if v_check not like '%assignee_id = app.uid()%' then
    raise exception '0033: el alta del alumno no exige que la tarea sea SUYA';
  end if;
  if v_check not like '%parent_task_id IS NULL%' then
    raise exception '0033: el alta del alumno no se limita a tareas de primer nivel';
  end if;
  if v_check not like '%deleted_at IS NULL%' then
    raise exception '0033: una tarea del alumno podria nacer en la papelera';
  end if;

  -- El borrado definitivo, donde estaba.
  select qual into v_del
    from pg_policies
   where schemaname = 'public' and tablename = 'tasks' and policyname = 'tasks_delete';
  if v_del is null or v_del like '%is_work_student%' then
    raise exception '0033: el borrado definitivo de tareas ha dejado de ser de quien planifica';
  end if;

  -- Y el disparador de alcance, con el responsable y el archivado protegidos.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'enforce_task_update_scope';
  if v_def not like '%assignee_id%' or v_def not like '%deleted_at%' then
    raise exception '0033: enforce_task_update_scope ha perdido el responsable o el archivado';
  end if;

  raise notice '0033 OK: el alumno apunta sus tareas, y el plan sigue siendo del plan.';
end $$;
