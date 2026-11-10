-- =============================================================================
-- Las columnas del tablero (migracion 0024)
--
-- QUE SE JUEGA AQUI
-- El tablero pasa a tener columnas con el nombre que quiera quien dirige el
-- trabajo, estilo Trello. Tres cosas pueden salir mal y ninguna daria error en
-- la pantalla:
--
--   1. QUIEN las administra. Si la politica pidiera administracion del grupo,
--      la direccion de una tesis no podria renombrar sus propias columnas y lo
--      unico que veria es que no pasa nada (a un UPDATE sin permiso la politica
--      le descarta las filas y NO falla).
--   2. Que mover una tarjeta cambie el estado de la tarea. Son dos
--      clasificaciones distintas a proposito: «Papers» no es un estado. Si una
--      se llevara a la otra, el progreso del trabajo y el cronograma cambiarian
--      al reordenar el tablero.
--   3. Que la comprobacion de «la columna es de este trabajo» falle ABIERTA: el
--      disparador lee `board_columns`, y sin `security definer` RLS le
--      esconderia la columna de otro trabajo —la que hay que rechazar— y se
--      apartaria sola. Es el fallo que tumbo la primera version de la 0023.
--
-- Datos de los ficheros anteriores:
--   admin        = 1111...  ADMIN de la organizacion aaaa...0001
--   investigador = 2222...  director de TFG-01 (puede planificar) y ESTUDIANTE
--                           de su propia TESIS-02
--   estudiante   = 3333...  estudiante de TFG-01
--   TFG-01       = bbbb...0001     TESIS-02 = bbbb...0002
--   tarea        = dddd...0001 en TFG-01, asignada al estudiante
-- =============================================================================

-- Fixture: una columna en OTRO trabajo. Se inserta con el rol por defecto, que
-- no pasa por RLS, porque en TESIS-02 el investigador es estudiante y no puede
-- crearla: lo que se prueba con ella es el rechazo, no su alta.
insert into board_columns (id, work_id, name, color, display_order) values
  ('ffffffff-0000-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-000000000002',
   'Columna ajena','slate',0)
on conflict (id) do nothing;

\echo '================ COLUMNAS DEL TABLERO ================'

\echo '[166] El DIRECTOR del trabajo crea sus columnas con el nombre que quiera; el estudiante no'
do $$
declare v_n int; v_creada boolean := false;
begin
  -- El director no es administrador del grupo: si la politica pidiera
  -- `is_org_admin` esto no insertaria nada y no daria error.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into board_columns (id, work_id, name, color, display_order) values
    ('ffffffff-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Papers','violet',0),
    ('ffffffff-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','Estudios','blue',1);
  select count(*) into v_n from board_columns where work_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  reset role;
  if v_n <> 2 then
    raise exception 'FALLO [166]: el director no ha podido crear sus columnas (%)', v_n;
  end if;

  -- Y el nombre es libre: ningun catalogo que casar, ningun significado que
  -- elegir. Se comprueba con uno que no se parece a ningun estado.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update board_columns set name = 'Enviado a revista'
   where id = 'ffffffff-0000-0000-0000-000000000002';
  reset role;
  if (select name from board_columns where id = 'ffffffff-0000-0000-0000-000000000002')
     <> 'Enviado a revista' then
    raise exception 'FALLO [166]: el director no ha podido renombrar su columna';
  end if;
  -- Se deja como estaba, que las pruebas de abajo la nombran.
  update board_columns set name = 'Estudios' where id = 'ffffffff-0000-0000-0000-000000000002';

  -- El estudiante del trabajo, no: es el plan de trabajo, igual que los hitos.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    insert into board_columns (work_id, name, display_order)
    values ('bbbbbbbb-0000-0000-0000-000000000001','Mi columna',9);
    v_creada := true;
  exception when insufficient_privilege then null;
  end;
  reset role;
  if v_creada then
    raise exception 'FALLO DE SEGURIDAD [166]: el estudiante ha creado una columna';
  end if;
  raise notice 'CORRECTO [166]';
end $$;

\echo '[167] Mover la tarjeta NO cambia el estado, y cambiar el estado NO mueve la tarjeta'
do $$
declare v_estado text; v_col uuid;
begin
  -- a) La tarjeta a «Papers». El estado tiene que quedarse donde estaba: una
  --    columna es una clasificacion mas, no un estado disfrazado.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set status = 'EN_CURSO' where id = 'dddddddd-0000-0000-0000-000000000001';
  update tasks set board_column_id = 'ffffffff-0000-0000-0000-000000000001'
   where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;

  select status, board_column_id into v_estado, v_col
    from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if v_col is distinct from 'ffffffff-0000-0000-0000-000000000001' then
    raise exception 'FALLO [167]: la tarjeta no se ha movido';
  end if;
  if v_estado <> 'EN_CURSO' then
    raise exception 'FALLO [167]: mover la tarjeta ha cambiado el estado a %', v_estado;
  end if;

  -- b) Y al contrario: completar la tarea no la saca de «Papers». Si la sacara,
  --    el tablero se reordenaria solo cada vez que alguien marca algo.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set status = 'COMPLETADA' where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;

  select status, board_column_id into v_estado, v_col
    from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if v_estado <> 'COMPLETADA' or v_col is distinct from 'ffffffff-0000-0000-0000-000000000001' then
    raise exception 'FALLO [167]: completar la tarea le ha movido la tarjeta (% / %)', v_estado, v_col;
  end if;
  raise notice 'CORRECTO [167]';
end $$;

\echo '[168] Una columna de OTRO trabajo se rechaza (y la comprobacion no falla abierta)'
do $$
declare v_aceptada boolean := false;
begin
  -- Lo intenta el DIRECTOR, que si puede escribir esta tarea: es la unica
  -- sesion que distingue un rechazo de verdad de un «no tenia permiso de todas
  -- formas». Y es tambien la que destapa el fallo abierto: sin
  -- `security definer`, el disparador no veria la columna de TESIS-02 y dejaria
  -- pasar la tarjeta al tablero de otro trabajo.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    update tasks set board_column_id = 'ffffffff-0000-0000-0000-000000000009'
     where id = 'dddddddd-0000-0000-0000-000000000001';
    v_aceptada := true;
  exception when check_violation or foreign_key_violation then null;
  end;
  reset role;
  if v_aceptada then
    raise exception 'FALLO DE SEGURIDAD [168]: la tarjeta ha pasado al tablero de otro trabajo';
  end if;
  if (select board_column_id from tasks where id = 'dddddddd-0000-0000-0000-000000000001')
     is distinct from 'ffffffff-0000-0000-0000-000000000001' then
    raise exception 'FALLO [168]: la tarjeta ya no esta donde estaba';
  end if;
  raise notice 'CORRECTO [168]';
end $$;

\echo '[169] El estudiante mueve y escribe SU tarjeta, pero no renombra la columna'
do $$
declare v_col uuid; v_orden int;
begin
  -- Mover su tarjeta y colocarla: es informar de lo suyo, y es el gesto de
  -- arrastrar, que ESCRIBE una posicion siempre. Si `order_index` siguiera
  -- prohibido, el arrastre fallaria con un mensaje que no le dice nada.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update tasks set board_column_id = 'ffffffff-0000-0000-0000-000000000002', order_index = 3
   where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;

  select board_column_id, order_index into v_col, v_orden
    from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if v_col is distinct from 'ffffffff-0000-0000-0000-000000000002' or v_orden <> 3 then
    raise exception 'FALLO [169]: el estudiante no ha podido mover su tarjeta (% / %)', v_col, v_orden;
  end if;

  -- Y DESDE LA 0030, el titulo de su propia tarjeta tambien es suyo: la tarjeta
  -- es donde cuenta lo que esta haciendo.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update tasks set title = 'Revision bibliografica (en curso)'
   where id = 'dddddddd-0000-0000-0000-000000000001';
  -- LA COLUMNA, NO: el tablero es la forma de trabajar del trabajo entero, y la
  -- comparten todos. Se comprueba EL DATO, porque a un UPDATE sin permiso la
  -- politica le descarta las filas y no da ningun error.
  update board_columns set name = 'Lo mio' where id = 'ffffffff-0000-0000-0000-000000000002';
  reset role;

  if (select title from tasks where id = 'dddddddd-0000-0000-0000-000000000001')
       <> 'Revision bibliografica (en curso)' then
    raise exception 'FALLO [169]: el responsable no ha podido escribir el titulo de su tarjeta';
  end if;
  if (select name from board_columns where id = 'ffffffff-0000-0000-0000-000000000002') <> 'Estudios' then
    raise exception 'FALLO DE SEGURIDAD [169]: el estudiante ha renombrado la columna';
  end if;
  raise notice 'CORRECTO [169]';
end $$;

\echo '[170] Una columna con tarjetas no se borra; y la marca de completado la pone la base de datos'
do $$
declare v_borrado boolean := false; v_completado timestamptz;
begin
  -- a) `on delete restrict`: con `set null` las tarjetas se esparcirian sin que
  --    nadie lo hubiera pedido.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    delete from board_columns where id = 'ffffffff-0000-0000-0000-000000000002';
    v_borrado := true;
  exception when foreign_key_violation then null;
  end;
  reset role;
  if v_borrado then
    raise exception 'FALLO [170]: se ha borrado una columna que tenia tarjetas';
  end if;

  -- b) `completed_at` ya no depende de que el cliente se acuerde. La tarea
  --    quedo COMPLETADA en la [167] sin que nadie escribiera la marca.
  select completed_at into v_completado
    from tasks where id = 'dddddddd-0000-0000-0000-000000000001';
  if v_completado is null then
    raise exception 'FALLO [170]: una tarea completada sin completed_at no sale en ningun recuento por fechas';
  end if;

  -- Y al dejar de estar completada se retira, que si no el recuento la cuenta
  -- dos veces: como pendiente y como terminada en su dia.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set status = 'EN_CURSO' where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;
  if (select completed_at from tasks where id = 'dddddddd-0000-0000-0000-000000000001') is not null then
    raise exception 'FALLO [170]: completed_at se ha quedado puesto en una tarea que ya no esta completada';
  end if;
  raise notice 'CORRECTO [170]';
end $$;

\echo '[171] Dos columnas con el mismo nombre en el mismo tablero, no; en otro trabajo, si'
do $$
declare v_duplicada boolean := false;
begin
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    insert into board_columns (work_id, name, display_order)
    values ('bbbbbbbb-0000-0000-0000-000000000001','Papers',5);
    v_duplicada := true;
  exception when unique_violation then null;
  end;
  reset role;
  if v_duplicada then
    raise exception 'FALLO [171]: dos columnas «Papers» en el mismo tablero no se distinguen';
  end if;

  -- El mismo nombre en otro tablero es legitimo: la unicidad es por trabajo, y
  -- si fuera global dos tesis no podrian tener las dos su columna «Papers».
  insert into board_columns (work_id, name, display_order)
  values ('bbbbbbbb-0000-0000-0000-000000000002','Papers',5);
  if (select count(*) from board_columns where name = 'Papers') <> 2 then
    raise exception 'FALLO [171]: la unicidad del nombre no es por trabajo';
  end if;
  delete from board_columns
   where work_id = 'bbbbbbbb-0000-0000-0000-000000000002' and name = 'Papers';

  -- Se deja la tarea como estaba, que lo que viene detras la lee.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update tasks set board_column_id = null, order_index = 0, status = 'EN_CURSO'
   where id = 'dddddddd-0000-0000-0000-000000000001';
  reset role;
  raise notice 'CORRECTO [171]';
end $$;
