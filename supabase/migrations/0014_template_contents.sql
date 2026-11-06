-- =============================================================================
-- 0014 · Plantillas completas: tareas con todo su contenido y material adjunto
--
-- QUÉ FALTABA
-- Una tarea de plantilla solo tenía título, desplazamiento, duración y
-- prioridad. Las tareas reales tienen además descripción, responsable, lista de
-- comprobación y documentos; de todo eso la plantilla solo podía reproducir el
-- esqueleto, así que «aplicar la plantilla» dejaba veinte títulos vacíos que
-- había que rellenar a mano uno por uno. Era la mitad del trabajo que la
-- plantilla venía a ahorrar.
--
-- Lo que se pide es poder dejar preparada la tarea COMPLETA: en qué consiste,
-- quién la hace, y con qué material. El caso concreto: una tarea «revisión de
-- la memoria» con el guion y la rúbrica adjuntos, igual para todos los
-- estudiantes de ese tipo de trabajo.
--
-- LAS CUATRO DECISIONES DE DISEÑO
--
-- 1. LOS FICHEROS SE ENLAZAN, NO SE COPIAN.
--    Al aplicar una plantilla NO se duplica ningún fichero: la tarea creada
--    guarda de qué tarea de plantilla sale (`tasks.template_task_id`) y de ahí
--    cuelga su material. Tres razones, por orden de peso:
--      · Corregir la rúbrica una vez la corrige para todos los trabajos, en
--        curso incluidos. Con copias habría que repasar veinte trabajos, y
--        nadie lo haría: cada estudiante leería una versión distinta.
--      · El plan gratuito da 1 GB de Storage. Una rúbrica de 2 MB copiada en
--        treinta trabajos son 60 MB por un fichero que es el mismo.
--      · Lo que sí es de cada trabajo —el entregable del estudiante— ya tiene
--        su sitio desde la 0010: `documents` con `task_id`. Son dos cosas
--        distintas y conviene que no se confundan: material de referencia que
--        baja de la plantilla, y entregables que suben del trabajo.
--
-- 2. LA LISTA DE COMPROBACIÓN NO NECESITA NADA NUEVO.
--    En las tareas reales los puntos de la lista son subtareas
--    (`tasks.parent_task_id`, ver 0009), y en las plantillas la jerarquía ya
--    existe con `template_tasks.parent_index`. Una tarea de plantilla con hijos
--    produce, al aplicarse, una tarea con su lista de comprobación. No hay
--    tabla nueva ni política nueva: es la misma decisión de la 0009 llevada
--    hasta aquí.
--
-- 3. EL RESPONSABLE SE GUARDA POR FUNCIÓN, NO POR PERSONA.
--    Una plantilla no puede nombrar a nadie: sirve para trabajos que todavía no
--    existen. Pero sí puede decir «esto lo hace quien dirige» o «esto lo hace
--    el estudiante», y eso es justo lo que distingue una tarea de revisión de
--    una de entrega. `template_tasks.assignee_role_id` apunta a `work_roles`, y
--    al aplicar la plantilla se resuelve contra los participantes activos del
--    trabajo. Si nadie tiene esa función, la tarea queda sin responsable: un
--    plan con una tarea sin asignar es mejor que negarse a crear el plan.
--
-- 4. QUIÉN VE EL MATERIAL: toda la organización, y es a propósito.
--    El material de plantilla es lo contrario de un dato personal: son guiones,
--    rúbricas y formatos pensados para que los lean todos los estudiantes de
--    ese perfil. Así que `template_files` se lee como `templates` —cualquier
--    miembro de la organización— y se escribe como ellas —solo la
--    administración—. Nada de esto debe contener datos de ninguna persona
--    concreta; el aviso está también en la interfaz.
--
-- RIESGO ASUMIDO Y DOCUMENTADO
-- `tasks.template_task_id` es `on delete set null`: borrar una tarea de
-- plantilla NO falla y deja sin material a las tareas ya creadas desde ella,
-- sin rastro de cuál era. Es el mismo peligro que las líneas de investigación
-- de la 0013 (prueba [92]), y se trata igual: la base de datos lo permite y la
-- interfaz avisa antes. Lo que no se hace es ponerlo `restrict`, porque
-- entonces una plantilla vieja no se podría limpiar nunca.
--
-- Y al borrar una tarea de plantilla, sus filas de `template_files` caen con
-- ella (`on delete cascade`) pero los OBJETOS de Storage no: eso lo hace la
-- aplicación antes de borrar la fila. Si falla, quedan bytes huérfanos
-- inaccesibles (las políticas del cubo solo dan acceso por plantilla), no un
-- fichero expuesto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas nuevas
-- -----------------------------------------------------------------------------
alter table template_tasks
  add column if not exists assignee_role_id uuid references work_roles(id) on delete set null;

alter table tasks
  add column if not exists template_task_id uuid references template_tasks(id) on delete set null;

create index if not exists tasks_template_task_id
  on tasks (template_task_id) where template_task_id is not null;

-- -----------------------------------------------------------------------------
-- 2. El material de la plantilla
--
-- Dos orígenes posibles, como en `document_versions` desde la 0002:
-- `storage_path` para un fichero alojado aquí y `external_url` para uno que
-- vive fuera (Drive institucional, la web del departamento). El `check` exige
-- al menos uno: una fila sin ninguno de los dos no es un material, es un
-- registro roto que la interfaz mostraría como un adjunto que no se puede
-- abrir.
--
-- `template_task_id` nulo = material de la plantilla entera (la guía general
-- del TFG), no de una tarea suya.
-- -----------------------------------------------------------------------------
create table if not exists template_files (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references templates(id) on delete cascade,
  template_task_id uuid references template_tasks(id) on delete cascade,
  title            text not null,
  description      text,
  storage_path     text,
  external_url     text,
  mime_type        text,
  size_bytes       bigint,
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  check (storage_path is not null or external_url is not null)
);

create index if not exists template_files_template_id on template_files (template_id);
create index if not exists template_files_task_id
  on template_files (template_task_id) where template_task_id is not null;

-- Un material vinculado a una tarea debe ser de la MISMA plantilla que ella.
-- La integridad referencial no puede expresarlo (son dos caminos distintos
-- hacia `templates`), así que va en un disparador, igual que
-- `app.enforce_document_task_same_work()` de la 0010.
create or replace function app.enforce_template_file_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.template_task_id is not null
     and not exists (
       select 1 from template_tasks
       where id = new.template_task_id and template_id = new.template_id
     ) then
    raise exception 'Ese material pertenece a otra plantilla'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists template_files_scope on template_files;
create trigger template_files_scope
  before insert or update on template_files
  for each row execute function app.enforce_template_file_scope();

-- -----------------------------------------------------------------------------
-- 3. Políticas: se lee como `templates`, se escribe como `templates`
-- -----------------------------------------------------------------------------
alter table template_files enable row level security;

drop policy if exists tfiles_select on template_files;
drop policy if exists tfiles_write on template_files;

create policy tfiles_select on template_files for select to authenticated
  using (exists (
    select 1 from templates t
    where t.id = template_id and t.organization_id in (select app.my_org_ids())
  ));

create policy tfiles_write on template_files for all to authenticated
  using (exists (
    select 1 from templates t
    where t.id = template_id and app.is_org_admin(t.organization_id)
  ))
  with check (exists (
    select 1 from templates t
    where t.id = template_id and app.is_org_admin(t.organization_id)
  ));

-- -----------------------------------------------------------------------------
-- 4. Storage: un cubo propio para el material de plantilla
--
-- No vale reutilizar `work-documents`: sus políticas deducen la autorización
-- del PRIMER SEGMENTO de la ruta, que allí es un `work_id` (0010). Un material
-- de plantilla no pertenece a ningún trabajo, así que su ruta es
-- `<template_id>/<file_id>/<fichero>` y necesita sus propias políticas. Mezclar
-- las dos convenciones en un cubo sería la forma más fácil de abrirlo por error.
--
-- El cubo es PRIVADO también aquí. Podría ser público —es material de
-- referencia— pero público en Supabase significa legible por internet entero
-- sin sesión, y el repositorio de este proyecto es público: la URL del cubo
-- estaría a la vista. Se descarga con URL firmada de duración corta, como todo
-- lo demás.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin esquema storage (entorno de pruebas): se omite el cubo.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'template-files', 'template-files', false,
    10485760,  -- 10 MB: son guiones y rúbricas, no memorias. Y al ser material
               -- compartido por todos los trabajos, conviene que sea ligero.
    array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv', 'text/markdown',
      'image/png', 'image/jpeg',
      'application/zip', 'application/x-tex'
    ]
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  raise notice 'Cubo template-files listo (privado, 10 MB por fichero).';
end $$;

-- Leer: cualquier miembro de la organización dueña de la plantilla. Es el mismo
-- criterio que `tfiles_select`, porque de nada sirve proteger la fila si el
-- fichero se descarga igual.
create or replace function app.can_access_template_object(object_name text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  t uuid;
begin
  -- El primer segmento es la plantilla. Si no es un uuid, la ruta no la ha
  -- generado esta aplicación: se deniega.
  begin
    t := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return exists (
    select 1 from templates
    where id = t and organization_id in (select app.my_org_ids())
  );
end;
$$;

-- Escribir: solo la administración de la organización, igual que `tfiles_write`.
create or replace function app.can_write_template_object(object_name text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  t uuid;
begin
  begin
    t := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return exists (
    select 1 from templates
    where id = t and app.is_org_admin(organization_id)
  );
end;
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Sin storage.objects: se omiten las politicas del cubo.';
    return;
  end if;

  execute 'drop policy if exists template_files_select on storage.objects';
  execute 'drop policy if exists template_files_insert on storage.objects';
  execute 'drop policy if exists template_files_update on storage.objects';
  execute 'drop policy if exists template_files_delete on storage.objects';

  execute $p$
    create policy template_files_select on storage.objects for select to authenticated
      using (bucket_id = 'template-files' and app.can_access_template_object(name))
  $p$;
  execute $p$
    create policy template_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'template-files' and app.can_write_template_object(name))
  $p$;
  execute $p$
    create policy template_files_update on storage.objects for update to authenticated
      using (bucket_id = 'template-files' and app.can_write_template_object(name))
      with check (bucket_id = 'template-files' and app.can_write_template_object(name))
  $p$;
  execute $p$
    create policy template_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'template-files' and app.can_write_template_object(name))
  $p$;

  raise notice 'Politicas del cubo template-files aplicadas.';
end $$;

-- -----------------------------------------------------------------------------
-- 5. `app.apply_template` aprende a resolver el responsable y a dejar el enlace
--
-- SIGUE SIN SER `security definer`, y sigue siendo a propósito (prueba [88]):
-- las inserciones pasan por las políticas de `tasks`, de modo que aplicar una
-- plantilla solo puede hacerlo quien podría teclear esas tareas a mano. Que la
-- función resuelva responsables no cambia nada de eso: `work_members` se lee
-- también a través de RLS.
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
    -- un director principal y un codirector, la tarea de supervisión es del
    -- principal. Si nadie tiene esa función, queda sin responsable a propósito:
    -- negarse a crear el plan por eso sería peor.
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

  return v_total;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Privilegios
--
-- El `revoke` en bloque, otra vez: `alter default privileges ... revoke` no
-- protege a las funciones futuras (comprobado contra PostgreSQL 16, ver el
-- apartado 5 de la 0012), así que toda función nueva en `app` nace ejecutable
-- por PUBLIC —y `anon` es miembro de PUBLIC— hasta que se cierre aquí.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema app from public;
revoke all on all functions in schema app from anon;

grant execute on function app.apply_template(uuid, uuid, date) to authenticated;
grant execute on function app.can_access_template_object(text) to authenticated;
grant execute on function app.can_write_template_object(text) to authenticated;
-- `app.enforce_template_file_scope()` no recibe nada: PostgreSQL no comprueba
-- EXECUTE al disparar un trigger.

-- -----------------------------------------------------------------------------
-- 7. Verificación
-- -----------------------------------------------------------------------------
do $$
declare
  v_abiertas text;
  v_definer  boolean;
begin
  if to_regclass('template_files') is null then
    raise exception 'template_files no existe';
  end if;
  if not exists (
    select 1 from pg_class where relname = 'template_files' and relrowsecurity
  ) then
    raise exception 'template_files sin RLS: seria legible por cualquiera';
  end if;
  if not exists (select 1 from pg_policy where polname = 'tfiles_select') then
    raise exception 'falta la politica tfiles_select';
  end if;
  if not exists (select 1 from pg_policy where polname = 'tfiles_write') then
    raise exception 'falta la politica tfiles_write';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'template_tasks' and column_name = 'assignee_role_id'
  ) then
    raise exception 'template_tasks.assignee_role_id no existe';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'tasks' and column_name = 'template_task_id'
  ) then
    raise exception 'tasks.template_task_id no existe';
  end if;

  -- Que siga sin ser definer no es un detalle: es lo que mantiene el reparto de
  -- permisos al aplicar una plantilla.
  select p.prosecdef into v_definer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'apply_template';
  if v_definer then
    raise exception 'app.apply_template ha pasado a SECURITY DEFINER: eso salta las politicas de tasks';
  end if;

  if not has_function_privilege('authenticated', 'app.can_access_template_object(text)', 'execute') then
    raise exception 'authenticated no puede ejecutar app.can_access_template_object';
  end if;

  -- La comprobación que cazó el agujero de la 0012: ninguna función de `app`
  -- ejecutable por `anon`, se mire como se mire.
  select string_agg(p.proname, ', ') into v_abiertas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and has_function_privilege('anon', p.oid, 'execute');
  if v_abiertas is not null then
    raise exception 'anon puede ejecutar funciones de app: %', v_abiertas;
  end if;

  raise notice 'Migracion 0014 correcta: plantillas con tareas completas y material adjunto.';
end $$;
