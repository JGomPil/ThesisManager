-- =============================================================================
-- Las columnas del tablero (migracion 0024)
--
-- QUE SE JUEGA AQUI
-- El tablero pasa a dibujar un catalogo editable, y `tasks.status` —de donde
-- salen el progreso, los colores del cronograma, los bloqueos por dependencia y
-- los informes— se DERIVA de la columna. Dos cosas que pueden salir mal y no se
-- verian:
--
--   1. que la derivacion no ocurra: una tarjeta en «Hecho» que para la
--      aplicacion sigue pendiente. El tablero se veria perfecto y el progreso
--      del trabajo estaria mal.
--   2. que la comprobacion de organizacion falle ABIERTO: el disparador lee
--      `board_columns`, y si no fuese `security definer`, RLS le esconderia la
--      columna de otra organizacion —que es justamente la que hay que
--      rechazar— y se apartaria solo. Es el fallo que tumbo la primera version
--      de la 0023.
--
-- Datos de los ficheros anteriores:
--   admin        = 1111...  ADMIN de la organizacion aaaa...0001
--   investigador = 2222...  MEMBER, director de TFG-01 (puede planificar)
--   estudiante   = 3333...  MEMBER, estudiante de TFG-01
--   tarea        = dddd...0001 en TFG-01, asignada al estudiante
-- =============================================================================

-- Fixtures: se insertan con el rol por defecto, que no pasa por RLS.
insert into organizations (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000009','Otro grupo','otro-grupo')
on conflict (id) do nothing;
-- El segundo grupo se queda CON ADMINISTRACION, y no es un detalle: la
-- comprobacion 14 de `supabase/verify.sql` —«cada organizacion tiene al menos
-- un administrador activo»— se ejecuta al final de la tanda sobre esta misma
-- base, y un grupo de pruebas sin administrador la haria fallar. Seria un fallo
-- correcto sobre un dato inventado, o sea ruido que acabaria enseñando a
-- ignorar esa comprobacion. Que la misma persona administre dos grupos es
-- ademas un estado legitimo del modelo.
insert into organization_members (organization_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','ADMIN')
on conflict (organization_id, user_id) do nothing;
insert into board_columns (id, organization_id, name, color, maps_to, display_order) values
  ('ffffffff-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000009',
   'Columna ajena','slate','EN_CURSO',0)
on conflict (id) do nothing;

\echo '================ COLUMNAS DEL TABLERO ================'

\echo '[166] La administracion crea columnas con sus nombres; un miembro no'
do $$
declare v_n int;
begin
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  insert into board_columns (id, organization_id, name, color, maps_to, display_order) values
    ('ffffffff-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Por hacer','slate','PENDIENTE',0),
    ('ffffffff-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Papers','violet','EN_CURSO',1),
    ('ffffffff-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Hecho','green','COMPLETADA',2);
  reset role;

  select count(*) into v_n from board_columns
   where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_n <> 3 then
    raise exception 'FALLO [166]: la administracion no ha podido crear las columnas (hay %)', v_n;
  end if;

  -- Un miembro normal. La politica de escritura pide ser administrador.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into board_columns (organization_id, name, maps_to) values
      ('aaaaaaaa-0000-0000-0000-000000000001','Columna de un miembro','EN_CURSO');
  exception when others then null;
  end;
  reset role;

  select count(*) into v_n from board_columns
   where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_n <> 3 then
    raise exception 'FALLO [166]: un miembro ha creado una columna del tablero (hay %)', v_n;
  end if;
  raise notice 'CORRECTO [166]';
end $$;

\echo '[167] Mover la tarjeta a una columna DERIVA el estado y la marca de completado'
do $$
declare v_estado text; v_completado timestamptz;
begin
  -- Punto de partida: la tarea existe y no esta completada.
  if not exists (select 1 from tasks where id = 'dddddddd-0000-0000-0000-000000000001') then
    raise exception 'FALLO [167]: la prueba necesita la tarea dddd...0001 y no esta';
  end if;

  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set board_column_id = 'ffffffff-0000-0000-0000-000000000003'  -- «Hecho»
   where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;

  select status, completed_at into v_estado, v_completado
    from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if v_estado <> 'COMPLETADA' then
    raise exception 'FALLO [167]: la tarjeta esta en «Hecho» y el estado sigue siendo % (el progreso del trabajo estaria mal y el tablero se veria perfecto)', v_estado;
  end if;
  if v_completado is null then
    raise exception 'FALLO [167]: completada sin fecha de completado: no contaria en ningun recuento por fechas';
  end if;

  -- Y al revés: sacarla de «Hecho» quita el estado Y la marca.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set board_column_id = 'ffffffff-0000-0000-0000-000000000002'  -- «Papers»
   where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;

  select status, completed_at into v_estado, v_completado
    from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if v_estado <> 'EN_CURSO' or v_completado is not null then
    raise exception 'FALLO [167]: al salir de «Hecho» quedo estado=% completed_at=%', v_estado, v_completado;
  end if;
  raise notice 'CORRECTO [167]';
end $$;

\echo '[168] Una columna de OTRA organizacion se rechaza (y la comprobacion no falla abierto)'
do $$
declare v_col uuid; v_rechazado boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);

  -- Quien escribe NO VE esa columna: su politica de lectura solo alcanza a su
  -- organizacion. Si el disparador no fuese `security definer`, tampoco la
  -- veria él, no encontraria la fila y dejaria pasar el cambio. Se comprueba
  -- primero que, efectivamente, es invisible; así la prueba no se vuelve
  -- verde por el motivo equivocado.
  if exists (select 1 from board_columns where id = 'ffffffff-0000-0000-0000-000000000009') then
    reset role;
    raise exception 'FALLO [168]: la columna de otra organizacion es visible; la prueba no comprueba lo que dice';
  end if;

  begin
    update tasks set board_column_id = 'ffffffff-0000-0000-0000-000000000009'
     where id = 'dddddddd-0000-0000-0000-000000000001';
  exception when others then v_rechazado := true;
  end;
  reset role;

  select board_column_id into v_col from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if not v_rechazado then
    raise exception 'FALLO [168]: se ha aceptado una columna de otra organizacion';
  end if;
  if v_col <> 'ffffffff-0000-0000-0000-000000000002' then
    raise exception 'FALLO [168]: la tarjeta ha cambiado de columna (%)', v_col;
  end if;
  raise notice 'CORRECTO [168]';
end $$;

\echo '[169] El estudiante mueve SU tarjeta de columna, pero no renombra la columna'
do $$
declare v_col uuid; v_nombre text;
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  -- Mover su tarjeta es informar del avance: es lo mismo que cambiar el estado,
  -- lo unico que `enforce_task_update_scope` le permite.
  update tasks set board_column_id = 'ffffffff-0000-0000-0000-000000000001'  -- «Por hacer»
   where id = 'dddddddd-0000-0000-0000-000000000001';

  -- Renombrar la columna es administrar el catalogo: no.
  begin
    update board_columns set name = 'Mi columna'
     where id = 'ffffffff-0000-0000-0000-000000000001';
  exception when others then null;
  end;
  reset role;

  select board_column_id into v_col from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if v_col <> 'ffffffff-0000-0000-0000-000000000001' then
    raise exception 'FALLO [169]: el estudiante no ha podido mover su propia tarjeta (%)', coalesce(v_col::text,'NADA');
  end if;
  select name into v_nombre from board_columns where id = 'ffffffff-0000-0000-0000-000000000001';
  if v_nombre <> 'Por hacer' then
    raise exception 'FALLO [169]: el estudiante ha renombrado una columna del tablero (%)', v_nombre;
  end if;
  raise notice 'CORRECTO [169]';
end $$;

\echo '[170] Una columna con tarjetas no se borra; y completar por otra via recoloca la tarjeta'
do $$
declare v_borrado boolean := false; v_col uuid; v_estado text;
begin
  -- a) Borrar una columna que tiene tarjetas dentro: `on delete restrict`. Con
  --    `set null` las tarjetas se dispersarian sin que nadie lo pidiera.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  begin
    delete from board_columns where id = 'ffffffff-0000-0000-0000-000000000001';
    v_borrado := true;
  exception when foreign_key_violation then null;
  end;
  reset role;
  if v_borrado then
    raise exception 'FALLO [170]: se ha borrado una columna que tenia tarjetas';
  end if;

  -- b) «Marcar como completada» no pasa por el tablero: cambia el estado. La
  --    tarjeta tiene que irse sola a una columna que signifique completada, o
  --    quedaria una tarea hecha viviendo en «Por hacer».
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set status = 'COMPLETADA'
   where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;

  select board_column_id, status into v_col, v_estado
    from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if v_estado <> 'COMPLETADA' then
    raise exception 'FALLO [170]: el estado no se ha guardado (%)', v_estado;
  end if;
  if v_col is distinct from 'ffffffff-0000-0000-0000-000000000003' then
    raise exception 'FALLO [170]: la tarjeta completada se ha quedado en % en lugar de irse a «Hecho»', coalesce(v_col::text,'NINGUNA');
  end if;

  -- Se deja como estaba: los ficheros siguientes leen esta tarea.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set status = 'EN_CURSO', board_column_id = null
   where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;
  raise notice 'CORRECTO [170]';
end $$;

\echo '[171] Cambiar el SIGNIFICADO de una columna arrastra a las tarjetas que tiene dentro'
do $$
declare v_estado text; v_completado timestamptz; v_col uuid;
begin
  -- La tarjeta se deja en «Papers», que significa «en curso».
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set board_column_id = 'ffffffff-0000-0000-0000-000000000002'
   where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;

  select status into v_estado from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if v_estado <> 'EN_CURSO' then
    raise exception 'FALLO [171]: la tarjeta no ha tomado el significado de su columna (%)', v_estado;
  end if;

  -- Y ahora la administracion decide que «Papers» significa «completada». Las
  -- tareas que ya estan dentro tienen que seguirla: si no, el tablero y el
  -- progreso del trabajo cuentan historias distintas y nadie se enterara.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update board_columns set maps_to = 'COMPLETADA'
   where id = 'ffffffff-0000-0000-0000-000000000002';
  reset role;

  select status, completed_at, board_column_id into v_estado, v_completado, v_col
    from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if v_estado <> 'COMPLETADA' then
    raise exception 'FALLO [171]: la tarea se ha quedado en % mientras su columna significa COMPLETADA', v_estado;
  end if;
  -- La marca de completado la pone el otro disparador: una tarea completada sin
  -- `completed_at` no sale en ningun recuento por fechas.
  if v_completado is null then
    raise exception 'FALLO [171]: falta completed_at';
  end if;
  -- Y no se mueve de sitio: la columna ya significa lo que dice.
  if v_col is distinct from 'ffffffff-0000-0000-0000-000000000002' then
    raise exception 'FALLO [171]: la tarjeta se ha ido de su columna';
  end if;

  -- Se deja todo como estaba, que los ficheros siguientes leen esta tarea.
  set local role authenticated;
  perform set_config('test.uid','11111111-1111-1111-1111-111111111111', true);
  update board_columns set maps_to = 'EN_CURSO'
   where id = 'ffffffff-0000-0000-0000-000000000002';
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set board_column_id = null, status = 'EN_CURSO'
   where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;
  raise notice 'CORRECTO [171]';
end $$;
