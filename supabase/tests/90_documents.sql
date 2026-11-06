-- =============================================================================
-- Documentos: quién entrega, quién modifica y quién borra (migración 0010)
--
-- Reutiliza los datos de 10_roles_and_privacy.sql:
--   investigador = 2222...  director principal de TFG-01 (valida entregables)
--   estudiante   = 3333...  estudiante de TFG-01
-- =============================================================================

\echo '================ DOCUMENTOS ================'

\echo '[54] El estudiante ENTREGA un documento (esperado: correcto)'
do $$
declare doc uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into documents (work_id, name, created_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Memoria v1 del alumno',
          '33333333-3333-3333-3333-333333333333')
  returning id into doc;
  insert into document_versions (document_id, work_id, version_label, storage_path, author_id)
  values (doc, 'bbbbbbbb-0000-0000-0000-000000000001', 'v1',
          'bbbbbbbb-0000-0000-0000-000000000001/' || doc || '/memoria.pdf',
          '33333333-3333-3333-3333-333333333333');
  perform set_config('test.doc_alumno', doc::text, false);
  raise notice 'CORRECTO: el estudiante puede entregar';
end $$;
reset role;

\echo '[55] El director sube el suyo y el estudiante NO puede borrarlo'
do $$
declare doc_dir uuid; quedan int;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into documents (work_id, name, created_by)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Guion de la memoria (direccion)',
          '22222222-2222-2222-2222-222222222222')
  returning id into doc_dir;

  -- Ahora el estudiante intenta borrarlo.
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  delete from documents where id = doc_dir;
  -- Un DELETE filtrado por RLS no lanza error: borra cero filas.
  reset role;
  select count(*) into quedan from documents where id = doc_dir;
  if quedan <> 1 then
    raise exception 'FALLO [55]: el estudiante ha borrado el documento de la direccion';
  end if;
  raise notice 'CORRECTO: el documento de la direccion sigue ahi';
end $$;
reset role;

\echo '[56] ...ni archivarlo (UPDATE de deleted_at)'
do $$
declare doc_dir uuid; archivado timestamptz;
begin
  select id into doc_dir from documents
  where name = 'Guion de la memoria (direccion)';

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update documents set deleted_at = now() where id = doc_dir;
  exception when others then
    null;  -- da igual si falla con error o sin afectar filas: lo que importa es el estado
  end;
  reset role;
  select deleted_at into archivado from documents where id = doc_dir;
  if archivado is not null then
    raise exception 'FALLO [56]: el estudiante ha archivado el documento de la direccion';
  end if;
  raise notice 'CORRECTO: tampoco puede archivarlo';
end $$;
reset role;

\echo '[57] El estudiante SÍ puede retirar el documento que subió él'
do $$
declare doc uuid; archivado timestamptz;
begin
  doc := current_setting('test.doc_alumno')::uuid;
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update documents set deleted_at = now() where id = doc;
  reset role;
  select deleted_at into archivado from documents where id = doc;
  if archivado is null then
    raise exception 'FALLO [57]: el autor no ha podido retirar su propio documento';
  end if;
  raise notice 'CORRECTO: el autor puede retirar lo que subio';
end $$;
reset role;

\echo '[58] El estudiante NO puede aprobar su propia entrega'
do $$
declare v uuid; estado text;
begin
  select dv.id into v from document_versions dv
  where dv.document_id = current_setting('test.doc_alumno')::uuid;

  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update document_versions set review_status = 'APROBADO' where id = v;
  exception when others then
    null;
  end;
  reset role;
  select review_status into estado from document_versions where id = v;
  if estado = 'APROBADO' then
    raise exception 'FALLO [58]: el estudiante se ha aprobado su propia entrega';
  end if;
  raise notice 'CORRECTO: aprobar es acto de supervision (estado: %)', estado;
end $$;
reset role;

\echo '[59] El director SÍ puede aprobarla'
do $$
declare v uuid; estado text;
begin
  select dv.id into v from document_versions dv
  where dv.document_id = current_setting('test.doc_alumno')::uuid;

  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update document_versions
  set review_status = 'APROBADO', reviewed_at = now(),
      reviewer_id = '22222222-2222-2222-2222-222222222222'
  where id = v;
  reset role;
  select review_status into estado from document_versions where id = v;
  if estado <> 'APROBADO' then
    raise exception 'FALLO [59]: el director no ha podido aprobar (estado: %)', estado;
  end if;
  raise notice 'CORRECTO: la direccion aprueba la entrega';
end $$;
reset role;

\echo '[60] Un documento no puede vincularse a una tarea de OTRO trabajo'
do $$
declare tarea_ajena uuid;
begin
  -- Una tarea de TESIS-02, que es otro trabajo.
  insert into tasks (work_id, title)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'Tarea de la tesis')
  returning id into tarea_ajena;

  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into documents (work_id, task_id, name, created_by)
    values ('bbbbbbbb-0000-0000-0000-000000000001', tarea_ajena, 'Documento mal vinculado',
            '22222222-2222-2222-2222-222222222222');
    raise exception 'FALLO [60]: se ha vinculado un documento a una tarea de otro trabajo';
  exception
    when check_violation then
      raise notice 'CORRECTO: el disparador exige que la tarea sea del mismo trabajo';
  end;
end $$;
reset role;
