-- =============================================================================
-- 0029 · Un comentario lo edita quien lo escribio, y solo el texto
--
-- Hasta ahora un comentario solo se podia borrar. Eso convierte cualquier
-- errata en «borrar y volver a escribir», que en un hilo de seguimiento no es
-- lo mismo: el comentario cambia de sitio, pierde su fecha y las respuestas
-- que colgaran de el se quedan sin padre.
--
-- QUIEN PUEDE: solo el autor. Eso NO ES NUEVO y conviene decirlo, porque es la
-- razon de que esta migracion sea corta: `comments_update` (0003) ya exige
-- `author_id = app.uid()` en el `using` y en el `with check`. La direccion del
-- trabajo no puede reescribir lo que dijo otro, y un administrador de la
-- organizacion tampoco. Lo que falta aqui son las dos cosas que esa politica
-- no puede dar.
--
-- 1. QUE LA FECHA DE EDICION SEA VERDAD
-- `comments.updated_at` existe desde la 0002 pero nadie la tocaba: la tabla se
-- quedo sin el disparador `set_updated_at` que si tienen `academic_works`,
-- `work_members` y `tasks`. La pantalla marca los comentarios editados con esa
-- fecha, y una marca que depende de que el cliente se acuerde de mandarla es
-- una marca en la que no se puede confiar: cualquiera que hable con la API
-- directamente edita sin dejar rastro. Con el disparador, el rastro lo pone la
-- base de datos.
--
-- 2. QUE EDITAR SEA CAMBIAR EL TEXTO, Y NADA MAS
-- Una politica de RLS decide QUE FILAS se pueden tocar, no QUE COLUMNAS: es la
-- misma limitacion que encontro la 0027 con el correo del perfil, y se resuelve
-- igual, con un disparador. Sin el, el autor de un comentario podia cambiarle
-- el `work_id` —el `using` solo mira el autor, no la pertenencia al trabajo— y
-- plantar su comentario en el hilo de un trabajo del que no es miembro. No lo
-- veria (`comments_select` si comprueba el acceso), pero los miembros de ese
-- trabajo si verian aparecer el comentario de un desconocido.
--
-- Se congelan `work_id`, `entity_type`, `entity_id`, `author_id` y
-- `created_at`. Quedan editables `content`, `mentions` y `deleted_at`, que es
-- por donde pasa el borrado logico.
--
-- LAS MENCIONES NO SE REPITEN AL EDITAR, y no hace falta tocar nada para eso:
-- `comments_notify_mentions` (0011) es `after insert`, no `after update`. Si
-- algun dia se pasa a avisar tambien al editar, habra que decidir antes que
-- pasa con quien ya recibio el aviso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La fecha de edicion la pone la base de datos
-- -----------------------------------------------------------------------------
drop trigger if exists comments_updated_at on comments;
create trigger comments_updated_at
  before update on comments
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Un comentario no se muda de sitio ni cambia de autor
-- -----------------------------------------------------------------------------
create or replace function app.enforce_comment_immutable_columns()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.work_id     is distinct from old.work_id
  or new.entity_type is distinct from old.entity_type
  or new.entity_id   is distinct from old.entity_id
  or new.author_id   is distinct from old.author_id
  or new.created_at  is distinct from old.created_at then
    raise exception 'De un comentario solo se puede cambiar el texto'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_comment_immutable_columns() from public;

drop trigger if exists enforce_comment_immutable on comments;
create trigger enforce_comment_immutable
  before update on comments
  for each row execute function app.enforce_comment_immutable_columns();

-- -----------------------------------------------------------------------------
-- 3. Comprobacion
-- -----------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_trigger
   where tgrelid = 'public.comments'::regclass
     and tgname in ('comments_updated_at', 'enforce_comment_immutable');
  if n <> 2 then
    raise exception '0029: faltan disparadores en comments (hay %, se esperaban 2)', n;
  end if;
  raise notice '0029 OK: los comentarios se editan, y solo en su texto.';
end $$;
