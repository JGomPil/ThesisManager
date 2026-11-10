-- =============================================================================
-- Mover una tarea de un trabajo a otro (migracion 0031)
--
-- QUE SE JUEGA AQUI
-- Dos cosas distintas, y la segunda es la que no se ve:
--
--  1. QUIEN PUEDE. Hace falta planificar LOS DOS trabajos. El caso peligroso no
--     es el desconocido -ese no ve ninguno de los dos-, sino quien dirige el
--     destino y solo es RESPONSABLE en el origen: `tasks_update` le admite la
--     fila por el `using`, asi que sin la comprobacion de la funcion podria
--     sacar una tarea de un plan que no dirige. Lo fija la [187].
--
--  2. QUE SE LLEVA Y QUE SE SUELTA. Cambiar `work_id` a secas deja la columna
--     del tablero, el hito, las dependencias, los documentos, las actas y el
--     hilo de comentarios apuntando al trabajo viejo. Nada de eso da error:
--     simplemente queda mal. Lo fija la [186].
--
--   2222... dirige TFG-01 y es ESTUDIANTE de TESIS-02
--   3333... estudiante de TFG-01
--   1111... administracion de la organizacion (planifica los dos)
--   bbbb...0001 = TFG-01    ·    bbbb...0002 = TESIS-02
-- =============================================================================

\echo '================ MOVER UNA TAREA DE TRABAJO ================'

\echo '[186] La tarea se muda con su lista y su historia, y suelta lo que era del trabajo viejo'
do $$
declare
  v_tarea uuid := 'dddddddd-0000-0000-0000-000000000186';
  v_punto uuid := 'dddddddd-0000-0000-0000-000000000187';
  v_otra  uuid := 'dddddddd-0000-0000-0000-000000000188';
  v_col   uuid;
  v_hito  uuid;
  v_doc   uuid;
  v_acta  uuid;
  v_reunion uuid;
begin
  -- Se arma una tarea con TODO lo que puede colgar de ella, porque lo que se
  -- comprueba es justamente que no quede nada atras.
  insert into board_columns (id, work_id, name, display_order)
  values ('ffffffff-0000-0000-0000-000000000186','bbbbbbbb-0000-0000-0000-000000000001','Para mudar',9)
  returning id into v_col;

  insert into milestones (work_id, name, due_date)
  values ('bbbbbbbb-0000-0000-0000-000000000001','Hito del origen', current_date + 30)
  returning id into v_hito;

  insert into tasks (id, work_id, title, assignee_id, board_column_id, milestone_id)
  values (v_tarea,'bbbbbbbb-0000-0000-0000-000000000001','Tarea que se muda',
          '33333333-3333-3333-3333-333333333333', v_col, v_hito);

  insert into tasks (id, work_id, parent_task_id, title)
  values (v_punto,'bbbbbbbb-0000-0000-0000-000000000001', v_tarea,'Punto que viaja con ella');

  insert into tasks (id, work_id, title)
  values (v_otra,'bbbbbbbb-0000-0000-0000-000000000001','Tarea de la que depende');
  insert into task_dependencies (task_id, depends_on_task_id) values (v_tarea, v_otra);

  insert into comments (work_id, entity_type, entity_id, author_id, content)
  values ('bbbbbbbb-0000-0000-0000-000000000001','TASK', v_tarea,
          '22222222-2222-2222-2222-222222222222','Lo hablamos en la reunion');

  insert into documents (id, work_id, name, task_id)
  values ('cccccccc-0000-0000-0000-000000000186','bbbbbbbb-0000-0000-0000-000000000001',
          'Entrega de la tarea', v_tarea)
  returning id into v_doc;

  insert into meetings (id, work_id, title, scheduled_at)
  values ('eeeeeeee-0000-0000-0000-000000000186','bbbbbbbb-0000-0000-0000-000000000001',
          'Reunion que derivo la tarea', now())
  returning id into v_reunion;
  insert into meeting_agreements (meeting_id, work_id, description, task_id)
  values (v_reunion,'bbbbbbbb-0000-0000-0000-000000000001','De aqui salio la tarea', v_tarea)
  returning id into v_acta;

  -- 1111... es administracion de la organizacion, asi que planifica los dos.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  perform app.mover_tarea_de_trabajo(v_tarea, 'bbbbbbbb-0000-0000-0000-000000000002');
  reset role;

  -- La tarea, en el destino y sin lo que era del origen.
  if not exists (
    select 1 from tasks
     where id = v_tarea
       and work_id = 'bbbbbbbb-0000-0000-0000-000000000002'
       and board_column_id is null
       and milestone_id is null
  ) then
    raise exception 'FALLO [186]: la tarea no se ha mudado limpia';
  end if;

  -- EL RESPONSABLE SE SUELTA: 3333... es estudiante de TFG-01 y no participa en
  -- TESIS-02. Una tarjeta a nombre de quien no esta en el trabajo no la puede
  -- atender nadie, y a esa persona le saldria en «mis tareas» un trabajo que no
  -- puede ni abrir.
  if (select assignee_id from tasks where id = v_tarea) is not null then
    raise exception 'FALLO [186]: la tarea sigue a nombre de alguien que no participa en el destino';
  end if;

  -- El punto de la lista VIAJA. Si se quedara, colgaria de un padre que ya no
  -- esta en su trabajo y el recuento de la lista se partiria en dos.
  if not exists (
    select 1 from tasks where id = v_punto
      and work_id = 'bbbbbbbb-0000-0000-0000-000000000002'
      and parent_task_id = v_tarea
  ) then
    raise exception 'FALLO [186]: el punto de la lista se ha quedado en el trabajo viejo';
  end if;

  -- El hilo de comentarios VIAJA: `comments.work_id` esta desnormalizado para
  -- RLS, asi que sin moverlo la conversacion queda invisible en los dos sitios.
  if not exists (
    select 1 from comments where entity_type = 'TASK' and entity_id = v_tarea
      and work_id = 'bbbbbbbb-0000-0000-0000-000000000002'
  ) then
    raise exception 'FALLO [186]: la historia de la tarea se ha quedado atras';
  end if;

  -- La dependencia cruzaria de trabajo: se quita. «Esta espera a aquella» solo
  -- significa algo dentro de un plan, y ademas `taskdeps_same_work` (0012) la
  -- rechazaria a la primera que alguien la tocara.
  if exists (select 1 from task_dependencies where task_id = v_tarea) then
    raise exception 'FALLO [186]: ha quedado una dependencia entre dos trabajos';
  end if;

  -- El documento SE QUEDA en su trabajo y pierde el vinculo: es la entrega de
  -- TFG-01, no de TESIS-02. Y si conservara el vinculo, romperia el invariante
  -- de la 0010 sin que su disparador llegara a enterarse.
  if not exists (
    select 1 from documents where id = v_doc
      and work_id = 'bbbbbbbb-0000-0000-0000-000000000001'
      and task_id is null
  ) then
    raise exception 'FALLO [186]: el documento se ha ido con la tarea o ha quedado apuntandola';
  end if;

  -- El acuerdo del acta, igual.
  if (select task_id from meeting_agreements where id = v_acta) is not null then
    raise exception 'FALLO [186]: un acta de TFG-01 sigue señalando una tarea de TESIS-02';
  end if;

  raise notice 'CORRECTO [186]';
end $$;
reset role;

\echo '[187] Dirigir el destino no basta: hay que planificar tambien el origen'
do $$
declare v_movio boolean := false;
begin
  -- EL CASO QUE IMPORTA, y no es el del desconocido: ese no ve ninguno de los
  -- dos trabajos y no llega ni a intentarlo. Es QUIEN DIRIGE UNO Y SOLO ES
  -- RESPONSABLE EN EL OTRO, que en un grupo de investigacion es de lo mas
  -- corriente: una doctoranda que ademas tutela un TFG.
  --
  -- `tasks_update` le admite la fila del origen por el `using` -es su tarea- y
  -- el `with check` se conforma con que planifique el destino. O sea que sin la
  -- comprobacion de LOS DOS trabajos que hace la funcion, esto pasaria.
  --
  -- 3333... es estudiante de TFG-01. Se le hace director de ACADEMIA-03 solo
  -- para esta prueba, y se deshace al final para no cambiarle el mundo a nadie.
  insert into work_members (work_id, user_id, work_role_id, is_primary)
  select 'bbbbbbbb-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333',
         (select id from work_roles where code='PRIMARY_SUPERVISOR'), true;

  insert into tasks (id, work_id, title, assignee_id)
  values ('dddddddd-0000-0000-0000-000000000189','bbbbbbbb-0000-0000-0000-000000000001',
          'Tarea suya en el trabajo que NO dirige','33333333-3333-3333-3333-333333333333');

  -- Sacarla del plan que no dirige hacia el que si dirige.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    perform app.mover_tarea_de_trabajo('dddddddd-0000-0000-0000-000000000189',
                                       'bbbbbbbb-0000-0000-0000-000000000003');
    v_movio := true;
  exception when insufficient_privilege then null;
  end;
  reset role;

  if v_movio or (select work_id from tasks where id = 'dddddddd-0000-0000-0000-000000000189')
       <> 'bbbbbbbb-0000-0000-0000-000000000001' then
    raise exception 'FALLO DE SEGURIDAD [187]: ha sacado su tarea de un plan que no dirige';
  end if;

  -- Y EN EL SENTIDO CONTRARIO, que es la otra mitad de la misma regla: meter
  -- una tarea del plan que si dirige en uno que no.
  insert into tasks (id, work_id, title)
  values ('dddddddd-0000-0000-0000-000000000190','bbbbbbbb-0000-0000-0000-000000000003',
          'Tarea del trabajo que si dirige');

  v_movio := false;
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    perform app.mover_tarea_de_trabajo('dddddddd-0000-0000-0000-000000000190',
                                       'bbbbbbbb-0000-0000-0000-000000000001');
    v_movio := true;
  exception when insufficient_privilege then null;
  end;
  reset role;

  if v_movio or (select work_id from tasks where id = 'dddddddd-0000-0000-0000-000000000190')
       <> 'bbbbbbbb-0000-0000-0000-000000000003' then
    raise exception 'FALLO DE SEGURIDAD [187]: ha metido una tarea en un plan que no dirige';
  end if;

  delete from work_members
   where work_id = 'bbbbbbbb-0000-0000-0000-000000000003'
     and user_id = '33333333-3333-3333-3333-333333333333';
  raise notice 'CORRECTO [187]';
end $$;
reset role;

\echo '[188] Un punto de una lista no se muda suelto'
do $$
declare v_movio boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  begin
    perform app.mover_tarea_de_trabajo('dddddddd-0000-0000-0000-000000000187',
                                       'bbbbbbbb-0000-0000-0000-000000000001');
    v_movio := true;
  exception when invalid_parameter_value then null;
  end;
  reset role;

  if v_movio or (select work_id from tasks where id = 'dddddddd-0000-0000-0000-000000000187')
       <> 'bbbbbbbb-0000-0000-0000-000000000002' then
    raise exception 'FALLO [188]: un punto se ha ido por su cuenta y ha dejado a su tarea en otro trabajo';
  end if;
  raise notice 'CORRECTO [188]';
end $$;
reset role;

\echo '[189] Mover al mismo trabajo no es un error, y no toca nada'
do $$
declare v_col uuid;
begin
  -- Parece una tonteria y no lo es: la pantalla ofrece una lista de trabajos y
  -- el de origen puede estar en ella. Si esto levantara, el mensaje seria un
  -- error de permisos que no tiene nada que ver; y si NO fuera inocuo, soltaria
  -- la columna y el responsable de una tarea que nadie ha movido.
  insert into board_columns (id, work_id, name, display_order)
  values ('ffffffff-0000-0000-0000-000000000189','bbbbbbbb-0000-0000-0000-000000000002','Sitio',9)
  returning id into v_col;
  update tasks set board_column_id = v_col where id = 'dddddddd-0000-0000-0000-000000000186';

  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  perform app.mover_tarea_de_trabajo('dddddddd-0000-0000-0000-000000000186',
                                     'bbbbbbbb-0000-0000-0000-000000000002');
  reset role;

  if (select board_column_id from tasks where id = 'dddddddd-0000-0000-0000-000000000186')
       is distinct from v_col then
    raise exception 'FALLO [189]: mover una tarea a su propio trabajo la ha descolocado';
  end if;
  raise notice 'CORRECTO [189]';
end $$;
reset role;
