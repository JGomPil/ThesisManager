-- =============================================================================
-- 0036 · Responder a un comentario
--
-- `comments.parent_comment_id` existe desde la 0005 y no la escribia nadie: en
-- pantalla el hilo era plano, de modo que en una tarjeta con quince comentarios
-- no habia forma de saber a cual contestaba cada uno. Era el otro hueco que el
-- guarda `check:columnas` cantaba en cada ejecucion.
--
-- DOS NIVELES, Y LO DICE LA BASE DE DATOS. Una respuesta cuelga de un
-- comentario raiz, y de una respuesta no cuelga nada: si se contesta a una
-- respuesta, la nueva se engancha a la misma raiz. No es una limitacion de la
-- pantalla que la base tolere, es la regla, y se escribe aqui por dos motivos:
--
--   · UNA CONVERSACION ANIDADA SIN FIN NO SE PUEDE DIBUJAR en la columna
--     estrecha de una ficha -al cuarto nivel el texto tiene tres palabras por
--     linea- y, peor, deja de decir a que contesta cada cosa, que es justo lo
--     que venia a arreglar.
--   · UNA CADENA DE PADRES ES UNA CADENA, y las cadenas tienen ciclos. Con un
--     solo nivel, el ciclo no se puede ni escribir: la raiz de una respuesta
--     tiene el padre a nulo por definicion.
--
-- Y LO QUE LA CLAVE AJENA NO COMPRUEBA, que es lo de siempre:
-- `parent_comment_id references comments(id)` admite como padre CUALQUIER
-- comentario de la base, incluido el de otro trabajo o el de otra tarea. Una
-- peticion a PostgREST podia colgar una respuesta del comentario de un trabajo
-- ajeno: no da error, y lo que pasa despues es que la respuesta aparece sola en
-- su hilo, huerfana, o se la lleva por delante el agrupamiento de la pantalla.
-- Asi que el padre tiene que ser del MISMO TRABAJO y de la MISMA ENTIDAD.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. De quien puede colgar una respuesta
--
-- `before insert or update`: un alta puede traer el padre puesto, y una edicion
-- podria cambiarlo. La 0031 ya congela `entity_type`, `entity_id` y `author_id`
-- en las ediciones, pero `parent_comment_id` no estaba en esa lista -no la
-- escribia nadie-, de modo que sin esto se podria mudar una respuesta de hilo
-- editandola.
-- -----------------------------------------------------------------------------
create or replace function app.enforce_comment_parent()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_padre record;
begin
  if new.parent_comment_id is null then
    return new;
  end if;

  if new.parent_comment_id = new.id then
    raise exception 'Un comentario no puede responderse a si mismo'
      using errcode = 'check_violation';
  end if;

  select c.work_id, c.entity_type, c.entity_id, c.parent_comment_id, c.deleted_at
    into v_padre
    from comments c
   where c.id = new.parent_comment_id;

  -- `not found` y no `v_padre is null`: un `record` al que el select no ha
  -- devuelto fila queda con todos sus campos nulos, de modo que las dos
  -- comprobaciones aciertan aqui por casualidad. `found` dice lo que se
  -- quiere decir.
  if not found then
    raise exception 'El comentario al que respondes no existe'
      using errcode = 'check_violation';
  end if;

  if v_padre.deleted_at is not null then
    raise exception 'No se puede responder a un comentario borrado'
      using errcode = 'check_violation';
  end if;

  if v_padre.work_id is distinct from new.work_id
  or v_padre.entity_type is distinct from new.entity_type
  or v_padre.entity_id is distinct from new.entity_id then
    raise exception 'Una respuesta vive en el mismo hilo que el comentario al que responde'
      using errcode = 'check_violation';
  end if;

  if v_padre.parent_comment_id is not null then
    raise exception 'El hilo tiene dos niveles: responde al comentario original, no a una respuesta'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
revoke all on function app.enforce_comment_parent() from public;
revoke all on function app.enforce_comment_parent() from anon;

drop trigger if exists comments_parent_valido on comments;
create trigger comments_parent_valido
  before insert or update on comments
  for each row execute function app.enforce_comment_parent();

-- -----------------------------------------------------------------------------
-- 2. El aviso dice que es una respuesta
--
-- La 0032 ya avisaba a «quien habia escrito en el mismo hilo», y eso ya incluia
-- al autor del comentario contestado. Lo que no se podia era DISTINGUIRLO: a
-- quien respondes y a quien le llega de rebote recibian el mismo «ha
-- comentado». Ahora el autor del comentario al que se responde recibe «ha
-- respondido a tu comentario», que es lo que hace que el aviso valga para algo
-- en un hilo largo.
--
-- A quien se avisa NO CAMBIA: los mismos destinatarios, las mismas exclusiones
-- (el autor, los ya mencionados, quien no sea miembro activo y quien tenga la
-- casilla de comentarios apagada). Cambia una linea de texto por destinatario.
-- -----------------------------------------------------------------------------
create or replace function app.notify_comment_reply()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_quien   text;
  v_dest    uuid;
  v_padre   uuid;
  v_titulo  text;
begin
  if new.deleted_at is not null then return new; end if;

  select p.full_name into v_quien from profiles p where p.id = new.author_id;

  -- A quien se responde, si se responde a alguien.
  if new.parent_comment_id is not null then
    select c.author_id into v_padre from comments c where c.id = new.parent_comment_id;
  end if;

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
    v_titulo := case
      when v_padre is not null and v_dest = v_padre
        then coalesce(v_quien, 'Alguien') || ' ha respondido a tu comentario'
      else coalesce(v_quien, 'Alguien') || ' ha comentado'
    end;

    perform app.notify(
      v_dest, new.work_id, 'COMMENT_REPLY',
      v_titulo,
      left(new.content, 140) || case when length(new.content) > 140 then '...' else '' end,
      '/trabajos/' || new.work_id
    );
  end loop;
  return new;
end;
$$;
revoke all on function app.notify_comment_reply() from public;
revoke all on function app.notify_comment_reply() from anon;

-- -----------------------------------------------------------------------------
-- 3. Autocomprobaciones
-- -----------------------------------------------------------------------------
do $$
declare v_def text;
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.comments'::regclass
       and tgname = 'comments_parent_valido'
  ) then
    raise exception '0036: falta el disparador que valida de quien cuelga una respuesta';
  end if;

  -- El de los avisos sigue puesto despues de reescribir la funcion: se
  -- reemplaza el cuerpo, no el disparador, pero conviene no fiarse.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.comments'::regclass
       and tgname = 'comments_notify_reply'
  ) then
    raise exception '0036: el disparador de avisos de comentarios ha desaparecido';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'notify_comment_reply';

  -- Las tres exclusiones de la 0032, intactas: no avisarse a uno mismo, no
  -- avisar dos veces a quien ya va mencionado, y respetar la casilla. Al
  -- reescribir una funcion entera es justo lo que se pierde sin enterarse.
  if v_def not like '%u.user_id <> new.author_id%'
  or v_def not like '%new.mentions%'
  or v_def not like '%on_comments%' then
    raise exception '0036: el aviso de comentarios ha perdido alguna de sus exclusiones';
  end if;
  if v_def not like '%ha respondido a tu comentario%' then
    raise exception '0036: el aviso no distingue una respuesta de un comentario suelto';
  end if;

  raise notice '0036 OK: se responde a un comentario, el hilo tiene dos niveles y el aviso lo dice.';
end $$;
