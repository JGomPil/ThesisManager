-- =============================================================================
-- 0011 · Fase 2: reuniones, comentarios y notificaciones internas
--
-- Las tablas existen desde la 0002 y sus políticas desde la 0003. Esta
-- migración corrige cuatro cosas que aparecieron al ir a construir la interfaz
-- encima, y añade lo único que faltaba de verdad: cómo nacen las
-- notificaciones.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `comments_select` repetía el fallo del borrado lógico
--
-- Llevaba `deleted_at is null`, así que un autor no podía borrar su propio
-- comentario: al poner `deleted_at` la fila dejaría de serle visible y
-- PostgreSQL rechaza el UPDATE. Es la cuarta aparición del mismo patrón, y la
-- regla ya está escrita en SECURITY.md §5.2.septies: toda política de SELECT
-- que filtre por `deleted_at` debe dejar ver lo archivado a quien pueda
-- archivarlo.
-- -----------------------------------------------------------------------------
alter policy comments_select on comments
  using (
    work_id in (select app.accessible_work_ids())
    and (deleted_at is null or author_id = app.uid())
  );

-- -----------------------------------------------------------------------------
-- 2. La administración quedaba fuera de las reuniones
--
-- `meetings_write` admitía supervisión O administración, pero las políticas de
-- participantes y de acuerdos solo admitían supervisión. Resultado: un
-- administrador podía crear una reunión y después no podía añadirle
-- participantes ni acuerdos. Incoherencia, no decisión.
-- -----------------------------------------------------------------------------
alter policy mparts_write on meeting_participants
  using (exists (
    select 1 from meetings m
    where m.id = meeting_id
      and (app.is_work_supervisor(m.work_id) or app.is_admin_of_work(m.work_id))
  ))
  with check (exists (
    select 1 from meetings m
    where m.id = meeting_id
      and (app.is_work_supervisor(m.work_id) or app.is_admin_of_work(m.work_id))
  ));

alter policy agreements_write on meeting_agreements
  using (app.is_work_supervisor(work_id) or app.is_admin_of_work(work_id))
  with check (app.is_work_supervisor(work_id) or app.is_admin_of_work(work_id));

-- -----------------------------------------------------------------------------
-- 3. Las notas privadas y el autor
--
-- `private_notes_write` exige `author_id = app.uid()`, lo que está bien para
-- escribir, pero también se aplica al borrado: un director no podía borrar una
-- nota de otro director, que es correcto, pero tampoco podía la
-- administración... y eso no es un problema, es lo que queremos. Se deja como
-- está: cada cual es dueño de sus notas y nadie más las toca.
--
-- Lo que sí se verifica aquí es que la política de lectura sigue siendo la
-- crítica del sistema, con la regla de protección del estudiante dentro de
-- `app.can_see_private_notes`: si alguien es estudiante del trabajo, no ve las
-- notas privadas NI SIENDO ADEMÁS administrador de la organización.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'meeting_private_notes' and policyname = 'private_notes_select'
  ) then
    raise exception 'Falta la politica private_notes_select';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Las notificaciones no podían existir
--
-- `notifications` tenía políticas de SELECT y de UPDATE (para marcar como
-- leída) y NINGUNA de INSERT, así que nadie podía crear una notificación. No
-- se arregla dando permiso de INSERT al cliente: con él, cualquier usuario
-- podría escribir notificaciones en el buzón de cualquier otro, y eso es
-- suplantación. Las notificaciones las crean DISPARADORES, que se ejecutan con
-- los privilegios de su propietario y por tanto no necesitan política.
--
-- Deliberadamente NO hay disparador sobre `meeting_private_notes`: una
-- notificación de que «se ha añadido una nota» revelaría la existencia de la
-- nota a quien no puede leerla. Avisar de algo privado es filtrarlo.
-- -----------------------------------------------------------------------------

create or replace function app.notify(
  target uuid, work uuid, kind text, subject text, body text, link text
) returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  -- Nadie se notifica a sí mismo: quien hace la acción ya lo sabe.
  if target is null or target = auth.uid() then
    return;
  end if;
  insert into notifications (user_id, work_id, type, title, body, link)
  values (target, work, kind, subject, body, link);
end;
$$;

revoke all on function app.notify(uuid, uuid, text, text, text, text) from public;
revoke all on function app.notify(uuid, uuid, text, text, text, text) from anon;

-- 4.1 Tarea asignada ----------------------------------------------------------
create or replace function app.notify_task_assigned()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare titulo text;
begin
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;

  select w.title into titulo from academic_works w where w.id = new.work_id;
  perform app.notify(
    new.assignee_id, new.work_id, 'TASK_ASSIGNED',
    'Tienes una tarea nueva',
    new.title || ' · ' || coalesce(titulo, 'trabajo'),
    '/trabajos/' || new.work_id
  );
  return new;
end;
$$;

drop trigger if exists tasks_notify_assignee on tasks;
create trigger tasks_notify_assignee
  after insert or update of assignee_id on tasks
  for each row execute function app.notify_task_assigned();

-- 4.2 Menciones en comentarios ------------------------------------------------
create or replace function app.notify_comment_mentions()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  destinatario uuid;
  titulo text;
  quien text;
begin
  if array_length(new.mentions, 1) is null then return new; end if;

  select w.title into titulo from academic_works w where w.id = new.work_id;
  select p.full_name into quien from profiles p where p.id = new.author_id;

  foreach destinatario in array new.mentions loop
    -- Solo se avisa a quien ya tiene acceso al trabajo. Mencionar a alguien de
    -- fuera no le da acceso ni le dice que el trabajo existe.
    if exists (
      select 1 from work_members m
      where m.work_id = new.work_id and m.user_id = destinatario and m.status = 'ACTIVE'
    ) then
      perform app.notify(
        destinatario, new.work_id, 'MENTION',
        coalesce(quien, 'Alguien') || ' te ha mencionado',
        left(new.content, 140) || case when length(new.content) > 140 then '…' else '' end,
        '/trabajos/' || new.work_id
      );
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists comments_notify_mentions on comments;
create trigger comments_notify_mentions
  after insert on comments
  for each row execute function app.notify_comment_mentions();

-- 4.3 Entrega de una versión de documento -------------------------------------
create or replace function app.notify_document_version()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  destinatario uuid;
  nombre text;
begin
  select d.name into nombre from documents d where d.id = new.document_id;

  -- A quien valida entregables en ese trabajo: es quien tiene que revisarlo.
  for destinatario in
    select m.user_id
    from work_members m
    join work_roles r on r.id = m.work_role_id
    where m.work_id = new.work_id
      and m.status = 'ACTIVE'
      and coalesce((m.permissions->>'can_validate_deliverables')::boolean,
                   r.can_validate_deliverables)
  loop
    perform app.notify(
      destinatario, new.work_id, 'DOCUMENT_SUBMITTED',
      'Hay una entrega para revisar',
      coalesce(nombre, 'Documento') || ' · ' || new.version_label,
      '/trabajos/' || new.work_id
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists versions_notify on document_versions;
create trigger versions_notify
  after insert on document_versions
  for each row execute function app.notify_document_version();

-- 4.4 Reunión convocada -------------------------------------------------------
create or replace function app.notify_meeting()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare destinatario uuid;
begin
  if tg_op = 'UPDATE' and new.scheduled_at is not distinct from old.scheduled_at then
    return new;
  end if;

  for destinatario in
    select m.user_id from work_members m
    where m.work_id = new.work_id and m.status = 'ACTIVE'
  loop
    perform app.notify(
      destinatario, new.work_id,
      case when tg_op = 'INSERT' then 'MEETING_SCHEDULED' else 'MEETING_MOVED' end,
      case when tg_op = 'INSERT' then 'Reunión convocada' else 'Reunión movida de fecha' end,
      new.title || ' · ' || to_char(new.scheduled_at, 'DD/MM/YYYY HH24:MI'),
      '/trabajos/' || new.work_id
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists meetings_notify on meetings;
create trigger meetings_notify
  after insert or update of scheduled_at on meetings
  for each row execute function app.notify_meeting();

-- Las funciones de disparador no necesitan EXECUTE para el usuario que provoca
-- la sentencia, así que se les quita a todo el mundo. Coherente con la 0007.
do $$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname like 'notify%'
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
  end loop;
end $$;

-- Borrar una notificación propia (vaciar el buzón) no estaba contemplado.
drop policy if exists notifs_delete on notifications;
create policy notifs_delete on notifications for delete to authenticated
  using (user_id = app.uid());

-- -----------------------------------------------------------------------------
-- 5. Verificación
-- -----------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_trigger
  where tgname in ('tasks_notify_assignee','comments_notify_mentions','versions_notify','meetings_notify');
  if n <> 4 then
    raise exception 'Faltan disparadores de notificacion: hay % de 4', n;
  end if;

  if exists (
    select 1 from pg_policies
    where tablename = 'notifications' and cmd = 'INSERT'
  ) then
    raise exception 'notifications tiene politica de INSERT: las notificaciones solo las crean disparadores';
  end if;

  raise notice 'Migracion 0011 correcta: 4 disparadores, sin INSERT para el cliente.';
end $$;
