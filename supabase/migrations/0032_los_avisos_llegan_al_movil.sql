-- =============================================================================
-- 0032 · Los avisos llegan al movil y al ordenador
--
-- EL CASO REAL: la campana de la aplicacion funciona desde la 0011, pero solo
-- la ve quien entra. Lo que de verdad se olvida -una fecha que vence, una
-- respuesta en un hilo- se olvida justamente porque nadie entra a mirarlo. Un
-- aviso que exige acordarse de ir a verlo no es un aviso.
--
-- ESTO NO ES UN SISTEMA DE AVISOS NUEVO, y es la decision de fondo. La
-- `notifications` de la 0011 sigue siendo el unico buzon y la unica verdad; lo
-- que se anade es el REPARTO a los dispositivos y DOS TIPOS DE AVISO que no
-- existian. Si manana se quita el reparto, no se pierde ningun aviso: siguen
-- todos en la campana. Un segundo buzon para el movil habria creado dos
-- versiones de lo mismo que se desincronizan a la primera.
--
-- LOS DOS AVISOS NUEVOS (decision de la direccion, 10-11-2026: «las dos cosas»)
--
--   FECHAS   Una tarea tuya que vence dentro de pocos dias, una que se te paso
--            y un hito del trabajo que se acerca. No lo puede hacer un
--            disparador: no ocurre nada en la base de datos el dia que una
--            fecha se acerca. Hace falta que alguien PREGUNTE cada dia, y de
--            eso se encarga `app.encolar_avisos_de_fechas()`.
--   HILOS    Alguien ha comentado en algo tuyo o en una conversacion en la que
--            ya habias escrito. Hasta ahora solo avisaba la MENCION explicita
--            (`@alguien`), asi que responder a alguien sin acordarse de
--            mencionarlo era hablarle a una pared.
--
-- POR QUE ESTOS DOS LLEVAN PREFERENCIA Y LOS DE LA 0011 NO. Los de la 0011 son
-- HECHOS que le pasan a una persona: te han asignado una tarea, te han
-- convocado a una reunion, te han mencionado. Eso no es ruido, es trabajo que
-- te acaba de caer. Los dos de aqui son RECORDATORIOS y CONVERSACION: pueden
-- sonar mucho, y a quien le sobren tiene que poder apagarlos. La preferencia
-- decide si el aviso EXISTE, no solo si suena: un recordatorio que has dicho
-- que no quieres tampoco pinta nada en la campana.
--
-- EL REPARTO, Y EL PROBLEMA DE QUIEN LO HACE
--
-- Mandar un «push» exige firmar con una clave privada (VAPID) y cifrar el
-- contenido para cada dispositivo. Eso no se puede hacer desde el navegador
-- -la clave privada estaria en el bundle, que es publico- ni desde un
-- disparador de PostgreSQL, que no sabe firmar ECDSA. Lo hace un workflow de
-- GitHub Actions cada hora, como el `keepalive.yml` de Supabase Free.
--
-- Y AHI ESTA LA DECISION DELICADA: ese workflow necesita leer avisos de OTRAS
-- personas para repartirlos. Con la clave `service_role` seria trivial, y es
-- exactamente lo que este proyecto tiene prohibido desde el primer dia
-- (keepalive.yml: «usa EXCLUSIVAMENTE la clave anon. Nunca service_role»), y
-- con razon: esa clave se salta RLS entera, o sea que una fuga no se queda en
-- los avisos, se lleva el expediente academico de todo el mundo.
--
-- Asi que el cartero NO tiene llave maestra: tiene UN TOKEN que solo abre tres
-- puertas muy estrechas -coger lo pendiente de enviar, marcar lo entregado, y
-- borrar la suscripcion de un dispositivo que ya no existe-. Del token se
-- guarda solo el `sha256`, como una contrasena: ni yo ni esta migracion lo
-- conocen. Se genera una vez con
--
--      select app.nuevo_token_del_cartero();
--
-- y lo que devuelve se copia a los secretos de GitHub. Si se filtrara, lo peor
-- que se puede hacer con el es leer el texto de los avisos pendientes de las
-- ultimas 72 horas; se revoca volviendo a ejecutar esa misma linea.
--
-- Las tres puertas viven en `public` y estan abiertas al rol `anon`, porque el
-- cartero llama con la clave anon igual que el keepalive. Quien tenga la clave
-- anon -que es publica, va en el bundle- y no tenga el token recibe un error y
-- nada mas. El token son 244 bits aleatorios: no se adivina.
--
-- LO QUE NO HACE, A PROPOSITO
--   · No manda correos. Decidido (direccion, 10-11-2026): «por ahora no quiero
--     correos».
--   · No avisa de notas privadas de direccion. Ya lo decia la 0011: avisar de
--     algo privado es filtrarlo, porque el aviso revela que existe.
--   · No avisa de trabajos terminados ni de los de la papelera: un trabajo
--     cerrado no tiene fechas que corran.
--   · No repite. Cada recordatorio lleva una `dedupe_key` y se inserta una sola
--     vez, aunque el cartero pase cada hora. Sin eso, una tarea que vence el
--     viernes avisaria 24 veces el jueves.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Dos columnas en el buzon que ya existe
--
-- `dedupe_key` es lo que convierte «avisa de las fechas» en algo que se puede
-- ejecutar cada hora sin consecuencias. El indice es PARCIAL porque los avisos
-- de la 0011 no llevan clave: un hecho ocurre una vez y no necesita idempotencia.
--
-- `pushed_at` es del cartero, no de la pantalla: distingue «esta en la campana»
-- de «ha sonado en el movil», que son dos cosas distintas y se confunden solas.
-- -----------------------------------------------------------------------------
alter table notifications add column if not exists dedupe_key text;
alter table notifications add column if not exists pushed_at  timestamptz;

create unique index if not exists notifications_dedupe_uidx
  on notifications (dedupe_key) where dedupe_key is not null;

-- Lo que el cartero busca: pendiente de enviar, reciente y sin leer.
create index if not exists notifications_por_enviar_idx
  on notifications (created_at) where pushed_at is null and read_at is null;

-- -----------------------------------------------------------------------------
-- 2. `push_subscriptions` — un dispositivo que ha dicho que si
--
-- UNA FILA POR DISPOSITIVO, no por persona: el movil y el portatil son dos
-- permisos distintos, dados en dos sitios distintos, y se revocan por separado
-- (desinstalar la aplicacion del movil no debe callar el ordenador).
--
-- El `endpoint` es la URL que da el navegador y es unica por dispositivo e
-- instalacion; es la clave natural y por eso lleva `unique`: reinstalar o dar
-- permiso otra vez actualiza la fila en vez de duplicarla.
--
-- `p256dh` y `auth_key` son las claves PUBLICAS del dispositivo, con las que se
-- cifra cada mensaje. No son secretos: sin ellas no se puede mandar nada, y con
-- ellas solo se puede mandar a ese dispositivo.
-- -----------------------------------------------------------------------------
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth_key    text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  -- Cuando llego el ultimo aviso a ESTE aparato. Se ensena en la pantalla de
  -- avisos, y es lo unico que distingue «configurado» de «funcionando»: dar
  -- permiso no garantiza que el reparto llegue, y sin esta fecha la unica forma
  -- de saberlo seria esperar a que pasara algo.
  last_ok_at  timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

-- Cada uno, lo suyo y nada mas. No hay excepcion para la administracion de la
-- organizacion, y es deliberado: la lista de dispositivos de una persona dice
-- donde esta y con que trabaja, no hace falta para gestionar nada academico, y
-- un administrador que pudiera escribir en ella podria hacer sonar el movil de
-- otro con el texto que quisiera.
drop policy if exists pushsubs_select on push_subscriptions;
create policy pushsubs_select on push_subscriptions
  for select using (user_id = app.uid());

drop policy if exists pushsubs_insert on push_subscriptions;
create policy pushsubs_insert on push_subscriptions
  for insert with check (user_id = app.uid());

drop policy if exists pushsubs_update on push_subscriptions;
create policy pushsubs_update on push_subscriptions
  for update using (user_id = app.uid()) with check (user_id = app.uid());

drop policy if exists pushsubs_delete on push_subscriptions;
create policy pushsubs_delete on push_subscriptions
  for delete using (user_id = app.uid());

-- -----------------------------------------------------------------------------
-- 3. `notification_prefs` — las dos casillas
--
-- Una fila por persona, que se crea sola la primera vez que se toca una
-- casilla. MIENTRAS NO EXISTA, TODO ESTA ENCENDIDO: la ausencia de fila
-- significa «no he dicho nada», y lo razonable por omision es avisar. Si
-- significara «no quiero», habria que crearle la fila a todo el mundo en esta
-- migracion y a cada usuario nuevo en un disparador, y el dia que uno de esos
-- dos fallara alguien se quedaria sin avisos sin que nada diera error.
--
-- `days_before` es por persona porque el tiempo de reaccion lo es: tres dias le
-- sobran a quien revisa el plan a diario y no le llegan a quien lo mira los
-- lunes.
-- -----------------------------------------------------------------------------
create table if not exists notification_prefs (
  user_id      uuid primary key references profiles(id) on delete cascade,
  on_dates     boolean not null default true,
  on_comments  boolean not null default true,
  days_before  int not null default 3 check (days_before between 1 and 30),
  updated_at   timestamptz not null default now()
);

drop trigger if exists notification_prefs_updated_at on notification_prefs;
create trigger notification_prefs_updated_at
  before update on notification_prefs
  for each row execute function app.set_updated_at();

alter table notification_prefs enable row level security;

drop policy if exists notifprefs_select on notification_prefs;
create policy notifprefs_select on notification_prefs
  for select using (user_id = app.uid());

drop policy if exists notifprefs_insert on notification_prefs;
create policy notifprefs_insert on notification_prefs
  for insert with check (user_id = app.uid());

drop policy if exists notifprefs_update on notification_prefs;
create policy notifprefs_update on notification_prefs
  for update using (user_id = app.uid()) with check (user_id = app.uid());

-- -----------------------------------------------------------------------------
-- 4. Aviso nuevo: alguien ha comentado en un hilo que es tuyo
--
-- A QUIEN SE AVISA, que es toda la sustancia de este disparador:
--   · al RESPONSABLE de la tarea comentada, aunque no haya escrito nunca en el
--     hilo: es su tarjeta;
--   · a quien YA HABIA ESCRITO en esa misma conversacion, porque dijo algo y
--     alguien le esta contestando.
--
-- Y A QUIEN NO:
--   · al autor, que ya sabe lo que acaba de escribir (lo filtra tambien
--     `app.notify`, pero mejor no llegar hasta alli);
--   · a los MENCIONADOS, porque `comments_notify_mentions` ya les avisa y si no
--     recibirian el mismo comentario dos veces;
--   · a quien ya no participa en el trabajo (`status <> 'ACTIVE'`): un
--     comentario no es motivo para reaparecer en la vida de alguien que se fue;
--   · al resto de la direccion que no ha intervenido en el hilo. Esto es una
--     decision, no un olvido: avisar a todo el equipo de cada comentario es la
--     forma mas rapida de que nadie mire los avisos.
-- -----------------------------------------------------------------------------
create or replace function app.notify_comment_reply()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_quien text;
  v_dest  uuid;
begin
  if new.deleted_at is not null then return new; end if;

  select p.full_name into v_quien from profiles p where p.id = new.author_id;

  for v_dest in
    select distinct u.user_id
      from (
        -- El responsable de la tarea comentada.
        select t.assignee_id as user_id
          from tasks t
         where new.entity_type = 'TASK'
           and t.id = new.entity_id
           and t.deleted_at is null
        union
        -- Quien ya habia escrito en el mismo hilo.
        select c.author_id
          from comments c
         where c.work_id = new.work_id
           and c.entity_type = new.entity_type
           and c.entity_id is not distinct from new.entity_id
           and c.id <> new.id
           and c.deleted_at is null
      ) u
     where u.user_id is not null
       and u.user_id <> new.author_id
       and not (u.user_id = any(new.mentions))
       and exists (
         select 1 from work_members m
          where m.work_id = new.work_id and m.user_id = u.user_id and m.status = 'ACTIVE'
       )
       and coalesce(
             (select pr.on_comments from notification_prefs pr where pr.user_id = u.user_id),
             true
           )
  loop
    perform app.notify(
      v_dest, new.work_id, 'COMMENT_REPLY',
      coalesce(v_quien, 'Alguien') || ' ha comentado',
      left(new.content, 140) || case when length(new.content) > 140 then '...' else '' end,
      '/trabajos/' || new.work_id
    );
  end loop;
  return new;
end;
$$;

-- Una funcion nueva en `app` nace con EXECUTE concedido al pseudo-rol PUBLIC
-- -ese es el comportamiento de PostgreSQL, y los privilegios por omision que
-- fija la 0007 no lo deshacen-, asi que hay que quitarselo a mano. Si no, el
-- rol `anon` puede ejecutarla, que es el invariante que vigila la 0015. Nadie
-- necesita llamarla: la llama su disparador, con los privilegios del dueno.
revoke all on function app.notify_comment_reply() from public;
revoke all on function app.notify_comment_reply() from anon;

-- `after insert` y solo insert, igual que el de las menciones: editar un
-- comentario no vuelve a avisar a nadie (0029).
drop trigger if exists comments_notify_reply on comments;
create trigger comments_notify_reply
  after insert on comments
  for each row execute function app.notify_comment_reply();

-- -----------------------------------------------------------------------------
-- 5. Aviso nuevo: las fechas que se acercan
--
-- Esta es la funcion que el cartero llama antes de repartir. Devuelve cuantos
-- avisos ha creado, que es lo unico que se registra en el log del workflow: un
-- numero, sin nombres ni contenido.
--
-- LAS TRES CONSULTAS Y SUS LIMITES:
--   · tarea que VENCE: dentro de los dias que haya pedido cada uno;
--   · tarea PASADA de fecha: solo las del ultimo mes. Sin ese limite, el primer
--     reparto resucitaria todas las tareas viejas sin cerrar del historico, que
--     es la peor presentacion posible de una funcion nueva;
--   · HITO que se acerca: a todas las personas activas del trabajo, porque un
--     hito es del trabajo y no de nadie en particular. `distinct` porque quien
--     tiene dos funciones academicas en el mismo trabajo tiene DOS FILAS en
--     `work_members`, y sin el se intentaria insertar dos veces la misma clave.
--
-- La `dedupe_key` lleva la FECHA dentro. No es un detalle: si una tarea se
-- mueve de fecha, el recordatorio vuelve a tener sentido y se manda otro; si no
-- se mueve, se manda uno y solo uno en toda su vida.
-- -----------------------------------------------------------------------------
create or replace function app.encolar_avisos_de_fechas()
returns int language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_total int := 0;
  v_n     int;
begin
  -- 5.1 Tareas que vencen ----------------------------------------------------
  insert into notifications (user_id, work_id, type, title, body, link, dedupe_key)
  select t.assignee_id, t.work_id, 'TASK_DUE',
         case when t.due_date = current_date then 'Una tarea vence hoy'
              when t.due_date = current_date + 1 then 'Una tarea vence manana'
              else 'Una tarea vence pronto' end,
         t.title || ' · ' || to_char(t.due_date, 'DD/MM/YYYY') || ' · ' || w.title,
         '/trabajos/' || t.work_id,
         'TASK_DUE:' || t.id || ':' || t.due_date || ':' || t.assignee_id
    from tasks t
    join academic_works w on w.id = t.work_id
    left join notification_prefs pr on pr.user_id = t.assignee_id
   where t.deleted_at is null
     and t.status <> 'COMPLETADA'
     and t.due_date is not null
     and t.assignee_id is not null
     and w.deleted_at is null
     and w.is_archived = false
     and coalesce(pr.on_dates, true)
     and t.due_date >= current_date
     and t.due_date <= current_date + coalesce(pr.days_before, 3)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- 5.2 Tareas pasadas de fecha ----------------------------------------------
  insert into notifications (user_id, work_id, type, title, body, link, dedupe_key)
  select t.assignee_id, t.work_id, 'TASK_LATE',
         'Una tarea se ha pasado de fecha',
         t.title || ' · vencia el ' || to_char(t.due_date, 'DD/MM/YYYY') || ' · ' || w.title,
         '/trabajos/' || t.work_id,
         'TASK_LATE:' || t.id || ':' || t.due_date || ':' || t.assignee_id
    from tasks t
    join academic_works w on w.id = t.work_id
    left join notification_prefs pr on pr.user_id = t.assignee_id
   where t.deleted_at is null
     and t.status <> 'COMPLETADA'
     and t.due_date is not null
     and t.assignee_id is not null
     and w.deleted_at is null
     and w.is_archived = false
     and coalesce(pr.on_dates, true)
     and t.due_date < current_date
     and t.due_date >= current_date - 30
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  -- 5.3 Hitos que se acercan -------------------------------------------------
  insert into notifications (user_id, work_id, type, title, body, link, dedupe_key)
  select distinct m.user_id, h.work_id, 'MILESTONE_DUE',
         case when h.due_date = current_date then 'Un hito es hoy'
              else 'Se acerca un hito' end,
         h.name || ' · ' || to_char(h.due_date, 'DD/MM/YYYY') || ' · ' || w.title,
         '/trabajos/' || h.work_id,
         'MILESTONE_DUE:' || h.id || ':' || h.due_date || ':' || m.user_id
    from milestones h
    join academic_works w on w.id = h.work_id
    join work_members m on m.work_id = h.work_id and m.status = 'ACTIVE'
    left join notification_prefs pr on pr.user_id = m.user_id
   where h.is_met = false
     and w.deleted_at is null
     and w.is_archived = false
     and coalesce(pr.on_dates, true)
     and h.due_date >= current_date
     and h.due_date <= current_date + coalesce(pr.days_before, 3)
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  return v_total;
end;
$$;

revoke all on function app.encolar_avisos_de_fechas() from public;
revoke all on function app.encolar_avisos_de_fechas() from anon;
revoke all on function app.encolar_avisos_de_fechas() from authenticated;

-- -----------------------------------------------------------------------------
-- 6. El cartero
--
-- `app.secretos` guarda el `sha256` del token, nunca el token. Vive en el
-- esquema `app`, que PostgREST no publica, y ademas con RLS y SIN NINGUNA
-- POLITICA: eso significa «nadie, nunca», ni el administrador de la
-- organizacion. Solo lo leen las funciones `security definer` de aqui abajo,
-- que corren como su propietario y por eso se saltan RLS.
--
-- Se usa `sha256()`, que es una funcion del nucleo de PostgreSQL, y no `digest`
-- de pgcrypto: en Supabase pgcrypto puede estar instalado en el esquema
-- `extensions`, fuera del `search_path` fijado en estas funciones, y entonces
-- `digest` no se encuentra y la migracion falla al ejecutarse.
-- -----------------------------------------------------------------------------
create table if not exists app.secretos (
  nombre      text primary key,
  hash        text not null,
  created_at  timestamptz not null default now()
);
alter table app.secretos enable row level security;
revoke all on table app.secretos from public;
revoke all on table app.secretos from anon;
revoke all on table app.secretos from authenticated;

-- Genera el token, guarda solo su huella y lo devuelve UNA VEZ. Se ejecuta a
-- mano desde el editor SQL del panel de Supabase, que corre como propietario:
-- no esta concedida a nadie mas, ni hace falta que lo este.
create or replace function app.nuevo_token_del_cartero()
returns text language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_token text;
begin
  -- 244 bits de aleatoriedad sin depender de pgcrypto: `gen_random_uuid` es del
  -- nucleo y cada uuid v4 aporta 122 bits.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into app.secretos (nombre, hash)
  values ('cartero', encode(sha256(convert_to(v_token, 'utf8')), 'hex'))
  on conflict (nombre) do update
    set hash = excluded.hash, created_at = now();

  return v_token;
end;
$$;

revoke all on function app.nuevo_token_del_cartero() from public;
revoke all on function app.nuevo_token_del_cartero() from anon;
revoke all on function app.nuevo_token_del_cartero() from authenticated;

create or replace function app.es_el_cartero(p_token text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from app.secretos s
     where s.nombre = 'cartero'
       and p_token is not null
       and length(p_token) >= 32
       and s.hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex')
  )
$$;

revoke all on function app.es_el_cartero(text) from public;
revoke all on function app.es_el_cartero(text) from anon;
revoke all on function app.es_el_cartero(text) from authenticated;

-- 6.1 Lo que queda por repartir ------------------------------------------------
--
-- Devuelve una fila POR AVISO Y DISPOSITIVO: un mismo aviso sale tantas veces
-- como aparatos tenga esa persona, y se marca entregado una sola vez por aviso.
--
-- `read_at is null` es la regla que evita el ruido mas tonto de todos: si lo
-- has leido ya en la campana, no hace falta que te suene el movil.
--
-- La ventana de 72 horas acota el dano de un token filtrado y evita que un fallo
-- de varios dias acabe soltando una avalancha de avisos viejos de golpe.
create or replace function app.avisos_por_enviar(p_token text, p_limite int default 100)
returns table (
  aviso_id  uuid,
  titulo    text,
  cuerpo    text,
  enlace    text,
  endpoint  text,
  p256dh    text,
  auth_key  text
) language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not app.es_el_cartero(p_token) then
    raise exception 'Token del cartero incorrecto' using errcode = 'insufficient_privilege';
  end if;

  return query
    select n.id, n.title, n.body, n.link, s.endpoint, s.p256dh, s.auth_key
      from notifications n
      join push_subscriptions s on s.user_id = n.user_id
     where n.pushed_at is null
       and n.read_at is null
       and n.created_at > now() - interval '72 hours'
     order by n.created_at
     limit greatest(1, least(coalesce(p_limite, 100), 500));
end;
$$;

-- 6.2 Marcar entregado ---------------------------------------------------------
create or replace function app.avisos_entregados(
  p_token text, p_ids uuid[], p_endpoints text[]
) returns int language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_n int;
begin
  if not app.es_el_cartero(p_token) then
    raise exception 'Token del cartero incorrecto' using errcode = 'insufficient_privilege';
  end if;

  update notifications
     set pushed_at = now()
   where id = any(coalesce(p_ids, '{}'::uuid[]))
     and pushed_at is null;
  get diagnostics v_n = row_count;

  -- Y se sella el aparato que lo ha recibido. Es lo que luego se ensena en
  -- pantalla: «este dispositivo recibio el ultimo aviso el...». Sin eso, dar
  -- permiso y que el reparto funcione se ven exactamente igual.
  update push_subscriptions
     set last_ok_at = now()
   where endpoint = any(coalesce(p_endpoints, '{}'::text[]));

  return v_n;
end;
$$;

-- 6.3 Un dispositivo que ya no existe -----------------------------------------
--
-- Cuando el servicio de push responde 404 o 410, esa suscripcion esta muerta
-- para siempre (aplicacion desinstalada, permiso revocado). Si no se borrara,
-- se intentaria en cada reparto hasta el fin de los tiempos.
create or replace function app.suscripcion_muerta(p_token text, p_endpoint text)
returns int language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_n int;
begin
  if not app.es_el_cartero(p_token) then
    raise exception 'Token del cartero incorrecto' using errcode = 'insufficient_privilege';
  end if;

  delete from push_subscriptions where endpoint = p_endpoint;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 6.4 Encolar las fechas, de parte del cartero ---------------------------------
create or replace function app.encolar_avisos(p_token text)
returns int language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not app.es_el_cartero(p_token) then
    raise exception 'Token del cartero incorrecto' using errcode = 'insufficient_privilege';
  end if;
  return app.encolar_avisos_de_fechas();
end;
$$;

revoke all on function app.avisos_por_enviar(text, int) from public;
revoke all on function app.avisos_por_enviar(text, int) from anon;
revoke all on function app.avisos_por_enviar(text, int) from authenticated;
revoke all on function app.avisos_entregados(text, uuid[], text[]) from public;
revoke all on function app.avisos_entregados(text, uuid[], text[]) from anon;
revoke all on function app.avisos_entregados(text, uuid[], text[]) from authenticated;
revoke all on function app.suscripcion_muerta(text, text) from public;
revoke all on function app.suscripcion_muerta(text, text) from anon;
revoke all on function app.suscripcion_muerta(text, text) from authenticated;
revoke all on function app.encolar_avisos(text) from public;
revoke all on function app.encolar_avisos(text) from anon;
revoke all on function app.encolar_avisos(text) from authenticated;

-- -----------------------------------------------------------------------------
-- 6.bis Las tres puertas, en `public`
--
-- PostgREST solo publica `public`, asi que el cartero necesita envolturas. Son
-- `security definer` a proposito: asi las funciones de `app` siguen cerradas a
-- `anon` -invariante que comprueba la 0015- y la unica forma de entrar es por
-- aqui, con el token.
-- -----------------------------------------------------------------------------
create or replace function public.avisos_por_enviar(p_token text, p_limite int default 100)
returns table (
  aviso_id uuid, titulo text, cuerpo text, enlace text,
  endpoint text, p256dh text, auth_key text
) language sql security definer
set search_path = public, pg_temp
as $$ select * from app.avisos_por_enviar(p_token, p_limite) $$;

create or replace function public.avisos_entregados(
  p_token text, p_ids uuid[], p_endpoints text[]
) returns int language sql security definer
set search_path = public, pg_temp
as $$ select app.avisos_entregados(p_token, p_ids, p_endpoints) $$;

create or replace function public.suscripcion_muerta(p_token text, p_endpoint text)
returns int language sql security definer
set search_path = public, pg_temp
as $$ select app.suscripcion_muerta(p_token, p_endpoint) $$;

create or replace function public.encolar_avisos(p_token text)
returns int language sql security definer
set search_path = public, pg_temp
as $$ select app.encolar_avisos(p_token) $$;

-- El cartero llama con la clave anon, como el keepalive. `authenticated` NO
-- entra: una persona con sesion no tiene nada que hacer aqui, y si alguna vez
-- se filtrara el token, al menos no serviria desde una sesion cualquiera.
--
-- Y HAY QUE REVOCAR A `authenticated` UNO A UNO, no vale con `from public`.
-- Tanto Supabase como el arnes de pruebas fijan privilegios por omision que
-- CONCEDEN todas las funciones de `public` a `anon` y a `authenticated`, asi
-- que estas nacen abiertas a los dos: `revoke ... from public` quita el
-- pseudo-rol PUBLIC y deja intacta la concesion explicita. Lo comprueba 7.5.
revoke all on function public.avisos_por_enviar(text, int) from public;
revoke all on function public.avisos_entregados(text, uuid[], text[]) from public;
revoke all on function public.suscripcion_muerta(text, text) from public;
revoke all on function public.encolar_avisos(text) from public;
revoke all on function public.avisos_por_enviar(text, int) from authenticated;
revoke all on function public.avisos_entregados(text, uuid[], text[]) from authenticated;
revoke all on function public.suscripcion_muerta(text, text) from authenticated;
revoke all on function public.encolar_avisos(text) from authenticated;
grant execute on function public.avisos_por_enviar(text, int) to anon;
grant execute on function public.avisos_entregados(text, uuid[], text[]) to anon;
grant execute on function public.suscripcion_muerta(text, text) to anon;
grant execute on function public.encolar_avisos(text) to anon;

-- -----------------------------------------------------------------------------
-- 7. Autocomprobaciones
-- -----------------------------------------------------------------------------
do $$
declare
  v_def       text;
  v_politicas int;
  v_abiertas  text;
begin
  -- 7.1 El buzon sigue siendo solo de disparadores (0011, 0015).
  if exists (
    select 1 from pg_policies where tablename = 'notifications' and cmd = 'INSERT'
  ) then
    raise exception '0032: notifications tiene politica de INSERT: se podrian escribir avisos en el buzon de otro';
  end if;

  -- 7.2 La idempotencia de los recordatorios.
  if not exists (
    select 1 from pg_indexes
     where tablename = 'notifications' and indexname = 'notifications_dedupe_uidx'
  ) then
    raise exception '0032: falta el indice unico de dedupe_key: los recordatorios se repetirian en cada reparto';
  end if;

  -- 7.3 Los dispositivos, de cada uno y de nadie mas.
  select count(*) into v_politicas from pg_policies where tablename = 'push_subscriptions';
  if v_politicas <> 4 then
    raise exception '0032: push_subscriptions deberia tener 4 politicas y tiene %', v_politicas;
  end if;
  if exists (
    select 1 from pg_policies
     where tablename = 'push_subscriptions'
       and coalesce(qual, '') || coalesce(with_check, '') not like '%app.uid()%'
  ) then
    raise exception '0032: alguna politica de push_subscriptions no mira a app.uid()';
  end if;
  if not exists (
    select 1 from pg_tables where tablename = 'push_subscriptions' and rowsecurity
  ) then
    raise exception '0032: push_subscriptions sin RLS: la lista de dispositivos de todos, a la vista';
  end if;

  -- 7.4 Los secretos: con RLS y SIN politicas, que es como se dice «nadie».
  if not exists (
    select 1 from pg_tables where schemaname = 'app' and tablename = 'secretos' and rowsecurity
  ) then
    raise exception '0032: app.secretos sin RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'app' and tablename = 'secretos') then
    raise exception '0032: app.secretos tiene politicas: deberia no tener ninguna';
  end if;

  -- 7.5 Las tres puertas estan abiertas al cartero y cerradas a todo lo demas.
  if not has_function_privilege('anon', 'public.avisos_por_enviar(text,int)', 'execute') then
    raise exception '0032: el cartero no puede leer lo que tiene que repartir';
  end if;
  if has_function_privilege('authenticated', 'public.avisos_por_enviar(text,int)', 'execute') then
    raise exception '0032: una sesion normal puede llamar a avisos_por_enviar';
  end if;
  if has_function_privilege('anon', 'public.encolar_avisos(text)', 'execute') is false then
    raise exception '0032: el cartero no puede encolar los avisos de fechas';
  end if;

  -- 7.6 Y la puerta sigue teniendo cerradura. Estas funciones son `security
  --     definer` y devuelven avisos de CUALQUIERA: sin la comprobacion del
  --     token, cualquiera con la clave anon -que es publica- leeria el buzon
  --     entero de todo el grupo. No da ningun error, asi que se comprueba que
  --     el texto siga ahi.
  for v_def in
    select pg_get_functiondef(p.oid)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname in ('avisos_por_enviar','avisos_entregados','suscripcion_muerta','encolar_avisos')
  loop
    if v_def not like '%es_el_cartero(p_token)%' then
      raise exception '0032: una funcion del cartero ya no comprueba el token';
    end if;
  end loop;

  -- 7.7 Ninguna funcion de `app` abierta a `anon` (invariante de la 0015).
  select string_agg(p.proname, ', ') into v_abiertas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute');
  if v_abiertas is not null then
    raise exception '0032: anon puede ejecutar funciones de app: %', v_abiertas;
  end if;

  -- 7.8 El aviso de los hilos existe.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.comments'::regclass and tgname = 'comments_notify_reply'
  ) then
    raise exception '0032: falta el disparador comments_notify_reply';
  end if;

  if not exists (select 1 from app.secretos where nombre = 'cartero') then
    raise notice '0032: FALTA EL TOKEN. Ejecuta ahora:  select app.nuevo_token_del_cartero();';
    raise notice '      y copia lo que devuelva al secreto AVISOS_TOKEN de GitHub.';
  end if;

  raise notice '0032 OK: los avisos de fechas y de hilos existen, y hay por donde repartirlos';
end $$;
