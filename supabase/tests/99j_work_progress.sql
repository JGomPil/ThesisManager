-- =============================================================================
-- El juicio de la direccion: progreso academico y fin real
--
-- QUE SE JUEGA AQUI
-- La ficha del trabajo ensenaba «Progreso academico · a juicio de la
-- direccion» y «Fin real», y ningun formulario escribia ninguno de los dos:
-- la direccion leia su propio juicio sin poder emitirlo. Ahora se escriben
-- desde la ficha y desde el formulario de edicion.
--
-- Lo que permite esa escritura NO es ningun cambio en la base de datos: es
-- `works_update`, que desde la 0003 admite a la administracion del grupo Y a
-- los directores del trabajo (`app.is_work_supervisor`). Esta prueba fija esa
-- promesa, que es la que sostiene los dos campos nuevos: si alguien estrechara
-- la politica a `is_org_admin`, los dos botones de la ficha dejarian de
-- guardar y —por lo de siempre, que un UPDATE descartado por RLS no da error—
-- lo harian sin decir nada.
--
-- Datos de los ficheros anteriores:
--   investigador 2222... = MEMBER de la organizacion y DIRECTOR de TFG-01
--   estudiante   3333... = MEMBER y ESTUDIANTE del mismo trabajo
--   TFG-01               = bbbbbbbb-0000-0000-0000-000000000001
-- =============================================================================

\echo '================ PROGRESO ACADEMICO Y FIN REAL ================'

\echo '[164] La direccion, sin ser administracion, registra el progreso academico y el fin real'
do $$
declare v_rol text; v_progreso int; v_fin date;
begin
  -- Punto de partida: el director NO es administrador del grupo. Si lo fuera,
  -- la prueba pasaria por la otra rama de la politica y no comprobaria nada de
  -- lo que dice comprobar.
  select role into v_rol from organization_members
   where user_id = '22222222-2222-2222-2222-222222222222'
     and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_rol <> 'MEMBER' then
    raise exception 'FALLO [164]: la prueba necesita un director que NO sea administrador y es %', v_rol;
  end if;

  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update academic_works
     set progress_override = 40,
         actual_end_date = date '2026-06-30'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  reset role;

  select progress_override, actual_end_date into v_progreso, v_fin
    from academic_works where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if v_progreso is distinct from 40 then
    raise exception 'FALLO [164]: el director no ha podido registrar el progreso academico (%)', coalesce(v_progreso::text,'NADA');
  end if;
  if v_fin is distinct from date '2026-06-30' then
    raise exception 'FALLO [164]: el director no ha podido registrar el fin real (%)', coalesce(v_fin::text,'NADA');
  end if;

  -- Y «sin valorar» tiene que poder volver: vaciar el campo en la ficha guarda
  -- NULL, que no es lo mismo que un 0 %.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update academic_works set progress_override = null
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  reset role;

  select progress_override into v_progreso
    from academic_works where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if v_progreso is not null then
    raise exception 'FALLO [164]: no se ha podido dejar el progreso sin valorar (%)', v_progreso;
  end if;
  raise notice 'CORRECTO [164]';
end $$;

\echo '[165] El estudiante no los puede tocar, y el rango 0-100 lo impone la base de datos'
do $$
declare v_progreso int; v_rechazado boolean := false;
begin
  -- Se deja un valor conocido con quien si puede, para distinguir «no ha
  -- cambiado nada» de «no habia nada que cambiar».
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update academic_works set progress_override = 40
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  reset role;

  -- El estudiante del trabajo. `works_update` no lo incluye, asi que el UPDATE
  -- no afecta a ninguna fila: NO da error. Por eso se comprueba el dato.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update academic_works set progress_override = 99, actual_end_date = date '2026-01-01'
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  exception when others then null;
  end;
  reset role;

  select progress_override into v_progreso
    from academic_works where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if v_progreso is distinct from 40 then
    raise exception 'FALLO [165]: el estudiante ha cambiado el progreso academico de su trabajo (%)', coalesce(v_progreso::text,'NADA');
  end if;

  -- El rango no es cosa del formulario: lo hay en la tabla desde la 0002
  -- (`check (progress_override between 0 and 100)`). Un 150 se rechaza aunque
  -- lo escriba quien tiene permiso.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    update academic_works set progress_override = 150
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  exception when check_violation then v_rechazado := true;
  end;
  reset role;

  if not v_rechazado then
    raise exception 'FALLO [165]: la base de datos ha aceptado un progreso del 150 %%';
  end if;

  -- Se deja como estaba: los ficheros siguientes leen este trabajo.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update academic_works set progress_override = null, actual_end_date = null
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  reset role;
  raise notice 'CORRECTO [165]';
end $$;
