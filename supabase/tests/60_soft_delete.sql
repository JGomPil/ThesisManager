-- =============================================================================
-- Archivado de trabajos: reservado a la administración (migración 0008)
-- Reutiliza los datos de 10_roles_and_privacy.sql.
--   admin        = 1111...  (ADMIN de la organización)
--   investigador = 2222...  (director principal de TFG-01)
-- =============================================================================

\echo '================ ARCHIVADO DE TRABAJOS ================'

\echo '[37] El director principal NO puede archivar su trabajo (esperado: rechazado)'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    update academic_works set deleted_at = now()
    where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    raise exception 'FALLO [37]: un director ha podido archivar el trabajo';
  exception
    when insufficient_privilege then
      raise notice 'CORRECTO: el director no puede archivar un trabajo';
  end;
end $$;
reset role;

\echo '[38] El director SÍ puede seguir editando el trabajo (no se le ha roto nada)'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update academic_works set title = 'TFG-01 (editado por el director)'
  where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if not exists (
    select 1 from academic_works
    where id = 'bbbbbbbb-0000-0000-0000-000000000001'
      and title = 'TFG-01 (editado por el director)'
  ) then
    raise exception 'FALLO [38]: el director no ha podido editar el trabajo';
  end if;
  raise notice 'CORRECTO: el director conserva la edicion del trabajo';
end $$;
reset role;

\echo '[39] La administración SÍ puede archivar'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update academic_works set deleted_at = now()
  where id = 'bbbbbbbb-0000-0000-0000-000000000003';
  if not exists (
    select 1 from academic_works
    where id = 'bbbbbbbb-0000-0000-0000-000000000003' and deleted_at is not null
  ) then
    raise exception 'FALLO [39]: la administracion no ha podido archivar';
  end if;
  raise notice 'CORRECTO: la administracion archiva el trabajo';
end $$;
reset role;

\echo '[40] Y puede restaurarlo (el archivado es reversible)'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update academic_works set deleted_at = null
  where id = 'bbbbbbbb-0000-0000-0000-000000000003';
  if exists (
    select 1 from academic_works
    where id = 'bbbbbbbb-0000-0000-0000-000000000003' and deleted_at is not null
  ) then
    raise exception 'FALLO [40]: no se ha podido restaurar';
  end if;
  raise notice 'CORRECTO: el archivado es reversible';
end $$;
reset role;

\echo '[41] Un trabajo archivado lo ve la administracion y NADIE mas'
do $$
declare visto_admin int; visto_director int;
begin
  -- Lo archiva la administración.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update academic_works set deleted_at = now()
  where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  select count(*) into visto_admin from academic_works
  where id = 'bbbbbbbb-0000-0000-0000-000000000001';

  -- El director principal de ese mismo trabajo ya no debe verlo.
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  select count(*) into visto_director from academic_works
  where id = 'bbbbbbbb-0000-0000-0000-000000000001';

  if visto_admin <> 1 then
    raise exception 'FALLO [41]: la administracion no ve el trabajo archivado (lo haria irrecuperable)';
  end if;
  if visto_director <> 0 then
    raise exception 'FALLO [41]: el director sigue viendo un trabajo archivado';
  end if;
  raise notice 'CORRECTO: lo archivado solo lo ve la administracion';

  -- Se restaura para no dejar rastro a las pruebas siguientes.
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update academic_works set deleted_at = null
  where id = 'bbbbbbbb-0000-0000-0000-000000000001';
end $$;
reset role;
