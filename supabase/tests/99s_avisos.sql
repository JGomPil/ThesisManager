-- =============================================================================
-- Los avisos llegan al movil y al ordenador (migracion 0032)
--
-- QUE SE JUEGA AQUI. Tres cosas, y ninguna da error cuando se rompe:
--
--  1. LA LISTA DE DISPOSITIVOS ES PRIVADA. Dice donde esta cada persona y con
--     que trabaja, y quien pudiera escribir en ella haria sonar el movil de
--     otro con el texto que quisiera. Lo fija la [190].
--
--  2. EL CARTERO NO ES NADIE SIN SU TOKEN. Las cuatro puertas de `public` estan
--     abiertas al rol `anon`, o sea a cualquiera con la clave publica de la
--     aplicacion, y por dentro son `security definer`: si la comprobacion del
--     token se cayera, se leeria el buzon entero del grupo sin que nada fallara.
--     Lo fija la [191].
--
--  3. LOS RECORDATORIOS NO SE REPITEN. El cartero pasa cada hora y la funcion
--     de fechas se ejecuta entera cada vez. Sin la `dedupe_key`, una tarea que
--     vence el viernes avisaria 24 veces el jueves, y eso no se descubre en una
--     prueba manual: se descubre cuando alguien apaga los avisos para siempre.
--     Lo fija la [193].
--
--   1111... administracion de la organizacion
--   2222... dirige TFG-01 y es ESTUDIANTE (y codirector) de TESIS-02 -> DOS filas
--   3333... estudiante de TFG-01
--   4444... ajeno a todo
--   bbbb...0001 = TFG-01   ·   bbbb...0002 = TESIS-02
-- =============================================================================

\echo '================ AVISOS AL MOVIL Y AL ORDENADOR ================'

\echo '[190] La lista de dispositivos es de cada uno: ni se ve, ni se escribe, ni se borra la de otro'
do $$
declare
  v_ajena   boolean := false;
  v_vistas  int;
  v_borradas int;
begin
  -- Cada uno da permiso en su aparato.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent)
  values ('33333333-3333-3333-3333-333333333333',
          'https://push.test.invalid/estudiante','clave-publica-3333','auth-3333','Movil');

  -- Y no en el de otro: esto es suplantacion, y la politica de INSERT lo para.
  begin
    insert into push_subscriptions (user_id, endpoint, p256dh, auth_key)
    values ('22222222-2222-2222-2222-222222222222',
            'https://push.test.invalid/colado','clave','auth');
    v_ajena := true;
  exception when insufficient_privilege or others then
    null;
  end;
  reset role;

  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent)
  values ('22222222-2222-2222-2222-222222222222',
          'https://push.test.invalid/director','clave-publica-2222','auth-2222','Portatil');

  -- Lo que ve el director: lo suyo y nada mas.
  select count(*) into v_vistas from push_subscriptions;
  -- Y lo que puede borrar de otro: nada. Un DELETE que RLS filtra no da error,
  -- asi que se cuenta lo que ha borrado, no si ha fallado.
  delete from push_subscriptions where endpoint = 'https://push.test.invalid/estudiante';
  get diagnostics v_borradas = row_count;
  reset role;

  if v_ajena then
    raise exception 'FALLO [190]: se ha podido registrar un dispositivo a nombre de otra persona';
  end if;
  if v_vistas <> 1 then
    raise exception 'FALLO [190]: el director ve % dispositivos y solo deberia ver el suyo', v_vistas;
  end if;
  if v_borradas <> 0 then
    raise exception 'FALLO [190]: se ha borrado el dispositivo de otra persona';
  end if;
  if not exists (select 1 from push_subscriptions
                  where endpoint = 'https://push.test.invalid/estudiante') then
    raise exception 'FALLO [190]: el dispositivo del estudiante ha desaparecido';
  end if;

  raise notice 'CORRECTO [190]: cada uno ve, registra y borra solo sus dispositivos';
end $$;

\echo '[191] Sin el token no se reparte nada, y con el token el reparto ve lo justo'
do $$
declare
  v_token  text;
  v_sin    boolean := false;
  v_filas  int;
  v_sesion boolean := false;
begin
  -- El token se genera una vez y solo se guarda su huella.
  select app.nuevo_token_del_cartero() into v_token;
  if v_token is null or length(v_token) < 32 then
    raise exception 'FALLO [191]: el token generado no sirve';
  end if;
  if exists (select 1 from app.secretos where nombre = 'cartero' and hash = v_token) then
    raise exception 'FALLO [191]: el token se ha guardado EN CLARO';
  end if;

  -- Un aviso pendiente, para que haya algo que repartir.
  insert into notifications (user_id, work_id, type, title, body, link)
  values ('33333333-3333-3333-3333-333333333333','bbbbbbbb-0000-0000-0000-000000000001',
          'TEST','Hay algo que leer','cuerpo','/trabajos/x');

  -- El cartero llama con la clave anon, igual que el keepalive.
  set local role anon;
  begin
    perform * from public.avisos_por_enviar(
      repeat('0', 64)   -- un token de la longitud correcta, pero falso
    );
    v_sin := true;
  exception when insufficient_privilege then
    null;
  end;

  select count(*) into v_filas from public.avisos_por_enviar(v_token);
  reset role;

  -- Una sesion normal no tiene nada que hacer aqui.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  begin
    perform * from public.avisos_por_enviar(v_token);
    v_sesion := true;
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  if v_sin then
    raise exception 'FALLO [191]: se ha repartido SIN TOKEN: el buzon del grupo esta abierto';
  end if;
  if v_filas < 1 then
    raise exception 'FALLO [191]: con el token correcto no se ve nada que repartir';
  end if;
  if v_sesion then
    raise exception 'FALLO [191]: una sesion normal puede leer los avisos de todos';
  end if;

  raise notice 'CORRECTO [191]: la puerta del cartero tiene cerradura, y solo la suya';
end $$;

\echo '[192] Un comentario avisa a quien tiene algo que ver, y nunca dos veces por lo mismo'
do $$
declare
  v_tarea uuid := 'dddddddd-0000-0000-0000-000000000290';
  v_resp  int;
  v_autor int;
  v_dobles int;
begin
  insert into tasks (id, work_id, title, assignee_id)
  values (v_tarea,'bbbbbbbb-0000-0000-0000-000000000001','Tarea con conversacion',
          '33333333-3333-3333-3333-333333333333');

  -- El director comenta en la tarjeta del estudiante, sin mencionarlo.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into comments (work_id, entity_type, entity_id, author_id, content)
  values ('bbbbbbbb-0000-0000-0000-000000000001','TASK', v_tarea,
          '22222222-2222-2222-2222-222222222222','Revisa el apartado de metodos');
  reset role;

  -- Se cuenta SOLO este comentario. Contar todos los COMMENT_REPLY de una
  -- persona seria contar tambien los que han generado las pruebas anteriores de
  -- la tanda, que insertan comentarios para lo suyo: el disparador es nuevo y
  -- se dispara con todos ellos. Esa version de la prueba fallaba sin que nada
  -- estuviera mal.
  select count(*) into v_resp from notifications
   where user_id = '33333333-3333-3333-3333-333333333333'
     and type = 'COMMENT_REPLY' and body like '%apartado de metodos%';
  if v_resp <> 1 then
    raise exception 'FALLO [192]: al responsable de la tarea le avisan % veces y deberia ser una', v_resp;
  end if;

  -- Y el autor no se avisa a si mismo.
  select count(*) into v_autor from notifications
   where user_id = '22222222-2222-2222-2222-222222222222'
     and type = 'COMMENT_REPLY' and body like '%apartado de metodos%';
  if v_autor <> 0 then
    raise exception 'FALLO [192]: el autor del comentario recibe aviso de su propio comentario';
  end if;

  -- Ahora CON mencion: la mencion ya avisa, el hilo no debe avisar otra vez.
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into comments (work_id, entity_type, entity_id, author_id, content, mentions)
  values ('bbbbbbbb-0000-0000-0000-000000000001','TASK', v_tarea,
          '22222222-2222-2222-2222-222222222222','@estudiante mira esto',
          array['33333333-3333-3333-3333-333333333333']::uuid[]);
  reset role;

  select count(*) into v_dobles from notifications
   where user_id = '33333333-3333-3333-3333-333333333333'
     and type = 'COMMENT_REPLY'
     and body like '%mira esto%';
  if v_dobles <> 0 then
    raise exception 'FALLO [192]: el mencionado recibe el mismo comentario dos veces';
  end if;
  if not exists (select 1 from notifications
                  where user_id = '33333333-3333-3333-3333-333333333333' and type = 'MENTION') then
    raise exception 'FALLO [192]: la mencion ha dejado de avisar';
  end if;

  -- Y a quien no participa en el trabajo, nada.
  if exists (select 1 from notifications
              where user_id = '44444444-4444-4444-4444-444444444444'
                and type = 'COMMENT_REPLY' and body like '%apartado de metodos%') then
    raise exception 'FALLO [192]: avisa a alguien que no participa en el trabajo';
  end if;

  raise notice 'CORRECTO [192]: avisa al responsable y a quien ya escribia, una sola vez';
end $$;

\echo '[193] Las fechas avisan una vez y solo de lo que corre: ni completadas, ni trabajos cerrados'
do $$
declare
  v_vence  uuid := 'dddddddd-0000-0000-0000-000000000291';
  v_hecha  uuid := 'dddddddd-0000-0000-0000-000000000292';
  v_cerrada uuid := 'dddddddd-0000-0000-0000-000000000293';
  v_tarde  uuid := 'dddddddd-0000-0000-0000-000000000294';
  v_vieja  uuid := 'dddddddd-0000-0000-0000-000000000295';
  v_hito   uuid;
  v_antes  int;
  v_primera int;
  v_segunda int;
  v_hitos  int;
begin
  insert into tasks (id, work_id, title, assignee_id, due_date, status) values
    (v_vence,'bbbbbbbb-0000-0000-0000-000000000001','Vence manana',
     '33333333-3333-3333-3333-333333333333', current_date + 1, 'EN_CURSO'),
    (v_hecha,'bbbbbbbb-0000-0000-0000-000000000001','Vence manana pero esta hecha',
     '33333333-3333-3333-3333-333333333333', current_date + 1, 'COMPLETADA'),
    (v_tarde,'bbbbbbbb-0000-0000-0000-000000000001','Se paso hace cinco dias',
     '33333333-3333-3333-3333-333333333333', current_date - 5, 'EN_CURSO'),
    (v_vieja,'bbbbbbbb-0000-0000-0000-000000000001','Se paso hace medio ano',
     '33333333-3333-3333-3333-333333333333', current_date - 200, 'EN_CURSO');

  -- Una tarea que vence en un trabajo YA TERMINADO: un trabajo cerrado no
  -- tiene fechas que corran, y seguir dando la lata con ellas es la forma mas
  -- segura de que se dejen de mirar los avisos.
  insert into academic_works (id, organization_id, work_type_id, status_id, title, is_archived)
  select 'bbbbbbbb-0000-0000-0000-000000000193','aaaaaaaa-0000-0000-0000-000000000001',
         (select id from work_types where code='TFG'),
         (select id from work_statuses where code='EN_DESARROLLO'), 'TFG-CERRADO', true;
  insert into tasks (id, work_id, title, assignee_id, due_date, status)
  values (v_cerrada,'bbbbbbbb-0000-0000-0000-000000000193','Vence manana en un trabajo cerrado',
          '33333333-3333-3333-3333-333333333333', current_date + 1, 'EN_CURSO');

  -- Un hito del trabajo donde 2222 figura DOS VECES (estudiante y codirector).
  insert into milestones (work_id, name, due_date)
  values ('bbbbbbbb-0000-0000-0000-000000000002','Deposito de la tesis', current_date + 2)
  returning id into v_hito;

  select count(*) into v_antes from notifications where dedupe_key is not null;

  perform app.encolar_avisos_de_fechas();
  select count(*) into v_primera from notifications where dedupe_key is not null;

  -- Y otra vez, que es lo que de verdad hace el cartero cada hora.
  perform app.encolar_avisos_de_fechas();
  select count(*) into v_segunda from notifications where dedupe_key is not null;

  if v_primera = v_antes then
    raise exception 'FALLO [193]: no se ha creado ningun aviso de fecha';
  end if;
  if v_segunda <> v_primera then
    raise exception 'FALLO [193]: los recordatorios SE REPITEN (% y luego %)', v_primera, v_segunda;
  end if;

  if not exists (select 1 from notifications
                  where dedupe_key = 'TASK_DUE:' || v_vence || ':' || (current_date + 1)
                                     || ':33333333-3333-3333-3333-333333333333') then
    raise exception 'FALLO [193]: la tarea que vence manana no avisa';
  end if;
  if exists (select 1 from notifications where dedupe_key like 'TASK_DUE:' || v_hecha || '%') then
    raise exception 'FALLO [193]: avisa de una tarea ya completada';
  end if;
  if exists (select 1 from notifications where dedupe_key like 'TASK%' || v_cerrada || '%') then
    raise exception 'FALLO [193]: avisa de una tarea de un trabajo terminado';
  end if;
  if not exists (select 1 from notifications where dedupe_key like 'TASK_LATE:' || v_tarde || '%') then
    raise exception 'FALLO [193]: una tarea pasada de fecha no avisa';
  end if;
  if exists (select 1 from notifications where dedupe_key like 'TASK_LATE:' || v_vieja || '%') then
    raise exception 'FALLO [193]: resucita tareas pasadas de hace medio ano';
  end if;

  -- UNA sola vez, aunque sean dos filas de `work_members`.
  select count(*) into v_hitos from notifications
   where type = 'MILESTONE_DUE'
     and user_id = '22222222-2222-2222-2222-222222222222'
     and dedupe_key like 'MILESTONE_DUE:' || v_hito || '%';
  if v_hitos <> 1 then
    raise exception 'FALLO [193]: el hito avisa % veces a quien tiene dos funciones en el trabajo', v_hitos;
  end if;

  raise notice 'CORRECTO [193]: un aviso por fecha, sin repetir, y solo de lo que esta en marcha';
end $$;

\echo '[194] Quien apaga una casilla deja de recibir ese aviso, y nadie se la toca'
do $$
declare
  v_nueva uuid := 'dddddddd-0000-0000-0000-000000000296';
  v_ajena boolean := false;
  v_avisos int;
begin
  -- El estudiante apaga los avisos de fechas.
  set local role authenticated;
  perform set_config('test.uid','33333333-3333-3333-3333-333333333333', true);
  insert into notification_prefs (user_id, on_dates, on_comments)
  values ('33333333-3333-3333-3333-333333333333', false, false);

  -- Y no puede apagarselos a otro.
  begin
    insert into notification_prefs (user_id, on_dates)
    values ('22222222-2222-2222-2222-222222222222', false);
    v_ajena := true;
  exception when insufficient_privilege or others then
    null;
  end;
  reset role;

  if v_ajena then
    raise exception 'FALLO [194]: se han podido apagar los avisos de otra persona';
  end if;

  insert into tasks (id, work_id, title, assignee_id, due_date, status)
  values (v_nueva,'bbbbbbbb-0000-0000-0000-000000000001','Vence manana, pero no quiere avisos',
          '33333333-3333-3333-3333-333333333333', current_date + 1, 'EN_CURSO');
  perform app.encolar_avisos_de_fechas();

  if exists (select 1 from notifications where dedupe_key like 'TASK_DUE:' || v_nueva || '%') then
    raise exception 'FALLO [194]: sigue avisando de fechas a quien lo ha apagado';
  end if;

  -- Y tampoco de los hilos.
  select count(*) into v_avisos from notifications
   where user_id = '33333333-3333-3333-3333-333333333333' and type = 'COMMENT_REPLY';
  set local role authenticated;
  perform set_config('test.uid','22222222-2222-2222-2222-222222222222', true);
  insert into comments (work_id, entity_type, entity_id, author_id, content)
  values ('bbbbbbbb-0000-0000-0000-000000000001','TASK',
          'dddddddd-0000-0000-0000-000000000290','22222222-2222-2222-2222-222222222222',
          'Otro comentario mas');
  reset role;

  if (select count(*) from notifications
       where user_id = '33333333-3333-3333-3333-333333333333' and type = 'COMMENT_REPLY') <> v_avisos then
    raise exception 'FALLO [194]: sigue avisando de comentarios a quien lo ha apagado';
  end if;

  raise notice 'CORRECTO [194]: las casillas apagan de verdad, y son de quien son';
end $$;

\echo '[195] Lo entregado no se vuelve a mandar, y un dispositivo que ya no existe se borra'
do $$
declare
  v_token text;
  v_aviso uuid;
  v_primera int;
  v_segunda int;
  v_muertas int;
  v_queda  int;
  v_sello  timestamptz;
begin
  select app.nuevo_token_del_cartero() into v_token;

  insert into notifications (user_id, work_id, type, title, body, link)
  values ('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-000000000001',
          'TEST','Para marcar','cuerpo','/trabajos/x')
  returning id into v_aviso;

  set local role anon;
  select public.avisos_entregados(v_token, array[v_aviso],
                                  array['https://push.test.invalid/director']) into v_primera;
  select public.avisos_entregados(v_token, array[v_aviso],
                                  array['https://push.test.invalid/director']) into v_segunda;
  reset role;
  select last_ok_at into v_sello from push_subscriptions
   where endpoint = 'https://push.test.invalid/director';
  set local role anon;
  select public.suscripcion_muerta(v_token, 'https://push.test.invalid/director') into v_muertas;
  reset role;

  -- El sello se lee FUERA del `set local role anon`, y no por gusto: leer
  -- `push_subscriptions` dispara su politica, que llama a `app.uid()`, y anon no
  -- puede ejecutarla. Dentro del bloque fallaba con «permission denied for
  -- function uid», que es justamente la prueba de que el cartero NO lee esa
  -- tabla por su cuenta: solo la toca a traves de las funciones con token.

  if v_primera <> 1 then
    raise exception 'FALLO [195]: marcar un aviso como entregado ha afectado a % filas', v_primera;
  end if;
  if v_segunda <> 0 then
    raise exception 'FALLO [195]: un aviso ya entregado se vuelve a mandar';
  end if;
  if (select pushed_at from notifications where id = v_aviso) is null then
    raise exception 'FALLO [195]: el aviso entregado sigue sin marca';
  end if;
  if v_sello is null then
    raise exception 'FALLO [195]: el dispositivo no queda sellado, y en pantalla no se podra distinguir configurado de funcionando';
  end if;
  if v_muertas <> 1 then
    raise exception 'FALLO [195]: no se ha borrado la suscripcion muerta';
  end if;
  select count(*) into v_queda from push_subscriptions
   where endpoint = 'https://push.test.invalid/director';
  if v_queda <> 0 then
    raise exception 'FALLO [195]: la suscripcion muerta sigue ahi y se reintentara para siempre';
  end if;

  -- El buzon sigue siendo cosa de disparadores: nadie escribe avisos a mano.
  if exists (select 1 from pg_policies where tablename = 'notifications' and cmd = 'INSERT') then
    raise exception 'FALLO [195]: notifications tiene politica de INSERT';
  end if;

  raise notice 'CORRECTO [195]: se marca lo entregado y se olvida lo que ya no existe';
end $$;
