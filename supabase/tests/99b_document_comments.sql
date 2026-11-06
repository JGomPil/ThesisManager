-- =============================================================================
-- Comentarios sobre la versión de un documento (migración 0015)
--
-- LO QUE SE JUEGA: `document_comments.work_id` es la columna por la que
-- `doccomments_select` decide quién ve el comentario, y venía como clave ajena
-- INDEPENDIENTE de `version_id`. Una fila con los dos campos descolocados es un
-- comentario sobre la entrega de un trabajo mostrado a los miembros de otro. La
-- prueba [112] es la que cierra eso, y comprueba el ESTADO final de la fila, no
-- que la operación diera error: lo que importa es que el `work_id` guardado sea
-- el de la versión, venga lo que venga del cliente.
--
-- Datos de 10_roles_and_privacy.sql:
--   admin        = 1111...  ADMIN de la organización, NO miembro de TFG-01
--   investigador = 2222...  director principal de TFG-01 (valida entregables)
--   estudiante   = 3333...  estudiante de TFG-01
--   ajeno        = 5555...  miembro de la organizacion, de NINGUN trabajo. El 4444
--                           no sirve de ajeno: la prueba [35] lo hizo colaborador
--                           de TFG-01, y una prueba montada sobre un dato que otra
--                           cambia es una prueba que miente (aqui lo dijo en verde
--                           dos veces antes de caerse).
--   TFG-01 = bbbb...0001   ·   TESIS-02 = bbbb...0002
-- =============================================================================

\echo '================ COMENTARIOS SOBRE DOCUMENTOS ================'

-- Un ajeno de verdad: pertenece al grupo pero a ningun trabajo.
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555','ajeno-total@test.invalid')
on conflict (id) do nothing;
insert into organization_members (organization_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','55555555-5555-5555-5555-555555555555','MEMBER')
on conflict do nothing;

-- Una entrega del estudiante en TFG-01 y otra del investigador en TESIS-02,
-- creadas sin RLS: lo que se prueba son los comentarios.
insert into documents (id, work_id, name, created_by) values
  ('f0c00001-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
   'Memoria para comentar','33333333-3333-3333-3333-333333333333'),
  ('f0c00002-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002',
   'Tesis para comentar','22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

insert into document_versions (id, document_id, work_id, version_label, storage_path, author_id) values
  ('f0d00001-0000-0000-0000-000000000001','f0c00001-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001','v1',
   'bbbbbbbb-0000-0000-0000-000000000001/f0c00001/memoria.pdf',
   '33333333-3333-3333-3333-333333333333'),
  ('f0d00002-0000-0000-0000-000000000002','f0c00002-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002','v1',
   'bbbbbbbb-0000-0000-0000-000000000002/f0c00002/tesis.pdf',
   '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

delete from notifications where type = 'DOCUMENT_COMMENT';

\echo '[111] La direccion comenta la entrega del estudiante'
do $$
declare v_autor uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into document_comments (id, version_id, work_id, author_id, content)
  values ('f0a00001-0000-0000-0000-000000000001','f0d00001-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
          'La introduccion necesita las referencias de los ultimos dos anos.');
  reset role;
  select author_id into v_autor from document_comments
   where id = 'f0a00001-0000-0000-0000-000000000001';
  if v_autor <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'FALLO [111]: el comentario no se ha guardado con su autor';
  end if;
  raise notice 'CORRECTO: el comentario queda anclado a la version';
end $$;
reset role;

\echo '[112] El work_id se DERIVA de la version, no se cree al cliente'
do $$
declare v_work uuid; v_rechazado boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);

  -- a) El estudiante comenta SU version pero manda el work_id de otro trabajo.
  insert into document_comments (id, version_id, work_id, author_id, content)
  values ('f0a00002-0000-0000-0000-000000000002','f0d00001-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000002','33333333-3333-3333-3333-333333333333',
          'Comentario con el trabajo equivocado.');

  -- b) Y ahora intenta comentar la version de un trabajo ajeno: al derivarse el
  --    work_id, la politica decide sobre el trabajo DE VERDAD y lo rechaza.
  begin
    insert into document_comments (id, version_id, work_id, author_id, content)
    values ('f0a00003-0000-0000-0000-000000000003','f0d00002-0000-0000-0000-000000000002',
            'bbbbbbbb-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333',
            'Me cuelo en la tesis con el work_id de mi TFG.');
  exception when others then v_rechazado := true;
  end;
  reset role;

  select work_id into v_work from document_comments
   where id = 'f0a00002-0000-0000-0000-000000000002';
  if v_work <> 'bbbbbbbb-0000-0000-0000-000000000001' then
    raise exception 'FALLO [112]: el work_id guardado es %, debia ser el de la version', v_work;
  end if;
  if exists (select 1 from document_comments where id = 'f0a00003-0000-0000-0000-000000000003') then
    raise exception 'FALLO [112]: se ha comentado la version de un trabajo ajeno';
  end if;
  raise notice 'CORRECTO: manda la version, y la politica decide sobre su trabajo';
end $$;
reset role;

\echo '[113] Un ajeno no puede comentar'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','55555555-5555-5555-5555-555555555555', true);
  begin
    insert into document_comments (id, version_id, work_id, author_id, content)
    values ('f0a00004-0000-0000-0000-000000000004','f0d00001-0000-0000-0000-000000000001',
            'bbbbbbbb-0000-0000-0000-000000000001','55555555-5555-5555-5555-555555555555',
            'Opinion no solicitada.');
  exception when others then null;
  end;
  reset role;
  if exists (select 1 from document_comments where id = 'f0a00004-0000-0000-0000-000000000004') then
    raise exception 'FALLO [113]: un ajeno ha comentado una entrega';
  end if;
  raise notice 'CORRECTO: comentar es cosa de quien participa';
end $$;
reset role;

\echo '[114] La administracion del trabajo SI puede comentar aunque no sea miembro'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into document_comments (id, version_id, work_id, author_id, content)
  values ('f0a00005-0000-0000-0000-000000000005','f0d00001-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
          'Revisado por la administracion del grupo.');
  reset role;
  if not exists (select 1 from document_comments where id = 'f0a00005-0000-0000-0000-000000000005') then
    raise exception 'FALLO [114]: la administracion no ha podido comentar';
  end if;
  raise notice 'CORRECTO: arreglo de doccomments_insert (antes exigia ser miembro)';
end $$;
reset role;

\echo '[115] Un ajeno no ve ningun comentario; el estudiante ve los de su version'
do $$
declare v_ajeno int; v_estudiante int;
begin
  set local role authenticated;
  perform set_config('test.uid','55555555-5555-5555-5555-555555555555', true);
  select count(*) into v_ajeno from document_comments
   where version_id = 'f0d00001-0000-0000-0000-000000000001';
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into v_estudiante from document_comments
   where version_id = 'f0d00001-0000-0000-0000-000000000001';
  reset role;
  if v_ajeno <> 0 then
    raise exception 'FALLO [115]: un ajeno ve % comentarios', v_ajeno;
  end if;
  if v_estudiante < 3 then
    raise exception 'FALLO [115]: el estudiante ve % comentarios de su propia entrega', v_estudiante;
  end if;
  raise notice 'CORRECTO: los ve quien tiene acceso al trabajo, y solo esos';
end $$;
reset role;

\echo '[116] Solo el autor borra su comentario'
do $$
declare quedan int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  -- El estudiante intenta borrar el comentario de la direccion.
  delete from document_comments where id = 'f0a00001-0000-0000-0000-000000000001';
  reset role;
  -- Un DELETE que RLS filtra no da error: borra cero filas. Se mira el estado.
  select count(*) into quedan from document_comments
   where id = 'f0a00001-0000-0000-0000-000000000001';
  if quedan <> 1 then
    raise exception 'FALLO [116]: el estudiante ha borrado el comentario de la direccion';
  end if;
  raise notice 'CORRECTO: cada cual retira lo suyo y nada mas';
end $$;
reset role;

\echo '[117] Comentar avisa al autor de la version y NO a quien comenta'
do $$
declare v_estudiante int; v_director int;
begin
  select count(*) into v_estudiante from notifications
   where type = 'DOCUMENT_COMMENT' and user_id = '33333333-3333-3333-3333-333333333333';
  select count(*) into v_director from notifications
   where type = 'DOCUMENT_COMMENT' and user_id = '22222222-2222-2222-2222-222222222222';
  -- El estudiante subio la version: le han avisado los comentarios de la
  -- direccion y de la administracion, y NO el suyo propio ([112] a).
  if v_estudiante <> 2 then
    raise exception 'FALLO [117]: el autor de la version tiene % avisos, se esperaban 2', v_estudiante;
  end if;
  -- El director valida entregables y habia comentado: recibe el del estudiante
  -- y el de la administracion, pero no el suyo.
  if v_director <> 2 then
    raise exception 'FALLO [117]: la direccion tiene % avisos, se esperaban 2', v_director;
  end if;
  raise notice 'CORRECTO: el hilo avisa en los dos sentidos y nadie se avisa a si mismo';
end $$;

\echo '[118] anon no lee ni escribe comentarios'
do $$
declare v int; v_denegado boolean := false;
begin
  set local role anon;
  perform set_config('test.uid','', true);
  begin
    select count(*) into v from document_comments;
  exception when insufficient_privilege then v_denegado := true;
  end;
  reset role;
  if not v_denegado and v <> 0 then
    raise exception 'FALLO [118]: anon ve % comentarios', v;
  end if;
  raise notice 'CORRECTO: anon no llega a los comentarios';
end $$;
reset role;
