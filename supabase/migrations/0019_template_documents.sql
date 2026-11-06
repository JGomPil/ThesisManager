-- =============================================================================
-- 0019 · Documentos previstos en la plantilla
--
-- EL PROBLEMA
-- Una plantilla sabía qué TAREAS hay que hacer y qué material de referencia hay
-- que leer, pero no qué hay que ENTREGAR. Y lo que hay que entregar en un TFG
-- es siempre lo mismo —memoria, anexos, presentación de la defensa— y lo sabe
-- la coordinación, no cada director por su cuenta. Sin esto, cada trabajo
-- empieza con el panel de documentos en blanco y nadie sabe si falta algo hasta
-- que es tarde.
--
-- LA DECISIÓN QUE ESTO REVIERTE, Y CONVIENE LEERLA
-- La 0010 dejó escrito que un documento sin ninguna versión «no significa nada
-- y ensucia el listado», y el formulario de alta llega a borrar la ficha si
-- falla la subida del fichero para no dejarla vacía. A partir de aquí un
-- documento sin versiones SÍ significa algo: «previsto, todavía sin entregar».
-- No es una contradicción, es un significado nuevo: antes solo podía nacer por
-- un error, y ahora nace a propósito. La interfaz tiene que decirlo con esas
-- palabras —«pendiente de entregar»—, porque una ficha vacía sin explicación
-- sigue pareciendo un fallo.
--
-- LO QUE NO SE COPIA
-- El documento del trabajo NO guarda de qué documento previsto salió. El
-- vínculo tarea → plantilla (`tasks.template_task_id`) existe porque de ahí se
-- lee el material de referencia, que vive en la plantilla y se corrige allí. Un
-- documento, en cambio, es del trabajo en cuanto nace: su nombre se cambia, se
-- le suben versiones y se revisa. Guardar el origen solo serviría para sugerir
-- que corregir la plantilla corrige los trabajos ya creados, y no es verdad.
--
-- `is_required` se guarda y se muestra, pero NO bloquea nada: no impide cerrar
-- un trabajo ni mueve ningún indicador. Marcar algo como obligatorio sirve para
-- que se vea que falta, no para que la aplicación se niegue a continuar.
-- =============================================================================

create table if not exists template_documents (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references templates(id) on delete cascade,
  -- El tipo se hereda por el documento creado. Opcional: hay entregables que
  -- no encajan en ninguna categoría del catálogo y obligar a clasificarlos
  -- llenaría el catálogo de categorías de una sola fila.
  document_type_id uuid references document_types(id) on delete set null,
  name             text not null,
  description      text,
  is_required      boolean not null default true,
  order_index      int not null default 0,
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  constraint template_documents_name_no_vacio check (length(btrim(name)) > 0)
);

create index if not exists template_documents_template_idx
  on template_documents (template_id, order_index);

-- Dos documentos previstos con el mismo nombre en la misma plantilla crearían
-- uno solo en el trabajo (el alta salta los nombres repetidos), así que el
-- segundo se perdería sin avisar. Mejor no admitirlo.
create unique index if not exists template_documents_nombre_unico
  on template_documents (template_id, lower(btrim(name)));

-- -----------------------------------------------------------------------------
-- Políticas: se lee como `templates`, se escribe como `templates`
--
-- Igual que `template_files` (0014): lo lee cualquier miembro de la
-- organización —es material común, sin datos de nadie— y lo escribe solo quien
-- administra la organización. No hay nada personal aquí: son nombres de
-- entregables.
-- -----------------------------------------------------------------------------
alter table template_documents enable row level security;

drop policy if exists tdocs_select on template_documents;
drop policy if exists tdocs_write on template_documents;

create policy tdocs_select on template_documents for select to authenticated
  using (exists (
    select 1 from templates t
    where t.id = template_id and t.organization_id in (select app.my_org_ids())
  ));

create policy tdocs_write on template_documents for all to authenticated
  using (exists (
    select 1 from templates t
    where t.id = template_id and app.is_org_admin(t.organization_id)
  ))
  with check (exists (
    select 1 from templates t
    where t.id = template_id and app.is_org_admin(t.organization_id)
  ));

-- -----------------------------------------------------------------------------
-- `app.apply_template` crea también los documentos previstos
--
-- SIGUE SIN SER `security definer`, y sigue siendo el punto importante: la
-- inserción pasa por `docs_insert`, así que los documentos los crea quien
-- podría crearlos a mano. La función no concede nada.
--
-- NO DUPLICA: se salta los nombres que ya existen en el trabajo. Aplicar dos
-- veces una plantilla duplica las tareas —eso ya era así y tiene sentido, son
-- trabajo por hacer— pero no debe duplicar los entregables: «Memoria» es una,
-- y dos fichas con el mismo nombre no se distinguen en el listado.
--
-- El valor devuelto SIGUE SIENDO el número de tareas creadas. Cambiarlo a algo
-- compuesto obligaría a cambiar la firma, el `grant` y la pantalla, y lo único
-- que aporta es un número que la interfaz ya sabe: cuántos documentos tiene la
-- plantilla que acaba de aplicar.
-- -----------------------------------------------------------------------------
create or replace function app.apply_template(p_work uuid, p_template uuid, p_start date default null)
returns integer
language plpgsql
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
  v_asignado    uuid;
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

    -- El responsable se guarda en la plantilla como FUNCIÓN y aquí se resuelve
    -- a la persona que la ejerce en ESTE trabajo. `is_primary` primero: si hay
    -- un director y un codirector, la tarea de supervisión es del primero. Si
    -- nadie tiene esa función, queda sin responsable a propósito: negarse a
    -- crear el plan por eso sería peor.
    v_asignado := null;
    if v_fila.assignee_role_id is not null then
      select wm.user_id into v_asignado
        from work_members wm
       where wm.work_id = p_work
         and wm.work_role_id = v_fila.assignee_role_id
         and wm.status = 'ACTIVE'
       order by wm.is_primary desc, wm.created_at
       limit 1;
    end if;

    insert into tasks (
      work_id, parent_task_id, title, description, priority,
      start_date, due_date, order_index, assignee_id, template_task_id, created_by
    ) values (
      p_work, v_padre, v_fila.title, v_fila.description, v_fila.priority,
      v_inicio + v_fila.offset_days,
      v_inicio + v_fila.offset_days + greatest(v_fila.duration_days, 0),
      v_base + v_fila.order_index, v_asignado, v_fila.id, auth.uid()
    )
    returning id into v_nueva;

    v_padres := v_padres || jsonb_build_object(v_fila.order_index::text, v_nueva);
    v_total := v_total + 1;
  end loop;

  if v_total = 0 then
    raise exception 'Esa plantilla no tiene ninguna tarea.';
  end if;

  -- Los documentos previstos, sin ninguna versión: es la ficha vacía que
  -- significa «pendiente de entregar». La comparación es por nombre
  -- normalizado, y solo ve los documentos NO archivados, porque `docs_select`
  -- filtra `deleted_at is null` y esta función lee a través de RLS. O sea: si
  -- alguien archiva «Memoria» y se vuelve a aplicar la plantilla, «Memoria»
  -- reaparece. Es el precio de no ser `security definer`, y se paga a gusto:
  -- la alternativa es que la función vea filas que quien la llama no ve.
  insert into documents (work_id, document_type_id, name, description, created_by)
  select p_work, td.document_type_id, btrim(td.name), td.description, auth.uid()
    from template_documents td
   where td.template_id = p_template
     and not exists (
       select 1 from documents d
        where d.work_id = p_work
          and lower(btrim(d.name)) = lower(btrim(td.name))
     )
   order by td.order_index;

  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilegios. El `revoke` en bloque, otra vez: `alter default privileges ...
-- revoke` no protege a las funciones futuras (comprobado contra PostgreSQL 16,
-- apartado 5 de la 0012), y `apply_template` se acaba de recrear.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

grant execute on function app.apply_template(uuid, uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Comprobaciones
-- -----------------------------------------------------------------------------
do $$
declare
  v_rls      boolean;
  v_pol      int;
  v_cuerpo   text;
  v_definer  boolean;
  v_anon     boolean;
begin
  select relrowsecurity into v_rls from pg_class where oid = 'public.template_documents'::regclass;
  if not coalesce(v_rls, false) then
    raise exception 'template_documents se ha creado SIN row level security.';
  end if;

  select count(*) into v_pol from pg_policies
   where schemaname = 'public' and tablename = 'template_documents';
  if v_pol <> 2 then
    raise exception 'template_documents deberia tener 2 politicas y tiene %.', v_pol;
  end if;

  -- El cuerpo para saber QUÉ hace; `prosecdef` para saber CON QUÉ PERMISOS lo
  -- hace. Buscar «security definer» en el texto del cuerpo era el error obvio y
  -- me lo comí: el cuerpo lo menciona en un comentario —justo para explicar que
  -- NO lo es— y la comprobación saltó contra una función correcta.
  select prosrc, prosecdef into v_cuerpo, v_definer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'apply_template';
  if v_cuerpo not like '%template_documents%' then
    raise exception 'app.apply_template no crea los documentos previstos.';
  end if;
  if v_definer then
    raise exception 'app.apply_template no debe ser security definer.';
  end if;

  select has_function_privilege('anon', 'app.apply_template(uuid, uuid, date)', 'execute')
    into v_anon;
  if v_anon then
    raise exception 'anon puede ejecutar app.apply_template.';
  end if;

  raise notice 'Migracion 0019 correcta: la plantilla dice tambien que hay que entregar.';
end $$;
