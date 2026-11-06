-- =============================================================================
-- Políticas del cubo `work-documents` (migración 0010)
--
-- Reutiliza los datos de 10_roles_and_privacy.sql:
--   investigador = 2222...  director principal de TFG-01 (bbbb...0001)
--   estudiante   = 3333...  estudiante de TFG-01
--   ajeno        = 4444...  colaborador de TFG-01 añadido por la prueba [35]
--   TESIS-02     = bbbb...0002, donde el investigador es el doctorando
--
-- Las rutas siguen la convención <work_id>/<document_id>/<fichero>.
-- =============================================================================

\echo '================ FICHEROS: CUBO work-documents ================'

-- Objetos de prueba, insertados sin RLS (como el servicio de Storage).
insert into storage.objects (bucket_id, name) values
  ('work-documents', 'bbbbbbbb-0000-0000-0000-000000000001/d1/memoria-v1.pdf'),
  ('work-documents', 'bbbbbbbb-0000-0000-0000-000000000002/d2/tesis-borrador.pdf'),
  ('work-documents', 'no-es-un-uuid/d3/colado.pdf')
on conflict do nothing;

\echo '[47] El director ve el fichero de SU trabajo y no el de un trabajo ajeno'
do $$
declare visibles int; nombre text;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  select count(*) into visibles from storage.objects where bucket_id = 'work-documents';
  -- El investigador es director de TFG-01 y doctorando de TESIS-02: ve los dos
  -- ficheros, y ninguno más. Ese es justo el caso de los roles no excluyentes.
  if visibles <> 2 then
    raise exception 'FALLO [47]: el director ve % objetos, se esperaban 2', visibles;
  end if;
  select name into nombre from storage.objects where name like 'no-es-un-uuid%';
  if nombre is not null then
    raise exception 'FALLO [47]: se ve un objeto con ruta no generada por la aplicacion';
  end if;
  raise notice 'CORRECTO: ve los ficheros de sus trabajos y solo esos';
end $$;
reset role;

\echo '[48] El estudiante ve solo el fichero de su trabajo'
do $$
declare visibles int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into visibles from storage.objects where bucket_id = 'work-documents';
  if visibles <> 1 then
    raise exception 'FALLO [48]: el estudiante ve % objetos, se esperaba 1', visibles;
  end if;
  raise notice 'CORRECTO: el estudiante ve unicamente el fichero de su trabajo';
end $$;
reset role;

\echo '[49] anon NO ve ningun fichero (aunque tenga privilegios de tabla)'
do $$
declare visibles int;
begin
  set local role anon;
  perform set_config('test.uid','', true);
  select count(*) into visibles from storage.objects where bucket_id = 'work-documents';
  if visibles <> 0 then
    raise exception 'FALLO [49]: anon ve % ficheros', visibles;
  end if;
  raise notice 'CORRECTO: anon no ve ningun fichero';
end $$;
reset role;

\echo '[50] El estudiante SUBE a la carpeta de su trabajo (esperado: correcto)'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into storage.objects (bucket_id, name)
  values ('work-documents', 'bbbbbbbb-0000-0000-0000-000000000001/d9/entrega-del-alumno.pdf');
  raise notice 'CORRECTO: el estudiante puede entregar en su trabajo';
end $$;
reset role;

\echo '[51] El estudiante NO puede subir a la carpeta de otro trabajo (esperado: bloqueado)'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    insert into storage.objects (bucket_id, name)
    values ('work-documents', 'bbbbbbbb-0000-0000-0000-000000000002/d9/me-cuelo.pdf');
    raise exception 'FALLO [51]: el estudiante ha subido a un trabajo ajeno';
  exception
    when insufficient_privilege then
      raise notice 'CORRECTO: no puede subir a la carpeta de otro trabajo';
  end;
end $$;
reset role;

\echo '[52] Nadie puede subir con una ruta que no empiece por un uuid de trabajo'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into storage.objects (bucket_id, name)
    values ('work-documents', 'sin-carpeta.pdf');
    raise exception 'FALLO [52]: se ha aceptado una ruta sin carpeta de trabajo';
  exception
    when insufficient_privilege then
      raise notice 'CORRECTO: la ruta debe empezar por el uuid del trabajo';
  end;
end $$;
reset role;

\echo '[53] El estudiante NO puede borrar el fichero de un trabajo ajeno'
do $$
declare quedan int;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  delete from storage.objects
  where name = 'bbbbbbbb-0000-0000-0000-000000000002/d2/tesis-borrador.pdf';
  reset role;
  select count(*) into quedan from storage.objects
  where name = 'bbbbbbbb-0000-0000-0000-000000000002/d2/tesis-borrador.pdf';
  -- Un DELETE que RLS filtra no lanza error: borra cero filas. Hay que
  -- comprobar el estado, no la ausencia de excepcion.
  if quedan <> 1 then
    raise exception 'FALLO [53]: el fichero ajeno ha desaparecido';
  end if;
  raise notice 'CORRECTO: el fichero del trabajo ajeno sigue ahi';
end $$;
reset role;
