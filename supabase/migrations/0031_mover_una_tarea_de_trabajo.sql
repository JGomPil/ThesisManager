-- =============================================================================
-- 0031 · Mover una tarea de un trabajo a otro
--
-- EL CASO REAL: una tarjeta escrita en el trabajo equivocado, o un trabajo que
-- se parte en dos. Hasta ahora no habia forma de arreglarlo salvo volver a
-- escribir la tarea a mano y perder su historia.
--
-- QUIEN PUEDE: quien PLANIFICA LOS DOS trabajos, el de origen y el de destino.
-- No basta con dirigir uno. Dicho de otra forma: mover una tarea es sacarla de
-- un plan y meterla en otro, y las dos mitades son actos de planificacion.
--
-- Y ESO NO ES LO QUE PASABA ANTES DE ESTA MIGRACION, que es el motivo de que
-- haya migracion y no solo pantalla. `tasks_update` admite la fila por el
-- `using` si eres el RESPONSABLE de la tarea, y el `with check` se contenta con
-- `can_manage_plan` del destino. O sea que un alumno responsable de una tarea
-- en TFG-01 que ademas dirija TFG-02 -un doctorando que tutela un TFG, que es
-- una combinacion de lo mas normal en un grupo- podia sacar su tarea de un
-- plan que no dirige. No lo habria hecho queriendo; lo habria hecho arrastrando
-- algo en una pantalla que se lo ofreciera.
--
-- LO QUE SE LLEVA Y LO QUE SE SUELTA, que es casi todo el trabajo de esta
-- migracion. Una tarea no es una fila: es una fila con cosas colgando, y
-- cambiar `work_id` a secas deja medio trabajo apuntando al sitio equivocado
-- sin que nada se queje.
--
--   SE LLEVA   los puntos de su lista de comprobacion (son subtareas reales,
--              con su propio `work_id`: si no viajaran, quedarian en el
--              trabajo viejo colgando de un padre que ya no esta alli)
--   SE LLEVA   su hilo de comentarios (`comments` guarda `work_id`
--              desnormalizado para RLS; sin moverlo, la conversacion se
--              quedaria invisible en los dos sitios)
--   SE SUELTA  la columna del tablero: es de otro trabajo, y la 0024 lo
--              rechaza. La tarea cae en la primera columna del destino
--   SE SUELTA  el hito: tambien es del trabajo de origen
--   SE SUELTA  el responsable, SOLO si no participa en el destino: una tarjeta
--              a nombre de alguien que no esta en el trabajo no la puede
--              atender nadie, y a esa persona le aparecia en «mis tareas» un
--              trabajo que no puede abrir
--   SE BORRAN  las dependencias que cruzarian trabajos: «esta tarea espera a
--              aquella» solo significa algo dentro de un plan
--   SE SUELTA  el enlace desde un acuerdo de acta (`meeting_agreements.task_id`):
--              un acta del trabajo de origen no puede señalar una tarea que ya
--              esta en otro
--   SE SUELTA  el enlace de los documentos (`documents.task_id`). El documento
--              NO viaja: es la entrega de un trabajo concreto, con sus
--              permisos y su revision, y eso no cambia porque una tarjeta se
--              mude. La 0010 exige ademas que documento y tarea sean del mismo
--              trabajo, y su disparador solo mira al escribir el DOCUMENTO: una
--              tarea que se muda rompe ese invariante sin que nadie se entere
--
-- LOS COMENTARIOS VIAJAN, Y ESO HAY QUE DECIRLO EN VOZ ALTA. Significa que
-- quien participe en el trabajo de destino podra leer lo que se escribio en el
-- de origen. Se ha decidido que viajen porque la historia de una tarea es de la
-- tarea -moverla y dejar la conversacion atras produce dos mitades invisibles-,
-- y porque quien la mueve dirige los dos trabajos, asi que no hay nada que no
-- pudiera leer ya. Pero no es inocuo, y por eso la pantalla lo avisa antes.
--
-- POR QUE UNA FUNCION Y NO UNA POLITICA. Lo que hay que garantizar aqui no es
-- «quien puede escribir esta fila» sino «estas nueve escrituras ocurren todas o
-- no ocurre ninguna». Eso es una transaccion, y una politica no las hace. La
-- funcion es `security definer`, asi que se salta RLS: la comprobacion de
-- permisos de sus primeras lineas ES la seguridad, y por eso va antes que
-- cualquier escritura y no depende de ningun parametro que venga del cliente
-- mas que los dos identificadores.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Auxiliar: ¿participa esta persona en este trabajo?
--
-- No vale `app.is_work_member`, que responde por QUIEN EJECUTA la consulta;
-- aqui se pregunta por un tercero, el responsable de la tarea. Misma regla de
-- siempre: pertenencia ACTIVA y sin fecha de fin pasada.
-- -----------------------------------------------------------------------------
create or replace function app.es_participante_activo(persona uuid, trabajo uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from work_members wm
     where wm.work_id = trabajo
       and wm.user_id = persona
       and wm.status = 'ACTIVE'
       and (wm.end_date is null or wm.end_date >= current_date)
  );
$$;

revoke all on function app.es_participante_activo(uuid, uuid) from public;
revoke all on function app.es_participante_activo(uuid, uuid) from anon;
grant execute on function app.es_participante_activo(uuid, uuid) to authenticated;

create or replace function app.mover_tarea_de_trabajo(tarea uuid, destino uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_origen uuid;
  v_padre  uuid;
  v_responsable uuid;
begin
  select work_id, parent_task_id, assignee_id
    into v_origen, v_padre, v_responsable
    from tasks
   where id = tarea and deleted_at is null;

  if v_origen is null then
    raise exception 'La tarea no existe o esta en la papelera'
      using errcode = 'no_data_found';
  end if;

  -- UN PUNTO DE UNA LISTA NO SE MUEVE SUELTO. Viaja con su tarea, y moverlo
  -- aparte lo dejaria colgando de un padre de otro trabajo: `tasks_select` y el
  -- recuento de la lista irian cada uno por su lado.
  if v_padre is not null then
    raise exception 'Un punto de una lista de comprobacion se mueve con su tarea, no por separado'
      using errcode = 'invalid_parameter_value';
  end if;

  if not exists (select 1 from academic_works where id = destino and deleted_at is null) then
    raise exception 'El trabajo de destino no existe'
      using errcode = 'no_data_found';
  end if;

  if v_origen = destino then
    return;   -- nada que hacer, y no es un error
  end if;

  -- LA FRONTERA, antes de tocar nada.
  if not app.can_manage_plan(v_origen) or not app.can_manage_plan(destino) then
    raise exception 'Mover una tarea entre trabajos exige planificar los dos'
      using errcode = 'insufficient_privilege';
  end if;

  -- 1. Las dependencias que cruzarian de trabajo. Se miran las dos puntas: la
  --    tarea puede esperar a otra y otra puede estar esperandola a ella.
  delete from task_dependencies d
   where (d.task_id = tarea or d.depends_on_task_id = tarea)
     and exists (
       select 1 from tasks t
        where t.id = case when d.task_id = tarea then d.depends_on_task_id else d.task_id end
          and t.work_id <> destino
     );

  -- 2. Los acuerdos de acta que la señalaban, incluidos los de sus puntos.
  update meeting_agreements
     set task_id = null
   where task_id = tarea
      or task_id in (select id from tasks where parent_task_id = tarea);

  -- 3. Los documentos que la señalaban. Se quedan en su trabajo y pierden el
  --    vinculo: lo exige la 0010, y su disparador no se entera de esto porque
  --    solo mira al escribir el documento.
  update documents
     set task_id = null
   where task_id = tarea
      or task_id in (select id from tasks where parent_task_id = tarea);

  -- 4. Los puntos de la lista. Antes que la tarea para que ninguna fila quede
  --    ni un instante con el padre en otro trabajo.
  update tasks
     set work_id = destino,
         board_column_id = null,
         milestone_id = null,
         assignee_id = case
           when assignee_id is null then null
           when app.es_participante_activo(assignee_id, destino) then assignee_id
           else null
         end
   where parent_task_id = tarea;

  -- 5. Y la tarea.
  update tasks
     set work_id = destino,
         board_column_id = null,
         milestone_id = null,
         assignee_id = case
           when v_responsable is null then null
           when app.es_participante_activo(v_responsable, destino) then v_responsable
           else null
         end
   where id = tarea;

  -- 6. Y AL FINAL el hilo de comentarios, de la tarea y de sus puntos. Va el
  --    ultimo a proposito: la regla nueva de aqui abajo exige que un comentario
  --    este en el trabajo de aquello que comenta, asi que la tarea tiene que
  --    haberse mudado ya.
  update comments
     set work_id = destino
   where entity_type = 'TASK'
     and (entity_id = tarea
          or entity_id in (select id from tasks where parent_task_id = tarea));
end;
$$;

revoke all on function app.mover_tarea_de_trabajo(uuid, uuid) from public;
revoke all on function app.mover_tarea_de_trabajo(uuid, uuid) from anon;
grant execute on function app.mover_tarea_de_trabajo(uuid, uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- Un comentario vive en el trabajo de aquello que comenta
--
-- LA 0029 DECIA OTRA COSA: que el `work_id` de un comentario NO CAMBIA NUNCA.
-- Lo escribi asi para tapar un agujero concreto -el `using` de
-- `comments_update` solo mira el autor, no la pertenencia al trabajo, de modo
-- que el autor podia mudar su comentario al hilo de un trabajo del que no es
-- miembro y plantarles alli un comentario de un desconocido-.
--
-- Pero «no cambia nunca» no era la regla; era UNA FORMA de cumplirla, y la mas
-- gruesa. Al mudar una tarea de trabajo hay que mudar su hilo con ella, y la
-- 0029 lo impedia. La regla de verdad es esta:
--
--   un comentario esta en el trabajo de la cosa sobre la que se comenta.
--
-- Cierra exactamente el mismo agujero -el autor no puede llevarselo a un
-- trabajo cualquiera, porque alli no esta la tarea- y ademas cubre un caso que
-- la version anterior NO cubria: un comentario cuyo `work_id` nunca cambio pero
-- que nacio apuntando al trabajo equivocado se quedaba asi para siempre.
--
-- Es `security definer` porque LEE OTRAS TABLAS para decidir. Sin eso, la
-- comprobacion se haria con los permisos de quien edita y podria no ver la
-- tarea; fallaria CERRADA -rechazaria una edicion legitima sin motivo visible-
-- que es el otro modo de que una pantalla no sirva (SECURITY.md §5.2).
-- -----------------------------------------------------------------------------
create or replace function app.trabajo_de_la_entidad(tipo text, entidad uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case tipo
           when 'WORK'     then (select w.id      from academic_works w where w.id = entidad)
           when 'TASK'     then (select t.work_id from tasks          t where t.id = entidad)
           when 'DOCUMENT' then (select d.work_id from documents      d where d.id = entidad)
           when 'MEETING'  then (select m.work_id from meetings       m where m.id = entidad)
         end;
$$;
revoke all on function app.trabajo_de_la_entidad(text, uuid) from public;
revoke all on function app.trabajo_de_la_entidad(text, uuid) from anon;
grant execute on function app.trabajo_de_la_entidad(text, uuid) to authenticated;

create or replace function app.enforce_comment_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Esto no se toca nunca, y es lo que hace que un comentario siga siendo el
  -- mismo comentario: de quien es, sobre que es y cuando se dijo.
  if new.entity_type is distinct from old.entity_type
  or new.entity_id   is distinct from old.entity_id
  or new.author_id   is distinct from old.author_id
  or new.created_at  is distinct from old.created_at then
    raise exception 'De un comentario solo se puede cambiar el texto'
      using errcode = 'insufficient_privilege';
  end if;

  -- Y el trabajo puede cambiar, pero solo para seguir a su entidad.
  if new.work_id is distinct from old.work_id
     and new.work_id is distinct from app.trabajo_de_la_entidad(new.entity_type, new.entity_id) then
    raise exception 'Un comentario vive en el trabajo de aquello sobre lo que se comenta'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;
revoke all on function app.enforce_comment_immutable_columns() from public;

-- -----------------------------------------------------------------------------
-- La envoltura en `public`, para que la pantalla pueda llamarla
--
-- Todo el esquema `app` esta fuera del alcance de PostgREST a proposito: ahi
-- viven los ayudantes de las politicas y no tendria ningun sentido que un
-- cliente los llamara. Pero eso significa que `supabase.rpc(...)` no
-- encontraria esta funcion. Misma envoltura de una linea que la `0012` hizo
-- para `apply_template`, y por lo mismo.
--
-- La envoltura NO lleva `security definer`: el que lo lleva es lo de dentro,
-- que es donde esta la comprobacion de permisos. Y como `public` SI lo ve
-- PostgREST -y con el, `anon`-, van los `revoke` de siempre.
-- -----------------------------------------------------------------------------
create or replace function public.mover_tarea_de_trabajo(p_tarea uuid, p_destino uuid)
returns void language sql
set search_path = public, pg_temp
as $$ select app.mover_tarea_de_trabajo(p_tarea, p_destino) $$;

revoke all on function public.mover_tarea_de_trabajo(uuid, uuid) from public;
revoke all on function public.mover_tarea_de_trabajo(uuid, uuid) from anon;
grant execute on function public.mover_tarea_de_trabajo(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Autocomprobaciones
-- -----------------------------------------------------------------------------
do $$
declare v_def text;
begin
  if not has_function_privilege('authenticated', 'app.mover_tarea_de_trabajo(uuid,uuid)', 'execute') then
    raise exception '0031: authenticated no puede ejecutar mover_tarea_de_trabajo';
  end if;
  if has_function_privilege('anon', 'app.mover_tarea_de_trabajo(uuid,uuid)', 'execute') then
    raise exception '0031: anon puede ejecutar mover_tarea_de_trabajo';
  end if;
  if has_function_privilege('anon', 'app.es_participante_activo(uuid,uuid)', 'execute') then
    raise exception '0031: anon puede ejecutar es_participante_activo';
  end if;
  -- La envoltura vive en `public`, que es lo que PostgREST ve: si naciera
  -- abierta a `anon`, cualquiera sin cuenta podria llamarla. Dentro se le
  -- caeria por la comprobacion de permisos, pero no es sitio para confiarse.
  if not has_function_privilege('authenticated', 'public.mover_tarea_de_trabajo(uuid,uuid)', 'execute') then
    raise exception '0031: la pantalla no puede llamar a mover_tarea_de_trabajo';
  end if;
  if has_function_privilege('anon', 'public.mover_tarea_de_trabajo(uuid,uuid)', 'execute') then
    raise exception '0031: anon puede llamar a la envoltura de mover_tarea_de_trabajo';
  end if;

  -- La funcion es `security definer`: se salta RLS, de modo que si alguien le
  -- quitara la comprobacion de permisos quedaria un «mueve lo que quieras a
  -- donde quieras» para cualquiera que haya entrado. No da ningun error, asi
  -- que se comprueba que el texto siga ahi.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'mover_tarea_de_trabajo';

  if v_def not like '%can_manage_plan(v_origen)%' or v_def not like '%can_manage_plan(destino)%' then
    raise exception '0031: mover_tarea_de_trabajo ya no comprueba los DOS trabajos';
  end if;
  if v_def not like '%board_column_id = null%' then
    raise exception '0031: mover_tarea_de_trabajo no suelta la columna del tablero (0024 lo rechazaria)';
  end if;

  raise notice '0031 OK: una tarea se muda de trabajo, con su lista y su historia';
end $$;
