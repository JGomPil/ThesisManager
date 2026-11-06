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

-- =============================================================================
-- El alta completa en un solo paso, tal y como la hace el formulario
-- =============================================================================

\echo '[42] El admin crea un trabajo y asigna direccion y estudiante acto seguido'
do $$
declare
  nuevo uuid;
  rol_dir uuid;
  rol_alu uuid;
  n int;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);

  select id into rol_dir from work_roles where is_supervisory and can_manage_members limit 1;
  select id into rol_alu from work_roles where is_student limit 1;

  -- 1. Crear. El `returning` es lo que hace supabase-js con .insert().select().
  insert into academic_works (organization_id, work_type_id, status_id, title)
  select 'aaaaaaaa-0000-0000-0000-000000000001',
         (select id from work_types where code='TFG'),
         (select id from work_statuses where code='PROPUESTA'),
         'TFG recien creado con participantes'
  returning id into nuevo;

  -- 2. Asignarse como dirección: el administrador aún no es miembro de este
  --    trabajo, así que esto depende de `app.is_admin_of_work`, no de
  --    `has_work_capability`. Es justo el punto donde el formulario fallaría
  --    si la política solo mirase las funciones académicas.
  insert into work_members (work_id, user_id, work_role_id, is_primary)
  values (nuevo, '11111111-1111-1111-1111-111111111111', rol_dir, true);

  -- 3. Y asignar al estudiante.
  insert into work_members (work_id, user_id, work_role_id, is_primary)
  values (nuevo, '33333333-3333-3333-3333-333333333333', rol_alu, true);

  select count(*) into n from work_members where work_id = nuevo;
  if n <> 2 then
    raise exception 'FALLO [42]: se esperaban 2 participantes y hay %', n;
  end if;

  -- Y el trabajo debe ser visible de inmediato para el estudiante asignado.
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  select count(*) into n from academic_works where id = nuevo;
  if n <> 1 then
    raise exception 'FALLO [42]: el estudiante asignado no ve su trabajo';
  end if;

  raise notice 'CORRECTO: alta del trabajo con direccion y estudiante en un paso';
end $$;
reset role;
