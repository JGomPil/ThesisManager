-- =============================================================================
-- Administración de los catálogos planos: líneas, titulaciones y cursos.
--
-- No había ninguna prueba sobre la ESCRITURA de estos catálogos. Las políticas
-- `lines_write`, `programs_write` y `years_write` existían desde la 0003 y
-- nadie las había ejercitado; se añaden al dar al administrador una pantalla
-- para gestionarlos.
--
-- La prueba [92] es la importante, y no comprueba que algo falle sino que algo
-- FUNCIONA de una manera peligrosa: borrar una línea en uso no da error, deja
-- en blanco la línea de los trabajos que la tenían y no queda rastro de cuál
-- era. Está escrita para que ese comportamiento quede documentado y para que
-- salte si alguna vez alguien cambia el `on delete set null` por otra cosa; es
-- la razón de que la interfaz avise con el recuento antes de borrar.
--
-- Datos de 10_roles_and_privacy.sql:
--   admin        = 1111...  ADMIN de la organización
--   investigador = 2222...  director de TFG-01, NO administrador
--   TFG-01 = bbbb...0001    organización = aaaa...0001
-- =============================================================================

\echo '================ CATALOGOS: ADMINISTRACION ================'

\echo '[90] Un director NO puede crear ni borrar lineas de investigacion'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into research_lines (id, organization_id, name)
    values ('ffff0000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Linea de un director');
  exception when others then null;
  end;
  reset role;
  if exists (select 1 from research_lines where id = 'ffff0000-0000-0000-0000-000000000001') then
    raise exception 'FALLO [90]: un director ha creado una linea de la organizacion';
  end if;
  raise notice 'CORRECTO: los catalogos los gestiona la administracion';
end $$;
reset role;

\echo '[91] La administracion crea, renombra y retira una linea'
do $$
declare v_nombre text; v_activa boolean;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into research_lines (id, organization_id, name, description)
  values ('ffff0000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',
          'Analisis de senales', 'Series temporales');

  update research_lines set name = 'Analisis de senales biomedicas'
   where id = 'ffff0000-0000-0000-0000-000000000002';
  update research_lines set is_active = false
   where id = 'ffff0000-0000-0000-0000-000000000002';

  select name, is_active into v_nombre, v_activa
    from research_lines where id = 'ffff0000-0000-0000-0000-000000000002';
  reset role;

  if v_nombre <> 'Analisis de senales biomedicas' then
    raise exception 'FALLO [91]: no se ha renombrado (quedo %)', v_nombre;
  end if;
  if v_activa then
    raise exception 'FALLO [91]: no se ha retirado';
  end if;
  raise notice 'CORRECTO: crear, renombrar y retirar';
end $$;
reset role;

\echo '[92] Borrar una linea EN USO no falla: deja el trabajo sin linea'
do $$
declare v_linea uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into research_lines (id, organization_id, name)
  values ('ffff0000-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Linea en uso');
  update academic_works set research_line_id = 'ffff0000-0000-0000-0000-000000000003'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';

  -- Esto NO lanza error. Es `on delete set null`, no `restrict`.
  delete from research_lines where id = 'ffff0000-0000-0000-0000-000000000003';

  select research_line_id into v_linea from academic_works
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  reset role;

  if exists (select 1 from research_lines where id = 'ffff0000-0000-0000-0000-000000000003') then
    raise exception 'FALLO [92]: la linea sigue existiendo; el borrado no ha funcionado';
  end if;
  if v_linea is not null then
    raise exception 'FALLO [92]: el trabajo conserva una linea que ya no existe (%)', v_linea;
  end if;
  raise notice 'CORRECTO: el borrado se lleva el dato del trabajo (de ahi el aviso de la interfaz)';
end $$;
reset role;

\echo '[93] Retirar una linea NO la quita de los trabajos que la usaban'
do $$
declare v_linea uuid;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into research_lines (id, organization_id, name)
  values ('ffff0000-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','Linea retirada');
  update academic_works set research_line_id = 'ffff0000-0000-0000-0000-000000000004'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';

  update research_lines set is_active = false where id = 'ffff0000-0000-0000-0000-000000000004';

  select research_line_id into v_linea from academic_works
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  reset role;

  if v_linea is distinct from 'ffff0000-0000-0000-0000-000000000004'::uuid then
    raise exception 'FALLO [93]: retirar la linea la ha quitado del trabajo';
  end if;
  raise notice 'CORRECTO: retirar conserva el historico; esa es la diferencia con borrar';
end $$;
reset role;

\echo '[94] Un director tampoco toca titulaciones ni cursos academicos'
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into programs (id, organization_id, code, name)
    values ('ffff0000-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','XX','Titulacion ajena');
  exception when others then null;
  end;
  begin
    insert into academic_years (id, organization_id, code, start_date, end_date)
    values ('ffff0000-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000001',
            '2099/2100', date '2099-09-01', date '2100-07-31');
  exception when others then null;
  end;
  reset role;
  if exists (select 1 from programs where id = 'ffff0000-0000-0000-0000-000000000005') then
    raise exception 'FALLO [94]: un director ha creado una titulacion';
  end if;
  if exists (select 1 from academic_years where id = 'ffff0000-0000-0000-0000-000000000006') then
    raise exception 'FALLO [94]: un director ha creado un curso academico';
  end if;
  raise notice 'CORRECTO: titulaciones y cursos, solo la administracion';
end $$;
reset role;

\echo '[95] No puede haber dos cursos academicos marcados como actuales'
do $$
declare v_error boolean := false; v_actuales int;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into academic_years (id, organization_id, code, start_date, end_date, is_current)
  values ('ffff0000-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000001',
          '2030/2031', date '2030-09-01', date '2031-07-31', true);
  begin
    insert into academic_years (id, organization_id, code, start_date, end_date, is_current)
    values ('ffff0000-0000-0000-0000-000000000008','aaaaaaaa-0000-0000-0000-000000000001',
            '2031/2032', date '2031-09-01', date '2032-07-31', true);
  exception when others then v_error := true;
  end;
  reset role;

  select count(*) into v_actuales from academic_years
   where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' and is_current;
  if v_actuales <> 1 then
    raise exception 'FALLO [95]: hay % cursos actuales', v_actuales;
  end if;
  if not v_error then
    raise exception 'FALLO [95]: el segundo curso actual no ha dado error';
  end if;
  raise notice 'CORRECTO: el indice unico parcial lo impide (de ahi que la interfaz desmarque antes)';
end $$;
reset role;
