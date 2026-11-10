-- =============================================================================
-- El alumno participa en su trabajo (migracion 0030)
--
-- QUE SE JUEGA AQUI
-- Esta migracion CONCEDE, que es la direccion peligrosa: un permiso de mas no
-- da ningun error, no rompe ninguna pantalla y no se nota hasta que alguien
-- cambia algo que no debia. Asi que de las cinco pruebas, tres comprueban lo
-- que NO se ha abierto —el progreso academico, el estado del trabajo y el
-- responsable de una tarea— y las otras dos, que lo concedido llega de verdad
-- hasta la fila.
--
-- Y el limite de todo esto es SU trabajo: `app.is_work_student` comprueba el
-- trabajo, de modo que el alumno de TFG-01 no es alumno de nada mas. La [185]
-- lo fija en el sitio mas goloso, el contenido academico.
--
--   2222... direccion principal de TFG-01 (y estudiante de TESIS-02)
--   3333... estudiante de TFG-01
--   bbbb...0001 = TFG-01    ·    bbbb...0002 = TESIS-02
-- =============================================================================

\echo '================ EL ALUMNO PARTICIPA ================'

\echo '[181] El alumno escribe su tarea entera, pero no el responsable'
do $$
declare v_reasignada boolean := false;
begin
  -- Una tarea suya, recien hecha, para no depender de lo que hayan dejado
  -- otras pruebas.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into tasks (id, work_id, title, assignee_id)
  values ('dddddddd-0000-0000-0000-000000000181','bbbbbbbb-0000-0000-0000-000000000001',
          'Escribir el capitulo de metodos','33333333-3333-3333-3333-333333333333');
  reset role;

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update tasks
     set title = 'Escribir el capitulo de metodos (v2)',
         description = 'Con el apartado de estadistica',
         priority = 'ALTA',
         due_date = current_date + 20,
         color = 'violet'
   where id = 'dddddddd-0000-0000-0000-000000000181';
  reset role;

  if not exists (
    select 1 from tasks
     where id = 'dddddddd-0000-0000-0000-000000000181'
       and title = 'Escribir el capitulo de metodos (v2)'
       and priority = 'ALTA'
       and color = 'violet'
  ) then
    raise exception 'FALLO [181]: el alumno no ha podido escribir su propia tarea';
  end if;

  -- Y lo que sigue siendo de quien planifica: de quien es la tarea.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update tasks set assignee_id = '22222222-2222-2222-2222-222222222222'
     where id = 'dddddddd-0000-0000-0000-000000000181';
    v_reasignada := true;
  exception when others then null;
  end;
  reset role;

  if v_reasignada or (select assignee_id from tasks where id = 'dddddddd-0000-0000-0000-000000000181')
       <> '33333333-3333-3333-3333-333333333333' then
    raise exception 'FALLO DE SEGURIDAD [181]: el alumno se ha reasignado la tarea';
  end if;
  raise notice 'CORRECTO [181]';
end $$;
reset role;

\echo '[182] El alumno pone y quita hitos de su trabajo'
do $$
declare v_id uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into milestones (work_id, name, due_date)
  values ('bbbbbbbb-0000-0000-0000-000000000001','Deposito', current_date + 120)
  returning id into v_id;
  update milestones set due_date = current_date + 150 where id = v_id;
  delete from milestones where id = v_id;
  reset role;

  if exists (select 1 from milestones where id = v_id) then
    raise exception 'FALLO [182]: el hito del alumno no se ha borrado';
  end if;
  raise notice 'CORRECTO [182]';
end $$;
reset role;

\echo '[183] El alumno convoca una reunion, con participantes y acuerdos'
do $$
declare v_reunion uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);

  insert into meetings (work_id, title, scheduled_at)
  values ('bbbbbbbb-0000-0000-0000-000000000001','Dudas del analisis', now() + interval '7 days')
  returning id into v_reunion;

  -- Las tres politicas miran a `app.can_manage_meetings`. Antes de la 0030
  -- eran tres condiciones escritas por separado, y en la 0011 ya se habian
  -- desincronizado una vez: se creaba la reunion y despues no se le podia
  -- anadir a nadie.
  insert into meeting_participants (meeting_id, user_id)
  values (v_reunion, '22222222-2222-2222-2222-222222222222');

  insert into meeting_agreements (meeting_id, work_id, description)
  values (v_reunion, 'bbbbbbbb-0000-0000-0000-000000000001', 'Revisar el modelo antes del viernes');
  reset role;

  if not exists (select 1 from meeting_participants where meeting_id = v_reunion)
  or not exists (select 1 from meeting_agreements where meeting_id = v_reunion) then
    raise exception 'FALLO [183]: la reunion del alumno ha quedado a medias';
  end if;
  raise notice 'CORRECTO [183]';
end $$;
reset role;

\echo '[184] El alumno escribe el contenido academico, y NO el progreso ni el estado'
do $$
declare v_otro uuid; v_toco boolean := false; v_progreso smallint; v_estado uuid;
begin
  -- El punto de partida, sea cual sea: lo que se afirma es que NO CAMBIA, no
  -- que valga una cosa concreta. Otra prueba anterior podria haberlo tocado.
  select progress_override, status_id into v_progreso, v_estado
    from academic_works where id = 'bbbbbbbb-0000-0000-0000-000000000001';

  -- Lo que si puede.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update academic_works
     set description = 'Reescrito por quien lo esta haciendo',
         objectives  = 'Tres objetivos',
         methodology = '- Cohorte retrospectiva',
         keywords    = array['sexo','decision clinica']
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  reset role;

  if not exists (
    select 1 from academic_works
     where id = 'bbbbbbbb-0000-0000-0000-000000000001'
       and description = 'Reescrito por quien lo esta haciendo'
       and 'sexo' = any(keywords)
  ) then
    raise exception 'FALLO [184]: el alumno no ha podido escribir el contenido academico';
  end if;

  -- EL PROGRESO: la columna dice «a juicio del supervisor», y un alumno que se
  -- pone el 100 % convierte el dato en ruido.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update academic_works set progress_override = 100
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    v_toco := true;
  exception when others then null;
  end;
  reset role;
  if v_toco or (select progress_override from academic_works
                 where id = 'bbbbbbbb-0000-0000-0000-000000000001')
               is distinct from v_progreso then
    raise exception 'FALLO DE SEGURIDAD [184]: el alumno se ha puesto el progreso';
  end if;

  -- EL ESTADO del trabajo: es el expediente, no el contenido.
  select id into v_otro from work_statuses where id <> v_estado limit 1;
  v_toco := false;
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update academic_works set status_id = v_otro
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    v_toco := true;
  exception when others then null;
  end;
  reset role;
  if v_toco or (select status_id from academic_works
                 where id = 'bbbbbbbb-0000-0000-0000-000000000001')
               is distinct from v_estado then
    raise exception 'FALLO DE SEGURIDAD [184]: el alumno ha cambiado el estado del trabajo';
  end if;
  -- CERRAR EL TRABAJO (`is_archived`): decide si el trabajo sigue contando
  -- como vivo en el panel y en los informes. Es el ultimo acto de dirigirlo,
  -- no de hacerlo. Se comprueba aqui y no en una prueba nueva porque es
  -- exactamente lo que la lista blanca promete: una columna que no esta en
  -- ella queda fuera sin que nadie tenga que acordarse de anadirla.
  v_toco := false;
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update academic_works set is_archived = true
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    v_toco := true;
  exception when others then null;
  end;
  reset role;
  if v_toco or (select is_archived from academic_works
                 where id = 'bbbbbbbb-0000-0000-0000-000000000001') then
    raise exception 'FALLO DE SEGURIDAD [184]: el alumno ha dado por terminado su trabajo';
  end if;

  raise notice 'CORRECTO [184]';
end $$;
reset role;

\echo '[185] Ser alumno de un trabajo no da nada en otro'
do $$
declare v_toco boolean := false;
begin
  -- OJO CON LA FORMA DE ESTA PRUEBA. Un UPDATE que la politica no deja pasar NO
  -- da error: `works_update` filtra las filas y el UPDATE dice «0 filas». Asi
  -- que aqui no se puede afirmar «ha saltado una excepcion»; hay que mirar el
  -- dato. La parte del hito, en cambio, si levanta: ahi el `with check` del
  -- INSERT no tiene ninguna fila que filtrar.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update academic_works set description = 'No soy de este trabajo'
   where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  reset role;

  if exists (
    select 1 from academic_works
     where id = 'bbbbbbbb-0000-0000-0000-000000000002'
       and description = 'No soy de este trabajo'
  ) then
    raise exception 'FALLO DE SEGURIDAD [185]: ha escrito en un trabajo que no es suyo';
  end if;

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  v_toco := false;
  begin
    insert into milestones (work_id, name, due_date)
    values ('bbbbbbbb-0000-0000-0000-000000000002','Hito colado', current_date + 10);
    v_toco := true;
  exception when insufficient_privilege then null;
  end;
  reset role;

  if v_toco then
    raise exception 'FALLO DE SEGURIDAD [185]: ha puesto un hito en un trabajo ajeno';
  end if;
  raise notice 'CORRECTO [185]';
end $$;
reset role;
