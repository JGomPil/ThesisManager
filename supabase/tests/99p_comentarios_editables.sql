-- =============================================================================
-- Un comentario lo edita su autor, y solo en su texto (migracion 0029)
--
-- QUE SE JUEGA AQUI
-- Que pueda editar es viejo: `comments_update` exige `author_id = app.uid()`
-- desde la 0003. Lo que la 0029 añade son las dos cosas que una politica de
-- RLS no puede dar, porque decide QUE FILAS y no QUE COLUMNAS, y las dos
-- fallan EN SILENCIO si el disparador no esta:
--
--   1. La marca de «editado». `updated_at` existia desde la 0002 y nadie la
--      tocaba. Una fecha de edicion que dependa de que el cliente se acuerde de
--      mandarla no sirve para nada: quien hable con la API directamente edita
--      sin dejar rastro, y la pantalla seguira diciendo que el comentario es el
--      original.
--   2. Que el comentario no se mude. El `using` de `comments_update` solo mira
--      el autor, no la pertenencia al trabajo, asi que sin el disparador el
--      autor podia cambiar el `work_id` y plantar su comentario en el hilo de
--      un trabajo del que no es miembro. El no lo veria —`comments_select` si
--      comprueba el acceso—, pero los miembros de ese trabajo verian aparecer
--      el comentario de un desconocido.
--
-- CADA BLOQUE ES UNA TRANSACCION APARTE, y no es casualidad: `now()` devuelve
-- la hora de INICIO de la transaccion, asi que insertar y editar dentro del
-- mismo `do $$` daria el mismo `updated_at` y la prueba del rastro no probaria
-- nada. Es el tipo de prueba que pasa sola por el motivo equivocado.
--
--   3333... estudiante de TESIS-01, autor del comentario
--   2222... direccion de TESIS-01: lo ve, no lo edita
--   bbbb...0002 = TESIS-02, donde 3333 no es miembro
-- =============================================================================

\echo '================ COMENTARIOS EDITABLES ================'

-- El comentario de partida, escrito por su autor y pasando por RLS.
do $$
begin
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into comments (id, work_id, entity_type, entity_id, author_id, content)
  values ('ccccdddd-0000-0000-0000-000000000179',
          'bbbbbbbb-0000-0000-0000-000000000001', 'WORK',
          'bbbbbbbb-0000-0000-0000-000000000001',
          '33333333-3333-3333-3333-333333333333',
          'Lo que quise decir')
  on conflict (id) do nothing;
  reset role;
end $$;

\echo '[179] El autor edita lo suyo y queda rastro; otro miembro del trabajo, no'
do $$
declare v_texto text; v_creado timestamptz; v_editado timestamptz; v_filas int;
begin
  -- El autor cambia el texto.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  update comments set content = 'Lo que quise decir, mejor dicho'
   where id = 'ccccdddd-0000-0000-0000-000000000179';
  reset role;

  select content, created_at, updated_at into v_texto, v_creado, v_editado
    from comments where id = 'ccccdddd-0000-0000-0000-000000000179';

  if v_texto is distinct from 'Lo que quise decir, mejor dicho' then
    raise exception 'FALLO [179]: el autor no ha podido editar su comentario (%)',
      coalesce(v_texto, 'NULO');
  end if;
  if v_editado <= v_creado then
    raise exception 'FALLO [179]: editar no ha movido updated_at: la marca de «editado» seria mentira';
  end if;

  -- Y la direccion del trabajo, que lo ve, no lo reescribe. Se cuentan FILAS
  -- AFECTADAS: RLS no da error al actualizar, simplemente no encuentra la fila,
  -- asi que una prueba que solo mirase que no hay excepcion pasaria siempre.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  update comments set content = 'Esto lo digo yo por ti'
   where id = 'ccccdddd-0000-0000-0000-000000000179';
  get diagnostics v_filas = row_count;
  reset role;

  if v_filas <> 0 then
    raise exception 'FALLO DE SEGURIDAD [179]: la direccion ha reescrito el comentario de otro';
  end if;

  select content into v_texto from comments where id = 'ccccdddd-0000-0000-0000-000000000179';
  if v_texto is distinct from 'Lo que quise decir, mejor dicho' then
    raise exception 'FALLO DE SEGURIDAD [179]: el texto ha cambiado (%)', v_texto;
  end if;
  raise notice 'CORRECTO [179]';
end $$;
reset role;

\echo '[180] Un comentario no se muda al hilo de otro trabajo ni cambia de autor'
do $$
declare v_trabajo uuid;
begin
  -- Mudarse de trabajo: lo para el disparador, no la politica.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update comments set work_id = 'bbbbbbbb-0000-0000-0000-000000000002',
                        entity_id = 'bbbbbbbb-0000-0000-0000-000000000002'
     where id = 'ccccdddd-0000-0000-0000-000000000179';
    reset role;
    raise exception 'FALLO DE SEGURIDAD [180]: un comentario se ha mudado al hilo de otro trabajo';
  exception
    when insufficient_privilege then
      raise notice '  · no se muda de trabajo';
  end;
  reset role;

  select work_id into v_trabajo from comments
   where id = 'ccccdddd-0000-0000-0000-000000000179';
  if v_trabajo is distinct from 'bbbbbbbb-0000-0000-0000-000000000001' then
    raise exception 'FALLO DE SEGURIDAD [180]: el comentario ha cambiado de trabajo (%)', v_trabajo;
  end if;

  -- Y cambiar de autor tampoco: aqui son dos cosas a la vez —el `with check` de
  -- la politica y el disparador—, y basta con que lo pare cualquiera de ellas.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  begin
    update comments set author_id = '22222222-2222-2222-2222-222222222222'
     where id = 'ccccdddd-0000-0000-0000-000000000179';
    reset role;
    raise exception 'FALLO DE SEGURIDAD [180]: un comentario ha cambiado de autor';
  exception
    when insufficient_privilege then
      raise notice '  · no cambia de autor';
  end;
  reset role;

  raise notice 'CORRECTO [180]';
end $$;
reset role;
