-- =============================================================================
-- El plan se cuelga de su hito, y los comentarios se responden (0035 y 0036)
--
-- QUE SE JUEGA AQUI
-- Las dos migraciones escriben por fin dos columnas que existian desde el
-- principio, y las dos tienen el mismo agujero de fondo: UNA CLAVE AJENA NO
-- COMPRUEBA EL TRABAJO. `tasks.milestone_id` admitia el hito de cualquier
-- trabajo y `comments.parent_comment_id` el comentario de cualquier hilo. Nada
-- de eso da un error: lo que se ve despues es un hito con tareas que nadie
-- reconoce, o una respuesta huerfana que no se dibuja en ningun sitio.
--
--   2222... direccion de TFG-01   ·   3333... estudiante de TFG-01
--   bbbb...0001 = TFG-01          ·   bbbb...0002 = TESIS-02
-- =============================================================================

\echo '================ HITOS DEL PLAN Y RESPUESTAS ================'

\echo '[205] Una tarea cuelga de un hito de su trabajo, y de ninguno de otro'
do $$
declare v_hito_propio uuid; v_hito_ajeno uuid; v_colada text := '';
begin
  -- Un hito en cada trabajo. El de TESIS-02 lo pone su propio doctorando.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into milestones (work_id, name, due_date)
  values ('bbbbbbbb-0000-0000-0000-000000000001','Deposito de la memoria', current_date + 60)
  returning id into v_hito_propio;
  insert into milestones (work_id, name, due_date)
  values ('bbbbbbbb-0000-0000-0000-000000000002','Defensa de la tesis', current_date + 300)
  returning id into v_hito_ajeno;

  -- Lo que tiene que funcionar: la tarea del trabajo, con el hito del trabajo.
  insert into tasks (id, work_id, title, assignee_id, milestone_id)
  values ('dddddddd-0035-0000-0000-000000000205','bbbbbbbb-0000-0000-0000-000000000001',
          'Redactar el capitulo de resultados','33333333-3333-3333-3333-333333333333',
          v_hito_propio);

  -- Y lo que no: el hito de otro trabajo, en el alta...
  begin
    insert into tasks (id, work_id, title, milestone_id)
    values ('dddddddd-0035-0000-0000-000000000305','bbbbbbbb-0000-0000-0000-000000000001',
            'Colgada del hito de otra tesis', v_hito_ajeno);
    v_colada := v_colada || 'al crear; ';
  exception when others then null;
  end;

  -- ...y en la edicion, que es por donde se cuela de verdad: la tarea ya
  -- existe y solo se cambia una columna.
  begin
    update tasks set milestone_id = v_hito_ajeno
     where id = 'dddddddd-0035-0000-0000-000000000205';
    v_colada := v_colada || 'al editar; ';
  exception when others then null;
  end;
  reset role;

  if not exists (
    select 1 from tasks
     where id = 'dddddddd-0035-0000-0000-000000000205' and milestone_id = v_hito_propio
  ) then
    raise exception 'FALLO [205]: la tarea no ha podido colgar de un hito de su trabajo';
  end if;
  if v_colada <> '' or exists (
    select 1 from tasks where id = 'dddddddd-0035-0000-0000-000000000305'
  ) then
    raise exception 'FALLO [205]: una tarea cuelga del hito de otro trabajo (%)', v_colada;
  end if;
  raise notice 'CORRECTO [205]';
end $$;
reset role;

\echo '[206] Borrar el hito no borra sus tareas: las suelta'
do $$
declare v_hito uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into milestones (work_id, name, due_date)
  values ('bbbbbbbb-0000-0000-0000-000000000001','Envio del articulo', current_date + 90)
  returning id into v_hito;
  insert into tasks (id, work_id, title, milestone_id)
  values ('dddddddd-0035-0000-0000-000000000206','bbbbbbbb-0000-0000-0000-000000000001',
          'Preparar las figuras', v_hito);
  delete from milestones where id = v_hito;
  reset role;

  -- `on delete set null` y no `cascade`, y es lo que hay que comprobar: quitar
  -- una FECHA del plan no puede llevarse por delante el TRABAJO que habia
  -- apuntado para ella.
  if not exists (
    select 1 from tasks
     where id = 'dddddddd-0035-0000-0000-000000000206' and milestone_id is null
  ) then
    raise exception 'FALLO [206]: al borrar el hito se ha perdido su tarea';
  end if;
  raise notice 'CORRECTO [206]';
end $$;
reset role;

\echo '[207] Una respuesta vive en el hilo de su padre, y el hilo tiene dos niveles'
do $$
declare v_raiz uuid; v_resp uuid; v_otro uuid; v_colada text := '';
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);

  insert into comments (work_id, entity_type, entity_id, author_id, content)
  values ('bbbbbbbb-0000-0000-0000-000000000001','WORK','bbbbbbbb-0000-0000-0000-000000000001',
          '22222222-2222-2222-2222-222222222222','Revisa el apartado de metodos, por favor')
  returning id into v_raiz;

  -- Un comentario en OTRO hilo del mismo trabajo, para la segunda trampa.
  insert into comments (work_id, entity_type, entity_id, author_id, content)
  values ('bbbbbbbb-0000-0000-0000-000000000001','TASK','dddddddd-0035-0000-0000-000000000205',
          '22222222-2222-2222-2222-222222222222','Esto va con el deposito')
  returning id into v_otro;
  reset role;

  -- La respuesta del alumno, que es lo que tiene que funcionar.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into comments (work_id, entity_type, entity_id, author_id, content, parent_comment_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001','WORK','bbbbbbbb-0000-0000-0000-000000000001',
          '33333333-3333-3333-3333-333333333333','Hecho, lo he reescrito entero', v_raiz)
  returning id into v_resp;

  -- Y las tres que no: colgar de un comentario de OTRA entidad...
  begin
    insert into comments (work_id, entity_type, entity_id, author_id, content, parent_comment_id)
    values ('bbbbbbbb-0000-0000-0000-000000000001','WORK','bbbbbbbb-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333','Respuesta en el hilo equivocado', v_otro);
    v_colada := v_colada || 'de otra entidad; ';
  exception when others then null;
  end;

  -- ...colgar de una RESPUESTA, que es el tercer nivel...
  begin
    insert into comments (work_id, entity_type, entity_id, author_id, content, parent_comment_id)
    values ('bbbbbbbb-0000-0000-0000-000000000001','WORK','bbbbbbbb-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333','Y ademas...', v_resp);
    v_colada := v_colada || 'tercer nivel; ';
  exception when others then null;
  end;

  -- ...y mudar una respuesta de hilo EDITANDOLA, que es por donde nadie mira.
  begin
    update comments set parent_comment_id = v_otro where id = v_resp;
    v_colada := v_colada || 'mudada al editar; ';
  exception when others then null;
  end;
  reset role;

  if not exists (
    select 1 from comments where id = v_resp and parent_comment_id = v_raiz
  ) then
    raise exception 'FALLO [207]: la respuesta no ha quedado colgada de su comentario';
  end if;
  if v_colada <> '' then
    raise exception 'FALLO [207]: ha entrado una respuesta que no debia (%)', v_colada;
  end if;
  raise notice 'CORRECTO [207]';
end $$;
reset role;

\echo '[208] Al autor del comentario le llega que le han RESPONDIDO, y a los demas que se ha comentado'
do $$
declare v_raiz uuid; v_titulo_padre text; v_titulo_otro text;
begin
  -- Tres personas en el hilo: 2222 escribe, 1111 escribe tambien (es
  -- administrador, pero lo que le mete en el hilo es haber escrito) y 3333
  -- responde a 2222.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into comments (work_id, entity_type, entity_id, author_id, content)
  values ('bbbbbbbb-0000-0000-0000-000000000001','WORK','bbbbbbbb-0000-0000-0000-000000000001',
          '22222222-2222-2222-2222-222222222222','Hilo del aviso de prueba 208')
  returning id into v_raiz;
  reset role;

  -- 1111 tiene que ser miembro ACTIVO del trabajo para recibir avisos: la
  -- exclusion de la 0032 es por pertenencia, no por papel administrativo.
  insert into work_members (work_id, user_id, work_role_id, status)
  select 'bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
         (select id from work_roles where code = 'CO_SUPERVISOR'), 'ACTIVE'
  on conflict do nothing;

  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into comments (work_id, entity_type, entity_id, author_id, content)
  values ('bbbbbbbb-0000-0000-0000-000000000001','WORK','bbbbbbbb-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111','Yo tambien estaba en este hilo 208');
  reset role;

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into comments (work_id, entity_type, entity_id, author_id, content, parent_comment_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001','WORK','bbbbbbbb-0000-0000-0000-000000000001',
          '33333333-3333-3333-3333-333333333333','Respondido 208', v_raiz);
  reset role;

  select title into v_titulo_padre from notifications
   where user_id = '22222222-2222-2222-2222-222222222222'
     and type = 'COMMENT_REPLY' and body like '%Respondido 208%';
  select title into v_titulo_otro from notifications
   where user_id = '11111111-1111-1111-1111-111111111111'
     and type = 'COMMENT_REPLY' and body like '%Respondido 208%';

  if v_titulo_padre is null or v_titulo_padre not like '%ha respondido a tu comentario%' then
    raise exception 'FALLO [208]: a quien se responde no le llega que le han respondido (%)',
      coalesce(v_titulo_padre, 'NADA');
  end if;
  if v_titulo_otro is null or v_titulo_otro like '%ha respondido a tu comentario%' then
    raise exception 'FALLO [208]: al resto del hilo le llega como si le hubieran respondido a el (%)',
      coalesce(v_titulo_otro, 'NADA');
  end if;
  raise notice 'CORRECTO [208]';
end $$;
reset role;
