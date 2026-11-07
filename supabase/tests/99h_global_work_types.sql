-- =============================================================================
-- Los tipos de trabajo GLOBALES, administrables (migración 0022)
--
-- QUÉ SE JUEGA AQUÍ
-- Esto empezó como un aviso en pantalla —«Cannot coerce the result to a single
-- JSON object [PGRST116]»— al editar un TFG. Debajo no había un fallo de la
-- interfaz: la política de la 0003 pedía `organization_id is not null`, así que
-- el UPDATE no tocaba ninguna fila. Un UPDATE al que una política le descarta
-- las filas NO DA ERROR: no cambia nada y se queda tan callado como una
-- casilla que parece funcionar (es el mismo fallo silencioso que cerró la
-- 0009). La prueba [156] es la que impide que vuelva.
--
-- Y las [157]–[158] son las dos puertas que se cierran al abrir esa: borrar un
-- tipo global —que lo comparten todas las organizaciones— y sacar una fila de
-- su ámbito cambiándole la organización o el código.
--
-- Datos de los ficheros anteriores:
--   admin        = 1111...  ADMIN de la organizacion aaaa...0001
--   investigador = 2222...  director de TFG-01, NO administrador
-- =============================================================================

\echo '================ TIPOS DE TRABAJO GLOBALES ================'

\echo '[156] La administracion edita un tipo GLOBAL; un director no'
do $$
declare v_nombre text; v_color text; v_meses int;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update work_types
     set name = 'Trabajo de Fin de Grado (GIB)', color = 'violet', default_duration_months = 10
   where code = 'TFG' and organization_id is null;
  reset role;

  select name, color, default_duration_months into v_nombre, v_color, v_meses
    from work_types where code = 'TFG' and organization_id is null;

  -- Las tres columnas, no solo una: el color es lo que pinta las tarjetas del
  -- resumen y la duracion lo que propone la fecha de fin, y el fallo original
  -- se las comia todas por igual.
  if v_nombre is distinct from 'Trabajo de Fin de Grado (GIB)' then
    raise exception 'FALLO [156]: la administracion no ha podido renombrar un tipo global (%)', v_nombre;
  end if;
  if v_color is distinct from 'violet' then
    raise exception 'FALLO [156]: no se ha podido cambiar el color de un tipo global (%)', v_color;
  end if;
  if v_meses is distinct from 10 then
    raise exception 'FALLO [156]: no se ha podido cambiar la duracion de un tipo global (%)', v_meses;
  end if;

  -- Y un director, que no es administracion, sigue sin poder.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    update work_types set name = 'Lo que quiera un director'
     where code = 'TFG' and organization_id is null;
  exception when others then null;
  end;
  reset role;

  select name into v_nombre from work_types where code = 'TFG' and organization_id is null;
  if v_nombre = 'Lo que quiera un director' then
    raise exception 'FALLO [156]: un director ha renombrado un tipo de trabajo global';
  end if;

  -- Se deja como estaba: lo leen el resto de ficheros y el `seed`.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update work_types
     set name = 'Trabajo de Fin de Grado', color = 'blue', default_duration_months = 9
   where code = 'TFG' and organization_id is null;
  reset role;
  raise notice 'CORRECTO [156]';
end $$;

\echo '[157] Un tipo global se RETIRA, pero NO se borra'
do $$
declare v_activo boolean; v_sigue boolean;
begin
  -- Un tipo global SIN trabajos, creado por el propietario (que no sufre RLS,
  -- como el catalogo inicial). Hace falta que no tenga trabajos: si los
  -- tuviera, el borrado lo impediria la clave ajena `on delete restrict` y
  -- esta prueba pasaria por el motivo equivocado, sin comprobar la politica.
  insert into work_types (organization_id, code, name, short_name, academic_level, display_order)
  values (null, 'GLOBAL_0022', 'Tipo global de prueba', 'Prueba', 'GRADO', 99)
  on conflict do nothing;

  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update work_types set is_active = false where code = 'GLOBAL_0022';
  begin
    delete from work_types where code = 'GLOBAL_0022';
  exception when others then null;
  end;
  reset role;

  select is_active into v_activo from work_types where code = 'GLOBAL_0022';
  select exists (select 1 from work_types where code = 'GLOBAL_0022') into v_sigue;

  if coalesce(v_activo, true) then
    raise exception 'FALLO [157]: no se ha podido retirar un tipo de trabajo global';
  end if;
  if not v_sigue then
    raise exception 'FALLO [157]: se ha BORRADO un tipo de trabajo global, y lo comparten todas las organizaciones';
  end if;

  delete from work_types where code = 'GLOBAL_0022';
  raise notice 'CORRECTO [157]';
end $$;

\echo '[158] La organizacion y el codigo de un tipo de trabajo son inmutables'
do $$
declare v_org uuid; v_code text; v_id uuid;
begin
  select id into v_id from work_types where code = 'TFG' and organization_id is null;

  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);

  -- Esto NO lo impide el WITH CHECK: con dos politicas permisivas, PostgreSQL
  -- combina los USING entre si y los WITH CHECK entre si, por separado (ver
  -- SECURITY.md 5.2.tervicies). Lo impide el disparador, y por eso se prueba.
  begin
    update work_types set organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' where id = v_id;
  exception when others then null;
  end;
  begin
    update work_types set code = 'TFG_RENOMBRADO' where id = v_id;
  exception when others then null;
  end;
  reset role;

  select organization_id, code into v_org, v_code from work_types where id = v_id;
  if v_org is not null then
    raise exception 'FALLO [158]: un tipo global ha pasado a ser de una organizacion';
  end if;
  if v_code is distinct from 'TFG' then
    raise exception 'FALLO [158]: se ha cambiado el codigo de un tipo de trabajo (%)', v_code;
  end if;
  raise notice 'CORRECTO [158]';
end $$;

\echo '[159] Los tipos PROPIOS de la organizacion se siguen editando y borrando'
do $$
declare v_nombre text; v_sigue boolean;
begin
  -- La 0022 anade una politica; no debe haber quitado nada de la 0003. Un tipo
  -- propio se crea, se edita y se borra si no lo usa nadie.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into work_types (organization_id, code, name, short_name, academic_level, display_order)
  values ('aaaaaaaa-0000-0000-0000-000000000001','PROPIO_0022','Tipo propio','Propio','GRADO', 98);
  update work_types set name = 'Tipo propio editado' where code = 'PROPIO_0022';
  select name into v_nombre from work_types where code = 'PROPIO_0022';
  delete from work_types where code = 'PROPIO_0022';
  reset role;

  select exists (select 1 from work_types where code = 'PROPIO_0022') into v_sigue;
  if v_nombre is distinct from 'Tipo propio editado' then
    raise exception 'FALLO [159]: no se ha podido editar un tipo propio (%)', v_nombre;
  end if;
  if v_sigue then
    raise exception 'FALLO [159]: no se ha podido borrar un tipo propio sin trabajos';
  end if;
  raise notice 'CORRECTO [159]';
end $$;
