-- =============================================================================
-- 0012 · Planificación avanzada (Fase 3): integridad del grafo de tareas,
--        hitos y aplicación atómica de plantillas.
--
-- El esquema de la Fase 3 ya estaba en la 0002 (milestones, task_dependencies,
-- templates, template_tasks) y sus políticas en la 0003. Al implementar la fase
-- aparecieron TRES huecos que no son de permisos sino de integridad, y que la
-- interfaz no puede cerrar porque cualquiera puede hablar con PostgREST
-- directamente.
--
-- -----------------------------------------------------------------------------
-- 1. LOS CICLOS SE VALIDABAN «EN APLICACIÓN»
--
-- La 0002 lo dejó escrito en un comentario: `check (task_id <> depends_on_task_id)
-- -- los ciclos se validan en aplicación`. Eso impide A→A, pero no A→B→A ni
-- nada más largo. Y un ciclo no es un dato feo: es un dato que CUELGA a quien lo
-- lea. El recorrido del grafo para ordenar el Gantt, para calcular qué tarea
-- está bloqueada o para propagar una fecha entra en bucle infinito. Da igual lo
-- cuidadosa que sea la interfaz: dos peticiones REST seguidas desde cualquier
-- cliente, o dos personas planificando a la vez, crean el ciclo igual.
--
-- Se valida con un CTE recursivo en un disparador. `cycle` de PostgreSQL corta
-- el recorrido en cuanto repite un nodo, así que la comprobación termina
-- siempre, incluso si por cualquier razón ya hubiera un ciclo en la tabla.
--
-- -----------------------------------------------------------------------------
-- 2. UNA TAREA PODÍA DEPENDER DE UNA TAREA DE OTRO TRABAJO
--
-- `taskdeps_write` comprobaba `app.can_manage_plan` sobre el trabajo de
-- `task_id` y no miraba `depends_on_task_id`. Con dirigir un trabajo bastaba
-- para colgar una dependencia de una tarea de un trabajo ajeno, posiblemente
-- invisible para quien la crea. Consecuencias: el Gantt de un trabajo
-- mostraría un vínculo que apunta a la nada (la fila de la otra tarea no pasa
-- el filtro de RLS), y el estado «bloqueada» de una tarea dependería de algo
-- que su propio equipo no puede ver ni desbloquear.
--
-- Se cierra por los dos lados: la política ahora exige permiso en AMBOS
-- extremos, y un disparador exige además que los dos sean del MISMO trabajo.
-- Son cosas distintas: la política dice quién puede escribir; el disparador,
-- qué es un dato válido. Un administrador de la organización pasa la política
-- para dos trabajos suyos y sigue sin poder cruzarlos.
--
-- -----------------------------------------------------------------------------
-- 3. APLICAR UNA PLANTILLA DESDE EL CLIENTE NO ERA ATÓMICO
--
-- Una plantilla son N tareas con jerarquía. Hacerlo con N inserciones desde el
-- navegador tiene dos problemas: si la quinta falla queda medio plan creado y
-- nadie sabe cuál era el estado bueno; y `template_tasks.parent_index` apunta
-- al `order_index` del padre DENTRO de la plantilla, de modo que el cliente
-- tendría que ir resolviendo identificadores reales a mitad de la secuencia.
--
-- `app.apply_template(...)` lo hace en una sola sentencia, dentro de una sola
-- transacción: o está el plan entero o no está nada.
--
-- OJO A LO QUE **NO** ES: no lleva `security definer`. Se ejecuta con los
-- privilegios de quien llama, así que las políticas de `tasks` siguen
-- decidiendo. Un estudiante que la invoque sobre su propio trabajo es
-- rechazado por `tasks_insert`, igual que si insertara a mano. Ponerle
-- `security definer` para «que funcione» habría convertido una comodidad en un
-- agujero: cualquiera podría llenar de tareas el trabajo de cualquiera.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Ciclos en el grafo de dependencias
-- -----------------------------------------------------------------------------
create or replace function app.assert_no_dependency_cycle()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ciclo boolean;
begin
  -- ¿Se puede llegar desde `depends_on_task_id` hasta `task_id` siguiendo las
  -- dependencias? Si se puede, la fila nueva cierra el círculo.
  --
  -- La fila ya está insertada cuando corre el disparador (`after insert`), así
  -- que el recorrido la incluye sin sumarla a mano. La cláusula `cycle` del
  -- estándar deja de expandir un nodo en cuanto se repite, de modo que el
  -- recorrido TERMINA siempre: también si la tabla ya tuviera un ciclo de antes
  -- de esta migración, que es justo el caso en el que un CTE recursivo ingenuo
  -- se quedaría colgado comprobando si puede colgarse.
  with recursive camino(nodo) as (
    select new.depends_on_task_id
    union all
    select d.depends_on_task_id
    from camino c
    join task_dependencies d on d.task_id = c.nodo
  ) cycle nodo set es_ciclo using ruta
  select exists (select 1 from camino where nodo = new.task_id) into v_ciclo;

  if v_ciclo then
    raise exception 'Esa dependencia crearía un ciclo: la tarea acabaría dependiendo de sí misma a través de otras. Revisa el orden del plan.';
  end if;

  return null;
end;
$$;

drop trigger if exists taskdeps_no_cycle on task_dependencies;
create trigger taskdeps_no_cycle
  after insert or update on task_dependencies
  for each row execute function app.assert_no_dependency_cycle();

-- -----------------------------------------------------------------------------
-- 2. Las dos tareas de una dependencia son del mismo trabajo
-- -----------------------------------------------------------------------------
create or replace function app.enforce_dependency_same_work()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_a uuid;
  v_b uuid;
begin
  -- Lectura directa de `tasks`, sin pasar por RLS: este disparador comprueba un
  -- invariante del dato, no un permiso. Quién puede escribir lo decide
  -- `taskdeps_write`. Por eso la función es `security definer` aunque la de
  -- plantillas no lo sea: aquí se trata de leer dos `work_id` para compararlos,
  -- no de conceder nada.
  select work_id into v_a from tasks where id = new.task_id;
  select work_id into v_b from tasks where id = new.depends_on_task_id;

  if v_a is null or v_b is null then
    raise exception 'Alguna de las dos tareas de la dependencia no existe.';
  end if;

  if v_a <> v_b then
    raise exception 'Una tarea solo puede depender de otra tarea del MISMO trabajo. Las dependencias entre trabajos distintos crearían vínculos que el equipo no puede ver ni resolver.';
  end if;

  return new;
end;
$$;
alter function app.enforce_dependency_same_work() security definer;

drop trigger if exists taskdeps_same_work on task_dependencies;
create trigger taskdeps_same_work
  before insert or update on task_dependencies
  for each row execute function app.enforce_dependency_same_work();

-- Permiso en AMBOS extremos, no solo en el que se escribe.
alter policy taskdeps_select on task_dependencies
  using (
    exists (select 1 from tasks t where t.id = task_id
            and t.work_id in (select app.accessible_work_ids()))
  );

alter policy taskdeps_write on task_dependencies
  using (
    exists (select 1 from tasks t where t.id = task_id and app.can_manage_plan(t.work_id))
    and exists (select 1 from tasks t where t.id = depends_on_task_id and app.can_manage_plan(t.work_id))
  )
  with check (
    exists (select 1 from tasks t where t.id = task_id and app.can_manage_plan(t.work_id))
    and exists (select 1 from tasks t where t.id = depends_on_task_id and app.can_manage_plan(t.work_id))
  );

-- -----------------------------------------------------------------------------
-- 3. Hitos: `met_at` lo pone la base de datos
--
-- `is_met` y `met_at` son dos columnas que cuentan lo mismo, y dos columnas que
-- cuentan lo mismo se desincronizan en cuanto haya dos sitios que las escriban
-- (la interfaz, un script de importación, una corrección a mano en el panel de
-- Supabase). La fecha de cumplimiento la pone el disparador a partir del
-- booleano, y así no hay forma de tener un hito cumplido sin fecha ni una fecha
-- de cumplimiento en un hito pendiente.
-- -----------------------------------------------------------------------------
create or replace function app.set_milestone_met_at()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.is_met and (old is null or not old.is_met) then
    new.met_at := now();
  elsif not new.is_met then
    new.met_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists milestones_met_at on milestones;
create trigger milestones_met_at
  before insert or update on milestones
  for each row execute function app.set_milestone_met_at();

-- -----------------------------------------------------------------------------
-- 4. Aplicación atómica de una plantilla
-- -----------------------------------------------------------------------------
create or replace function app.apply_template(
  p_work     uuid,
  p_template uuid,
  p_start    date default null
)
returns int
language plpgsql
-- SIN `security definer`: ver la cabecera del fichero. Las políticas de `tasks`
-- siguen mandando, de modo que planificar sigue siendo cosa de quien puede
-- planificar.
set search_path = public, pg_temp
as $$
declare
  v_inicio      date;
  v_work_type   uuid;
  v_tpl_type    uuid;
  v_tpl_org     uuid;
  v_work_org    uuid;
  v_fila        record;
  v_nueva       uuid;
  v_padres      jsonb := '{}'::jsonb;   -- order_index de la plantilla -> uuid creado
  v_padre       uuid;
  v_base        int;
  v_total       int := 0;
begin
  -- Se leen trabajo y plantilla a través de RLS a propósito: si quien llama no
  -- puede ver uno de los dos, la función no debe decirle si existe.
  select work_type_id, start_date, organization_id
    into v_work_type, v_inicio, v_work_org
    from academic_works where id = p_work;
  if not found then
    raise exception 'El trabajo no existe o no tienes acceso a él.';
  end if;

  select work_type_id, organization_id into v_tpl_type, v_tpl_org
    from templates where id = p_template and is_active;
  if not found then
    raise exception 'La plantilla no existe, no está activa o no tienes acceso a ella.';
  end if;

  if v_tpl_org <> v_work_org then
    raise exception 'La plantilla pertenece a otra organización.';
  end if;

  -- Una plantilla sin tipo sirve para cualquier trabajo; con tipo, solo para el
  -- suyo. Aplicar la plantilla de un TFG a una tesis daría un plan sin sentido,
  -- y el usuario no tendría forma de saber por qué le ha salido así.
  if v_tpl_type is not null and v_tpl_type <> v_work_type then
    raise exception 'Esa plantilla es de otro tipo de trabajo.';
  end if;

  -- Orden de preferencia para el día cero del plan: lo que pida quien llama,
  -- el inicio real del trabajo, y por último hoy.
  v_inicio := coalesce(p_start, v_inicio, current_date);

  -- `order_index` fija el orden, y `parent_index` apunta al `order_index` del
  -- padre dentro de la MISMA plantilla. Se recorre en orden para que el padre
  -- exista siempre antes que el hijo; si una plantilla apunta hacia adelante,
  -- se dice en vez de dejar la tarea suelta sin avisar.
  select coalesce(max(order_index), -1) + 1 into v_base
    from tasks where work_id = p_work and parent_task_id is null;

  for v_fila in
    select * from template_tasks where template_id = p_template order by order_index
  loop
    v_padre := null;
    if v_fila.parent_index is not null then
      v_padre := (v_padres ->> v_fila.parent_index::text)::uuid;
      if v_padre is null then
        raise exception 'La plantilla está mal formada: la tarea «%» dice depender de la posición % de la plantilla, que todavía no se ha creado. El padre debe ir antes que el hijo.',
          v_fila.title, v_fila.parent_index;
      end if;
    end if;

    insert into tasks (
      work_id, parent_task_id, title, description, priority,
      start_date, due_date, order_index, created_by
    ) values (
      p_work, v_padre, v_fila.title, v_fila.description, v_fila.priority,
      v_inicio + v_fila.offset_days,
      v_inicio + v_fila.offset_days + greatest(v_fila.duration_days, 0),
      v_base + v_fila.order_index, auth.uid()
    )
    returning id into v_nueva;

    v_padres := v_padres || jsonb_build_object(v_fila.order_index::text, v_nueva);
    v_total := v_total + 1;
  end loop;

  if v_total = 0 then
    raise exception 'Esa plantilla no tiene ninguna tarea.';
  end if;

  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Privilegios de las funciones nuevas
--
-- LA 0007 NO PROTEGE A LAS FUNCIONES FUTURAS, AUNQUE LO PARECÍA. Termina con:
--
--     alter default privileges in schema app revoke all on functions from public;
--
-- que se lee como «y las que vengan, también». No es verdad. Comprobado contra
-- PostgreSQL 16: esa sentencia no deja ninguna fila en `pg_default_acl`, y una
-- función creada después sigue siendo ejecutable por `anon`, que es miembro de
-- PUBLIC. Las tres funciones de disparador de esta migración nacieron abiertas
-- a `anon` por esto mismo.
--
-- No lo descubrí leyendo: lo cazó la prueba estructural [33], que recorre todas
-- las funciones del esquema `app` y exige que `anon` no pueda ejecutar ninguna.
-- Es la segunda vez que una prueba estructural encuentra un agujero de
-- privilegios que la lectura del SQL no veía (la primera, `SECURITY.md`
-- §5.2.ter). De ahí la regla para las migraciones siguientes:
--
--   TODA migración que cree funciones en `app` termina con el `revoke` en
--   bloque de abajo y concede después, una por una, solo las que hagan falta.
--
-- El `revoke` en bloque es inmediato y no toca lo concedido a `authenticated`,
-- así que no deshace los permisos de la 0007: solo cierra lo que PUBLIC abre
-- por su cuenta cada vez que se crea una función. Las de disparador no
-- necesitan permiso alguno —PostgreSQL no comprueba EXECUTE al dispararlas—,
-- de modo que se quedan sin conceder.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

grant execute on function app.apply_template(uuid, uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Envoltura en `public`, porque PostgREST no ve el esquema `app`
--
-- PostgREST solo expone los esquemas configurados, y en Supabase son `public`,
-- `graphql_public` y `storage`. `app` queda fuera a propósito: es donde viven
-- los ayudantes de las políticas, y no tendría ningún sentido que un cliente
-- pudiera llamarlos. Pero eso significa que `supabase.rpc('apply_template')`
-- NO encontraría la función: aplicar una plantilla desde la interfaz sería
-- imposible.
--
-- De ahí esta envoltura de una línea en `public`. No añade ningún privilegio:
-- tampoco lleva `security definer`, así que la cadena entera —envoltura,
-- función y las inserciones en `tasks`— se ejecuta con los permisos de quien
-- llama. Lo que sí hay que recordar es que todo lo que vive en `public` SÍ lo
-- ve PostgREST, y por tanto también el rol `anon`; de ahí los `revoke`.
-- -----------------------------------------------------------------------------
create or replace function public.apply_template(
  p_work uuid, p_template uuid, p_start date default null
)
returns int language sql
set search_path = public, pg_temp
as $$ select app.apply_template(p_work, p_template, p_start) $$;

revoke all on function public.apply_template(uuid, uuid, date) from public;
revoke all on function public.apply_template(uuid, uuid, date) from anon;
grant execute on function public.apply_template(uuid, uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Comprobaciones de la propia migración
-- -----------------------------------------------------------------------------
do $$
declare
  v_disparadores int;
  v_definer      boolean;
  v_anon         boolean;
begin
  select count(*) into v_disparadores from pg_trigger
   where not tgisinternal
     and tgname in ('taskdeps_no_cycle', 'taskdeps_same_work', 'milestones_met_at');
  if v_disparadores <> 3 then
    raise exception 'Faltan disparadores de la 0012: hay %, se esperaban 3.', v_disparadores;
  end if;

  -- Que `apply_template` NO sea security definer es parte del contrato de
  -- seguridad, no una preferencia de estilo. Se comprueba aquí para que nadie
  -- lo cambie «para que funcione» sin que salte nada.
  select prosecdef into v_definer from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'apply_template';
  if v_definer then
    raise exception 'app.apply_template no debe ser SECURITY DEFINER: dejaría planificar a quien no puede.';
  end if;

  select has_function_privilege('anon', p.oid, 'execute') into v_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'apply_template';
  if v_anon then
    raise exception 'anon no debe poder ejecutar app.apply_template.';
  end if;

  select prosecdef into v_definer from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_template';
  if v_definer then
    raise exception 'public.apply_template no debe ser SECURITY DEFINER.';
  end if;
  if has_function_privilege('anon', 'public.apply_template(uuid,uuid,date)', 'execute') then
    raise exception 'anon no debe poder ejecutar public.apply_template.';
  end if;

  -- Que ninguna función del esquema quede abierta a `anon`, no solo las de
  -- esta migración: si la siguiente olvida el `revoke`, salta aquí.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception 'Alguna función de app es ejecutable por anon.';
  end if;

  raise notice 'Migracion 0012 correcta: 3 disparadores, apply_template con privilegios de quien llama, nada abierto a anon.';
end;
$$;
