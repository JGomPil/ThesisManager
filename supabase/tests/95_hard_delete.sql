-- =============================================================================
-- Borrado definitivo de un trabajo: reservado a la administración
--
-- La política `works_delete` existe desde la migración 0003, pero ninguna
-- pantalla la usaba y ninguna prueba la cubría. Se añade la opción en la
-- interfaz (Administración → Trabajos archivados) a petición del usuario el 6
-- de noviembre de 2026, para poder limpiar pruebas y, más adelante, trabajos
-- antiguos. Con la opción, llegan las pruebas.
--
-- Reutiliza los datos de 10_roles_and_privacy.sql.
-- =============================================================================

\echo '================ BORRADO DEFINITIVO ================'

-- Un trabajo nuevo, con tareas y documentos, para comprobar la cascada.
do $$
declare w uuid; t uuid; d uuid;
begin
  insert into academic_works (organization_id, work_type_id, status_id, title)
  select 'aaaaaaaa-0000-0000-0000-000000000001',
         (select id from work_types where code='TFG'),
         (select id from work_statuses where code='PROPUESTA'),
         'Trabajo que se va a borrar'
  returning id into w;

  insert into work_members (work_id, user_id, work_role_id, is_primary)
  select w, '22222222-2222-2222-2222-222222222222',
         (select id from work_roles where code='PRIMARY_SUPERVISOR'), true;

  insert into tasks (work_id, title) values (w, 'Tarea que desaparecera') returning id into t;
  insert into tasks (work_id, parent_task_id, title) values (w, t, 'Punto de lista');

  insert into documents (work_id, name, created_by)
  values (w, 'Documento que desaparecera', '22222222-2222-2222-2222-222222222222')
  returning id into d;
  insert into document_versions (document_id, work_id, version_label, storage_path, author_id)
  values (d, w, 'v1', w || '/' || d || '/fichero.pdf', '22222222-2222-2222-2222-222222222222');

  perform set_config('test.doomed', w::text, false);
  raise notice 'Preparado: trabajo con 2 tareas y 1 documento con version';
end $$;

\echo '[61] El director principal NO puede borrar el trabajo (esperado: bloqueado)'
do $$
declare w uuid; quedan int;
begin
  w := current_setting('test.doomed')::uuid;
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  delete from academic_works where id = w;
  reset role;
  -- Un DELETE filtrado por RLS no lanza error: borra cero filas. Hay que
  -- comprobar el estado, nunca la ausencia de excepcion.
  select count(*) into quedan from academic_works where id = w;
  if quedan <> 1 then
    raise exception 'FALLO [61]: un director ha borrado el trabajo definitivamente';
  end if;
  raise notice 'CORRECTO: el director no puede borrar, solo la administracion';
end $$;
reset role;

\echo '[62] La administración SÍ puede, y se lleva en cascada todo lo del trabajo'
do $$
declare w uuid; n_trabajos int; n_tareas int; n_docs int; n_versiones int; n_miembros int;
begin
  w := current_setting('test.doomed')::uuid;
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  delete from academic_works where id = w;
  reset role;

  select count(*) into n_trabajos  from academic_works    where id = w;
  select count(*) into n_tareas    from tasks             where work_id = w;
  select count(*) into n_docs      from documents         where work_id = w;
  select count(*) into n_versiones from document_versions where work_id = w;
  select count(*) into n_miembros  from work_members      where work_id = w;

  if n_trabajos <> 0 then raise exception 'FALLO [62]: el trabajo sigue ahi'; end if;
  if n_tareas    <> 0 then raise exception 'FALLO [62]: quedan % tareas huerfanas', n_tareas; end if;
  if n_docs      <> 0 then raise exception 'FALLO [62]: quedan % documentos huerfanos', n_docs; end if;
  if n_versiones <> 0 then raise exception 'FALLO [62]: quedan % versiones huerfanas', n_versiones; end if;
  if n_miembros  <> 0 then raise exception 'FALLO [62]: quedan % participantes huerfanos', n_miembros; end if;

  raise notice 'CORRECTO: borrado con toda su cascada';
end $$;
reset role;

\echo '[63] Los FICHEROS no se van en cascada: tiene que limpiarlos la aplicacion'
do $$
declare w uuid; huerfanos int;
begin
  w := current_setting('test.doomed')::uuid;
  -- Se simula un fichero que se hubiera quedado sin limpiar.
  insert into storage.objects (bucket_id, name)
  values ('work-documents', w || '/doc/huerfano.pdf');

  select count(*) into huerfanos from storage.objects where name like w || '/%';
  if huerfanos = 0 then
    raise exception 'FALLO [63]: la prueba no ha podido crear el fichero';
  end if;

  -- Esto es lo que documenta `worksRepo.destroy`: `storage.objects` no tiene
  -- clave ajena hacia `academic_works`, asi que el fichero sobrevive al
  -- borrado del trabajo y hay que borrarlo explicitamente ANTES, mientras las
  -- politicas del cubo todavia autorizan por el uuid del trabajo.
  raise notice 'CORRECTO (y es el motivo de que destroy() borre los ficheros primero): % fichero(s) sobreviven al borrado del trabajo', huerfanos;

  -- Y una vez borrado el trabajo, ni la administracion los ve: la ruta ya no
  -- corresponde a ningun trabajo accesible.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  select count(*) into huerfanos from storage.objects where name like w || '/%';
  if huerfanos <> 0 then
    raise exception 'FALLO [63]: la administracion ve ficheros de un trabajo borrado';
  end if;
  raise notice 'CORRECTO: tras borrar el trabajo, sus ficheros quedan inalcanzables';
end $$;
reset role;
