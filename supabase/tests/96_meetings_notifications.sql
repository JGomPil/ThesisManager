-- =============================================================================
-- Fase 2: reuniones, comentarios y notificaciones internas (migración 0011)
--
-- El criterio de aceptación de la fase es doble: «un estudiante no ve ninguna
-- nota privada de su propio trabajo» (ya cubierto por las pruebas [1]-[7]) y
-- «las notificaciones llegan a quien debe Y SOLO a quien debe». Lo segundo es
-- lo que se comprueba aquí, incluida la parte que se olvida: que NO llegan a
-- quien no debe, y que no existe ninguna notificación sobre algo privado.
--
-- Reutiliza los datos de 10_roles_and_privacy.sql:
--   admin        = 1111...  ADMIN de la organización, no participa en TFG-01
--   investigador = 2222...  director principal de TFG-01, valida entregables
--   estudiante   = 3333...  estudiante de TFG-01
--   ajeno        = 4444...  colaborador de TFG-01 (lo añadió la prueba [35])
-- =============================================================================

\echo '================ FASE 2: REUNIONES Y NOTIFICACIONES ================'

-- Se parte de un buzón vacío para poder contar.
delete from notifications;

\echo '[64] Asignar una tarea notifica al responsable y NO a quien la asigna'
do $$
declare para_alumno int; para_director int;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into tasks (work_id, title, assignee_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Tarea notificada',
          '33333333-3333-3333-3333-333333333333');
  reset role;

  select count(*) into para_alumno from notifications
  where user_id = '33333333-3333-3333-3333-333333333333' and type = 'TASK_ASSIGNED';
  select count(*) into para_director from notifications
  where user_id = '22222222-2222-2222-2222-222222222222' and type = 'TASK_ASSIGNED';

  if para_alumno <> 1 then
    raise exception 'FALLO [64]: el responsable ha recibido % avisos', para_alumno;
  end if;
  if para_director <> 0 then
    raise exception 'FALLO [64]: quien asigna se ha notificado a si mismo';
  end if;
  raise notice 'CORRECTO: avisa al responsable y no a quien asigna';
end $$;
reset role;

\echo '[65] Una mención avisa solo a quien YA tiene acceso al trabajo'
do $$
declare al_alumno int; al_admin int;
begin
  delete from notifications;
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  -- Se menciona al estudiante (participa) y al administrador (NO participa en
  -- este trabajo). Mencionar a alguien de fuera no debe avisarle: le revelaria
  -- que el trabajo existe.
  insert into comments (work_id, entity_type, entity_id, author_id, content, mentions)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'WORK',
          'bbbbbbbb-0000-0000-0000-000000000001',
          '22222222-2222-2222-2222-222222222222',
          'Revisa esto, por favor',
          array['33333333-3333-3333-3333-333333333333'::uuid,
                '11111111-1111-1111-1111-111111111111'::uuid]);
  reset role;

  select count(*) into al_alumno from notifications
  where user_id = '33333333-3333-3333-3333-333333333333' and type = 'MENTION';
  select count(*) into al_admin from notifications
  where user_id = '11111111-1111-1111-1111-111111111111' and type = 'MENTION';

  if al_alumno <> 1 then
    raise exception 'FALLO [65]: el participante mencionado no ha recibido aviso';
  end if;
  if al_admin <> 0 then
    raise exception 'FALLO [65]: se ha avisado a alguien que no participa en el trabajo';
  end if;
  raise notice 'CORRECTO: la mencion no alcanza a quien no participa';
end $$;
reset role;

\echo '[66] Una entrega avisa a quien valida entregables, no al resto'
do $$
declare doc uuid; al_director int; al_alumno int;
begin
  delete from notifications;
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into documents (work_id, name, created_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Entrega notificada',
          '33333333-3333-3333-3333-333333333333')
  returning id into doc;
  insert into document_versions (document_id, work_id, version_label, storage_path, author_id)
  values (doc, 'bbbbbbbb-0000-0000-0000-000000000001', 'v1',
          'bbbbbbbb-0000-0000-0000-000000000001/' || doc || '/e.pdf',
          '33333333-3333-3333-3333-333333333333');
  reset role;

  select count(*) into al_director from notifications
  where user_id = '22222222-2222-2222-2222-222222222222' and type = 'DOCUMENT_SUBMITTED';
  select count(*) into al_alumno from notifications
  where user_id = '33333333-3333-3333-3333-333333333333' and type = 'DOCUMENT_SUBMITTED';

  if al_director <> 1 then
    raise exception 'FALLO [66]: quien valida ha recibido % avisos', al_director;
  end if;
  if al_alumno <> 0 then
    raise exception 'FALLO [66]: se ha avisado a quien ha hecho la entrega';
  end if;
  raise notice 'CORRECTO: la entrega avisa a quien tiene que revisarla';
end $$;
reset role;

\echo '[67] Convocar una reunion avisa a todos los participantes menos a quien convoca'
do $$
declare reunion uuid; avisados int; a_si_mismo int;
begin
  delete from notifications;
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into meetings (work_id, title, scheduled_at, created_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Seguimiento mensual',
          now() + interval '7 days', '22222222-2222-2222-2222-222222222222')
  returning id into reunion;
  perform set_config('test.meeting', reunion::text, false);
  reset role;

  select count(*) into avisados from notifications where type = 'MEETING_SCHEDULED';
  select count(*) into a_si_mismo from notifications
  where type = 'MEETING_SCHEDULED' and user_id = '22222222-2222-2222-2222-222222222222';

  -- Participantes de TFG-01: investigador (convoca), estudiante y el
  -- colaborador que añadio la prueba [35]. Deben recibirlo los dos ultimos.
  if avisados <> 2 then
    raise exception 'FALLO [67]: se han avisado % participantes, se esperaban 2', avisados;
  end if;
  if a_si_mismo <> 0 then
    raise exception 'FALLO [67]: quien convoca se ha avisado a si mismo';
  end if;
  raise notice 'CORRECTO: avisa a los participantes y no a quien convoca';
end $$;
reset role;

\echo '[68] NADIE puede escribir en el buzon de otro (no hay politica de INSERT)'
do $$
declare colados int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    insert into notifications (user_id, type, title)
    values ('22222222-2222-2222-2222-222222222222', 'FALSA', 'Aviso suplantado');
    raise exception 'FALLO [68]: se ha podido escribir en el buzon de otro';
  exception
    when insufficient_privilege then
      raise notice 'CORRECTO: las notificaciones solo las crean los disparadores';
  end;
  reset role;
  select count(*) into colados from notifications where type = 'FALSA';
  if colados <> 0 then
    raise exception 'FALLO [68]: ha quedado una notificacion suplantada';
  end if;
end $$;
reset role;

\echo '[69] Cada cual ve solo su buzon'
do $$
declare vistas int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into vistas from notifications
  where user_id <> '33333333-3333-3333-3333-333333333333';
  if vistas <> 0 then
    raise exception 'FALLO [69]: ve % notificaciones de otras personas', vistas;
  end if;
  raise notice 'CORRECTO: el buzon es privado';
end $$;
reset role;

\echo '[70] Una nota privada NO genera ninguna notificacion'
do $$
declare antes int; despues int;
begin
  select count(*) into antes from notifications;
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into meeting_private_notes (meeting_id, work_id, author_id, content)
  values (current_setting('test.meeting')::uuid,
          'bbbbbbbb-0000-0000-0000-000000000001',
          '22222222-2222-2222-2222-222222222222',
          'Impresion personal sobre el avance del alumno');
  reset role;
  select count(*) into despues from notifications;
  -- Avisar de que existe una nota privada seria filtrar su existencia a quien
  -- no puede leerla. Por eso no hay disparador sobre esta tabla.
  if despues <> antes then
    raise exception 'FALLO [70]: una nota privada ha generado % notificacion(es)', despues - antes;
  end if;
  raise notice 'CORRECTO: lo privado no se anuncia';
end $$;
reset role;

\echo '[71] El estudiante NO ve la nota privada de SU reunion'
do $$
declare vistas int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into vistas from meeting_private_notes
  where work_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if vistas <> 0 then
    raise exception 'FALLO [71]: el estudiante ve % notas privadas', vistas;
  end if;
  raise notice 'CORRECTO: el estudiante no ve ninguna nota privada';
end $$;
reset role;

\echo '[72] ...pero SI ve el acta compartida de esa reunion'
do $$
declare vistas int;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update meetings set summary = 'Acuerdos: continuar con el capitulo 2.'
  where id = current_setting('test.meeting')::uuid;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into vistas from meetings
  where id = current_setting('test.meeting')::uuid and summary is not null;
  if vistas <> 1 then
    raise exception 'FALLO [72]: el estudiante no ve el acta compartida';
  end if;
  raise notice 'CORRECTO: el acta se comparte, la nota privada no';
end $$;
reset role;

\echo '[73] La administracion puede anadir participantes y acuerdos (arreglo de la 0011)'
do $$
declare reunion uuid;
begin
  reunion := current_setting('test.meeting')::uuid;
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into meeting_participants (meeting_id, user_id, attended)
  values (reunion, '33333333-3333-3333-3333-333333333333', true);
  insert into meeting_agreements (meeting_id, work_id, description)
  values (reunion, 'bbbbbbbb-0000-0000-0000-000000000001', 'Entregar el capitulo 2');
  raise notice 'CORRECTO: la administracion gestiona la reunion que ha creado';
end $$;
reset role;

-- CAMBIO DE DOCTRINA EN LA 0030. Esta prueba decia lo contrario: «el estudiante
-- NO puede convocar reuniones ni escribir acuerdos». Pedir una reunion es la
-- peticion mas corriente que hace quien esta haciendo el trabajo, y tener que
-- pedirsela a su director por otro canal para que la apunte aqui convertia la
-- agenda en papel mojado.
--
-- Lo que se anade es «y el estudiante», no «y cualquier miembro»: el permiso es
-- de las dos partes del trabajo. Y la segunda mitad fija donde acaba, que es lo
-- unico que `app.is_work_student` puede equivocarse: el trabajo. Un alumno es
-- alumno de SU trabajo, no de los demas.
--
-- (El caso negativo no puede ser un colaborador, que era lo primero que parecia:
-- COLLABORATOR lleva `is_supervisory` en el catalogo, asi que un colaborador ya
-- convocaba reuniones desde la 0011. Es equipo de supervision, no un tercero.)
\echo '[74] El estudiante SI convoca reuniones, y solo en su trabajo'
do $$
declare v_reunion uuid; v_colado boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into meetings (work_id, title, scheduled_at)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Reunion que pide el alumno', now())
  returning id into v_reunion;
  insert into meeting_agreements (meeting_id, work_id, description)
  values (v_reunion, 'bbbbbbbb-0000-0000-0000-000000000001', 'Traer el analisis hecho');
  reset role;

  if not exists (select 1 from meeting_agreements where meeting_id = v_reunion) then
    raise exception 'FALLO [74]: el estudiante no ha podido convocar y acordar';
  end if;
  raise notice 'CORRECTO: convocar es de las dos partes del trabajo';

  -- El mismo alumno, en TESIS-02, donde no es nada. Si `app.is_work_student` se
  -- hubiera escrito sin mirar el trabajo —«tiene alguna funcion de estudiante»—
  -- esto pasaria, y no daria ningun error en ninguna pantalla.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    insert into meetings (work_id, title, scheduled_at)
    values ('bbbbbbbb-0000-0000-0000-000000000002', 'Reunion en trabajo ajeno', now());
    v_colado := true;
  exception when insufficient_privilege then null;
  end;
  reset role;

  if v_colado then
    raise exception 'FALLO DE SEGURIDAD [74]: ha convocado una reunion en un trabajo ajeno';
  end if;
  raise notice 'CORRECTO: y solo en el suyo';
end $$;
reset role;

\echo '[75] El autor SI puede borrar su propio comentario (arreglo de comments_select)'
do $$
declare c uuid; borrado timestamptz;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into comments (work_id, entity_type, entity_id, author_id, content)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'WORK',
          'bbbbbbbb-0000-0000-0000-000000000001',
          '33333333-3333-3333-3333-333333333333', 'Comentario que borrare')
  returning id into c;
  update comments set deleted_at = now() where id = c;
  reset role;
  select deleted_at into borrado from comments where id = c;
  if borrado is null then
    raise exception 'FALLO [75]: el autor no ha podido borrar su comentario';
  end if;
  raise notice 'CORRECTO: el autor borra lo suyo';
end $$;
reset role;
