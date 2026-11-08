-- =============================================================================
-- 0026 · Un color por tarea
--
-- QUE RESUELVE
-- Con las columnas libres de la 0024, el tablero contesta «¿donde esta esto?».
-- Falta la otra pregunta, la que cruza con esa: «¿de que es?». En un plan con
-- treinta tareas repartidas en «Papers», «Estudios» y «Escritura», lo que no se
-- ve de un vistazo es cuales son del mismo asunto, o cuales son las dos que hay
-- que sacar esta semana.
--
-- Es la etiqueta de color de Trello, con una diferencia deliberada: NO LLEVA
-- NOMBRE NI SIGNIFICADO. Un color no declara nada, igual que una columna no
-- declara nada (0024): quien planifica decide que quiere decir el violeta, y la
-- aplicacion no tiene ninguna opinion. Lo unico que hace con el color es
-- pintarlo y dejar filtrar por el.
--
-- `color` es `text` nullable y sin `check`: el catalogo de tonos vive en
-- `src/lib/utils.ts` y lo comprueba `scripts/check-tones.sh` sobre el CSS
-- compilado. Un `check` aqui obligaria a una migracion para añadir un color, y
-- un tono que no exista pinta gris por `toneClass`, que es la degradacion
-- correcta: una tarjeta con un color viejo se sigue leyendo.
--
-- NULL es «sin color», y es el valor de todas las tareas que ya existen: esto
-- no cambia ni una pantalla hasta que alguien pinte algo.
-- =============================================================================

alter table tasks add column if not exists color text;

-- -----------------------------------------------------------------------------
-- El color lo pone quien planifica
-- -----------------------------------------------------------------------------
-- Se reescribe `app.enforce_task_update_scope` (venia de la 0025) para añadir
-- `color` a la lista de campos protegidos.
--
-- POR QUE AQUI SI Y EN `board_column_id` NO: mover una tarjeta es informar de
-- por donde va lo tuyo, y el gesto es de quien hace el trabajo. Pintarla es
-- clasificar el plan entero con un criterio que solo conoce quien lo hizo —el
-- color no significa nada por si mismo—, asi que si cada cual pintara el suyo,
-- el criterio dejaria de existir y nadie veria un error: solo colores que no
-- quieren decir nada.
--
-- Si no se añadiera a la lista, el estudiante podria pintar su tarea y esto no
-- daria ningun aviso: la columna no esta protegida por defecto, lo esta por
-- figurar aqui.
create or replace function app.enforce_task_update_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if app.can_manage_plan(new.work_id) then
    return new;
  end if;
  if (new.title, new.description, new.assignee_id, new.priority, new.start_date,
      new.due_date, new.work_id, new.parent_task_id, new.milestone_id,
      new.deleted_at, new.color)
     is distinct from
     (old.title, old.description, old.assignee_id, old.priority, old.start_date,
      old.due_date, old.work_id, old.parent_task_id, old.milestone_id,
      old.deleted_at, old.color)
  then
    raise exception 'Solo puede actualizarse el estado de la tarea y su sitio en el tablero';
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_task_update_scope() from public;

-- -----------------------------------------------------------------------------
-- Autocomprobaciones
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'color'
  ) then
    raise exception '0026: falta tasks.color';
  end if;
  -- La lista de campos protegidos es lo unico que impide que cualquiera repinte
  -- el plan, y es una lista escrita a mano: se comprueba que `color` este.
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'enforce_task_update_scope') not like '%color%' then
    raise exception '0026: enforce_task_update_scope no protege color; cualquiera podria repintar el plan';
  end if;
  -- Y que no se haya perdido lo que protegia antes, que es el riesgo de
  -- reescribir una funcion entera en cada migracion.
  if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'enforce_task_update_scope') not like '%deleted_at%' then
    raise exception '0026: la reescritura ha perdido la proteccion de deleted_at (0025)';
  end if;
  raise notice 'CORRECTO: 0026 un color por tarea, sin significado';
end $$;
