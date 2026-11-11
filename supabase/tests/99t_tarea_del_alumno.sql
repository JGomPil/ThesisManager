-- =============================================================================
-- El alumno apunta sus propias tareas (migracion 0033)
--
-- QUE SE JUEGA AQUI
-- La 0033 CONCEDE un alta, y un alta es la operacion mas ancha que existe: en
-- un INSERT no hay fila anterior con la que comparar, asi que no hay disparador
-- de alcance que lo acote -`app.enforce_task_update_scope` es `before update`-.
-- Todo lo que limita esta concesion esta en el `with check` de la politica, y
-- por eso de las cuatro pruebas tres comprueban lo que NO se ha abierto.
--
-- Y hay una razon de mas para mirarlo: una fila insertada con un `work_id`
-- ajeno NO DA ERROR EN NINGUNA PANTALLA. Aparece en el plan de otro trabajo
-- como si la hubiera escrito su director.
--
--   1111... administrador del grupo
--   2222... direccion principal de TFG-01 (y estudiante de TESIS-02)
--   3333... estudiante de TFG-01, y nada en TESIS-02
--   4444... ajeno a los dos trabajos
--   bbbb...0001 = TFG-01    ·    bbbb...0002 = TESIS-02
-- =============================================================================

\echo '================ EL ALUMNO APUNTA SUS TAREAS ================'

\echo '[196] El alumno apunta una tarea suya en su trabajo, y la escribe entera'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);

  insert into tasks (id, work_id, title, assignee_id, due_date)
  values ('dddddddd-0033-0000-0000-000000000196','bbbbbbbb-0000-0000-0000-000000000001',
          'Releer los tres articulos de Smith','33333333-3333-3333-3333-333333333333',
          current_date + 10);

  -- Y lo que la 0030 ya le daba sobre SU tarea, que es lo que hace util el
  -- alta: si pudiera crearla pero no corregirla, habria que crearla perfecta.
  update tasks
     set title = 'Releer los cuatro articulos de Smith',
         description = 'Para el apartado de antecedentes',
         priority = 'ALTA',
         color = 'teal'
   where id = 'dddddddd-0033-0000-0000-000000000196';

  -- Un punto de su lista: la rendija de la 0030 sigue abierta y no la ha
  -- tapado la rama nueva (que exige `parent_task_id is null`).
  insert into tasks (id, work_id, parent_task_id, title, assignee_id)
  values ('dddddddd-0033-0000-0000-000000000296','bbbbbbbb-0000-0000-0000-000000000001',
          'dddddddd-0033-0000-0000-000000000196','Buscar el de 2019',
          '33333333-3333-3333-3333-333333333333');
  reset role;

  if not exists (
    select 1 from tasks
     where id = 'dddddddd-0033-0000-0000-000000000196'
       and title = 'Releer los cuatro articulos de Smith'
       and priority = 'ALTA'
       and assignee_id = '33333333-3333-3333-3333-333333333333'
  ) then
    raise exception 'FALLO [196]: el alumno no ha podido apuntar su tarea';
  end if;
  if not exists (select 1 from tasks where id = 'dddddddd-0033-0000-0000-000000000296') then
    raise exception 'FALLO [196]: el alumno no ha podido anadir un punto a su lista';
  end if;
  raise notice 'CORRECTO [196]';
end $$;
reset role;

\echo '[197] Lo que apunta es SUYO: ni a nombre de otro, ni sin responsable, ni archivado'
do $$
declare v_colada text := '';
begin
  -- Una tarea de la direccion, para intentar colgar un punto de algo ajeno.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into tasks (id, work_id, title, assignee_id)
  values ('dddddddd-0033-0000-0000-000000000197','bbbbbbbb-0000-0000-0000-000000000001',
          'Revisar el borrador','22222222-2222-2222-2222-222222222222');
  reset role;

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);

  -- a) A nombre de su director: apuntarle trabajo a otro es planificar.
  begin
    insert into tasks (id, work_id, title, assignee_id)
    values ('dddddddd-0033-0000-0000-000000000297','bbbbbbbb-0000-0000-0000-000000000001',
            'Que el director me resuma el estado del arte',
            '22222222-2222-2222-2222-222222222222');
    v_colada := v_colada || 'a nombre de otro; ';
  exception when others then null;
  end;

  -- b) Sin responsable: en un tablero compartido, una tarea sin dueno es una
  --    tarea para quien pase por alli.
  begin
    insert into tasks (id, work_id, title)
    values ('dddddddd-0033-0000-0000-000000000397','bbbbbbbb-0000-0000-0000-000000000001',
            'Alguien tendria que mirar esto');
    v_colada := v_colada || 'sin responsable; ';
  exception when others then null;
  end;

  -- c) Colgada de la tarea de su director: seria escribir en la lista de otro.
  begin
    insert into tasks (id, work_id, parent_task_id, title, assignee_id)
    values ('dddddddd-0033-0000-0000-000000000497','bbbbbbbb-0000-0000-0000-000000000001',
            'dddddddd-0033-0000-0000-000000000197','Y que lo haga el viernes',
            '33333333-3333-3333-3333-333333333333');
    v_colada := v_colada || 'en la lista de otro; ';
  exception when others then null;
  end;

  -- d) Naciendo en la papelera, que el alumno no puede abrir (0025).
  begin
    insert into tasks (id, work_id, title, assignee_id, deleted_at)
    values ('dddddddd-0033-0000-0000-000000000597','bbbbbbbb-0000-0000-0000-000000000001',
            'Nacida archivada','33333333-3333-3333-3333-333333333333', now());
    v_colada := v_colada || 'archivada; ';
  exception when others then null;
  end;
  reset role;

  -- No basta con que no haya dado error: lo que importa es si hay fila. Se
  -- comprueba FUERA de la sesion del alumno, porque dentro de ella una fila
  -- archivada no se veria y la prueba se felicitaria sola.
  if exists (
    select 1 from tasks
     where id in ('dddddddd-0033-0000-0000-000000000297','dddddddd-0033-0000-0000-000000000397',
                  'dddddddd-0033-0000-0000-000000000497','dddddddd-0033-0000-0000-000000000597')
  ) or v_colada <> '' then
    raise exception 'FALLO DE SEGURIDAD [197]: el alumno ha colado una tarea %', v_colada;
  end if;
  raise notice 'CORRECTO [197]';
end $$;
reset role;

\echo '[198] Ser alumno de un trabajo no deja apuntar nada en otro'
do $$
declare v_colada text := '';
begin
  -- El alumno de TFG-01 en TESIS-02, donde no es nada. `app.is_work_student`
  -- recibe el trabajo: escrita como «tiene alguna funcion de estudiante?»
  -- esto pasaria, y no fallaria ninguna pantalla.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    insert into tasks (id, work_id, title, assignee_id)
    values ('dddddddd-0033-0000-0000-000000000198','bbbbbbbb-0000-0000-0000-000000000002',
            'Apuntada en la tesis de otro','33333333-3333-3333-3333-333333333333');
    v_colada := v_colada || 'el alumno de TFG-01 en TESIS-02; ';
  exception when others then null;
  end;
  reset role;

  -- Y el ajeno, que no es nada en ninguno de los dos.
  set local role authenticated;
  perform set_config('test.uid','44444444-4444-4444-4444-444444444444', true);
  begin
    insert into tasks (id, work_id, title, assignee_id)
    values ('dddddddd-0033-0000-0000-000000000298','bbbbbbbb-0000-0000-0000-000000000001',
            'Apuntada por un desconocido','44444444-4444-4444-4444-444444444444');
    v_colada := v_colada || 'un ajeno en TFG-01; ';
  exception when others then null;
  end;
  reset role;

  if exists (
    select 1 from tasks
     where id in ('dddddddd-0033-0000-0000-000000000198','dddddddd-0033-0000-0000-000000000298')
  ) or v_colada <> '' then
    raise exception 'FALLO DE SEGURIDAD [198]: %', v_colada;
  end if;
  raise notice 'CORRECTO [198]';
end $$;
reset role;

\echo '[199] La tarea que apunta no la borra ni la archiva: quitarla es del plan'
do $$
declare v_borrada boolean := false; v_archivada boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);

  -- Archivar: lo rechaza el disparador de alcance, y aunque no lo rechazara,
  -- la fila dejaria de ser visible para quien la escribe y PostgreSQL mataria
  -- el UPDATE. Es el muro que encontro la 0030 con los puntos de la lista.
  begin
    update tasks set deleted_at = now()
     where id = 'dddddddd-0033-0000-0000-000000000196';
    v_archivada := true;
  exception when others then null;
  end;

  begin
    delete from tasks where id = 'dddddddd-0033-0000-0000-000000000196';
    v_borrada := true;
  exception when others then null;
  end;
  reset role;

  -- El DELETE no levanta excepcion: la politica lo filtra a cero filas y
  -- PostgreSQL lo da por bueno. Hay que mirar la fila, no el error.
  if not exists (
    select 1 from tasks
     where id = 'dddddddd-0033-0000-0000-000000000196' and deleted_at is null
  ) then
    raise exception 'FALLO DE SEGURIDAD [199]: el alumno ha quitado su tarea de en medio (archivada=%, borrada=%)',
      v_archivada, v_borrada;
  end if;

  -- Y quien planifica, si: la tarjeta sobrante tiene salida, solo que no la
  -- decide quien la escribio.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set deleted_at = now() where id = 'dddddddd-0033-0000-0000-000000000196';
  reset role;

  if not exists (
    select 1 from tasks
     where id = 'dddddddd-0033-0000-0000-000000000196' and deleted_at is not null
  ) then
    raise exception 'FALLO [199]: quien planifica no ha podido archivar la tarea del alumno';
  end if;
  raise notice 'CORRECTO [199]';
end $$;
reset role;
