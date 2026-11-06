-- =============================================================================
-- 0015 · Comentarios sobre la versión de un documento
--
-- QUÉ YA ESTABA Y POR QUÉ NO SERVÍA TAL CUAL
-- `document_comments` existe desde la 0002, con sus cuatro políticas en la
-- 0003, y no se había usado nunca. Al ponerla en marcha aparecen tres cosas que
-- la tabla por sí sola no resuelve.
--
-- 1. EL `work_id` AHORA SE DERIVA, NO SE CREE.
--    La fila lleva `version_id` y `work_id` como dos claves ajenas
--    independientes, así que nada impedía una fila cuya versión perteneciera a
--    un trabajo y cuyo `work_id` dijera otro. Y `work_id` no es un dato
--    cualquiera: es la columna por la que `doccomments_select` decide QUIÉN VE
--    el comentario. Un `work_id` equivocado es un comentario mostrado al grupo
--    de personas equivocado.
--
--    No se valida: se sobrescribe. El disparador BEFORE lo rellena a partir de
--    la versión, y como PostgreSQL aplica el `with check` de RLS DESPUÉS de los
--    disparadores BEFORE, la política acaba decidiendo sobre el trabajo de
--    verdad. Si alguien manda la versión de un trabajo ajeno, el `work_id` pasa
--    a ser el de ese trabajo y la política lo rechaza por no ser miembro. Es
--    mejor que validar y devolver un error: no hay forma de equivocarse.
--
-- 2. `doccomments_insert` EXIGÍA SER MIEMBRO DEL TRABAJO.
--    La administración del grupo no lo es necesariamente, así que no podía
--    comentar una entrega. Es el mismo arreglo que la 0011 hizo con los
--    acuerdos y los participantes de reunión; se añade `app.is_admin_of_work`.
--
-- 3. UN COMENTARIO QUE NADIE VE NO SIRVE DE NADA.
--    Las notificaciones las crean disparadores, nunca el cliente (§5.2.nonies
--    de SECURITY.md), así que hace falta uno. A quién avisa está razonado abajo.
--
-- LO QUE NO SE HACE: anclar el comentario a una página o a un párrafo. Haría
-- falta guardar una posición dentro del fichero, y el fichero puede ser un PDF,
-- un .docx o un enlace a Drive; una posición que no se puede resolver es peor
-- que ninguna. El anclaje es la VERSIÓN, que es la unidad que de verdad existe:
-- «esto, en la v3» se entiende siempre y no se rompe al subir la v4.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. El trabajo del comentario es el de su versión, sin excepción
-- -----------------------------------------------------------------------------
create or replace function app.enforce_doc_comment_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_work uuid;
begin
  select work_id into v_work from document_versions where id = new.version_id;
  if v_work is null then
    raise exception 'La versión comentada no existe'
      using errcode = 'foreign_key_violation';
  end if;
  -- Se impone, no se comprueba: así un cliente que mande otro `work_id` no
  -- consigue nada, ni siquiera un comentario mal colocado.
  new.work_id := v_work;
  return new;
end;
$$;

drop trigger if exists doccomments_scope on document_comments;
create trigger doccomments_scope
  before insert or update on document_comments
  for each row execute function app.enforce_doc_comment_scope();

-- -----------------------------------------------------------------------------
-- 2. La administración del trabajo también puede comentar
-- -----------------------------------------------------------------------------
alter policy doccomments_insert on document_comments
  with check (
    (app.is_work_member(work_id) or app.is_admin_of_work(work_id))
    and author_id = app.uid()
  );

-- -----------------------------------------------------------------------------
-- 3. A quién avisa un comentario
--
-- A tres grupos, en una sola consulta con UNION (que ya quita duplicados):
--   · quien subió la versión, porque el comentario es sobre su entrega;
--   · quien ya había comentado esa versión, para que el hilo funcione en los
--     dos sentidos: si la dirección comenta y el estudiante responde, la
--     respuesta llega a quien preguntó;
--   · quien valida entregables en ese trabajo, para que un comentario del
--     estudiante no se quede sin leer si la dirección aún no había escrito.
--
-- NO se avisa a todos los participantes del trabajo. En un trabajo con tribunal
-- y codirección, cada comentario sobre un borrador generaría media docena de
-- avisos y el buzón dejaría de significar nada, que es la forma habitual de que
-- las notificaciones se vuelvan invisibles.
--
-- `app.notify` se salta a quien actúa, de modo que nadie se avisa a sí mismo.
-- -----------------------------------------------------------------------------
create or replace function app.notify_doc_comment()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  destinatario uuid;
  nombre text;
  etiqueta text;
  quien text;
begin
  select d.name, v.version_label into nombre, etiqueta
    from document_versions v
    join documents d on d.id = v.document_id
   where v.id = new.version_id;

  select p.full_name into quien from profiles p where p.id = new.author_id;

  for destinatario in
        select v.author_id as uid from document_versions v where v.id = new.version_id
    union
        select c.author_id from document_comments c
         where c.version_id = new.version_id and c.id <> new.id
    union
        select m.user_id
          from work_members m
          join work_roles r on r.id = m.work_role_id
         where m.work_id = new.work_id
           and m.status = 'ACTIVE'
           and coalesce((m.permissions->>'can_validate_deliverables')::boolean,
                        r.can_validate_deliverables)
  loop
    perform app.notify(
      destinatario, new.work_id, 'DOCUMENT_COMMENT',
      'Comentario sobre un documento',
      coalesce(quien, 'Alguien') || ' ha comentado ' ||
        coalesce(nombre, 'un documento') || ' · ' || coalesce(etiqueta, 'versión'),
      '/trabajos/' || new.work_id
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists doccomments_notify on document_comments;
create trigger doccomments_notify
  after insert on document_comments
  for each row execute function app.notify_doc_comment();

-- -----------------------------------------------------------------------------
-- 4. Privilegios
--
-- El `revoke` en bloque otra vez: `alter default privileges ... revoke` no
-- protege a las funciones futuras (apartado 5 de la 0012), así que las dos
-- funciones nuevas nacen ejecutables por PUBLIC —y `anon` es miembro de
-- PUBLIC— hasta que se cierre aquí. Las de disparador no necesitan EXECUTE:
-- PostgreSQL no lo comprueba al dispararlas, así que no se concede nada.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

-- -----------------------------------------------------------------------------
-- 5. Verificación
-- -----------------------------------------------------------------------------
do $$
declare
  v_abiertas text;
  n int;
begin
  select count(*) into n from pg_trigger
   where tgname in ('doccomments_scope', 'doccomments_notify');
  if n <> 2 then
    raise exception 'Faltan disparadores de document_comments: hay % de 2', n;
  end if;

  -- La regla de las notificaciones no ha cambiado: las crea la base de datos.
  if exists (
    select 1 from pg_policies where tablename = 'notifications' and cmd = 'INSERT'
  ) then
    raise exception 'notifications tiene politica de INSERT: las notificaciones solo las crean disparadores';
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'document_comments' and policyname = 'doccomments_insert'
      and with_check like '%is_admin_of_work%'
  ) then
    raise exception 'doccomments_insert no admite a la administracion del trabajo';
  end if;

  select string_agg(p.proname, ', ') into v_abiertas
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'app'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_abiertas is not null then
    raise exception 'anon puede ejecutar funciones de app: %', v_abiertas;
  end if;

  raise notice 'Migracion 0015 correcta: comentarios anclados a la version, con aviso al hilo.';
end $$;
