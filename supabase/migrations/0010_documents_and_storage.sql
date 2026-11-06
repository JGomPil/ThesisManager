-- =============================================================================
-- 0010 · Documentos: vínculo opcional con una tarea y almacenamiento de ficheros
--
-- QUÉ YA ESTABA
-- `documents` y `document_versions` existen desde la 0002, con versiones y
-- estados de revisión, y la tabla de versiones ya preveía los dos orígenes:
-- `storage_path` para un fichero alojado aquí y `external_url` para uno que
-- vive fuera (Drive institucional, el repositorio de la universidad), con un
-- `check` de que haya al menos uno de los dos. Esta migración no cambia ese
-- diseño: lo pone en marcha.
--
-- QUÉ AÑADE
--  1. `documents.task_id`: vínculo OPCIONAL con una tarea. Los documentos
--     cuelgan del trabajo, porque una memoria o un artículo pertenecen al
--     trabajo entero y no a una tarea suya; pero poder decir «este borrador es
--     el entregable de esta tarea» es justo lo que se necesita al trabajar.
--     `on delete set null`: borrar una tarea no se lleva por delante el
--     documento.
--  2. El cubo privado de Storage y sus políticas, que son independientes de las
--     de las tablas: `storage.objects` tiene su propia RLS. Sin esto, una fila
--     de `document_versions` protegida apuntaría a un fichero que cualquiera
--     podría descargar.
--  3. El arreglo de `docs_select`, que repetía el fallo de `academic_works`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Vínculo opcional con una tarea
-- -----------------------------------------------------------------------------
alter table documents
  add column if not exists task_id uuid references tasks(id) on delete set null;

create index if not exists documents_task_id on documents (task_id) where task_id is not null;

-- Un documento vinculado a una tarea debe pertenecer al MISMO trabajo que ella.
-- Una restricción de integridad referencial no puede expresar esto (son dos
-- caminos distintos hacia `academic_works`), así que va en un disparador.
create or replace function app.enforce_document_task_same_work()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.task_id is not null
     and not exists (select 1 from tasks where id = new.task_id and work_id = new.work_id) then
    raise exception 'La tarea vinculada pertenece a otro trabajo'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists documents_task_same_work on documents;
create trigger documents_task_same_work
  before insert or update on documents
  for each row execute function app.enforce_document_task_same_work();

revoke all on function app.enforce_document_task_same_work() from public;
revoke all on function app.enforce_document_task_same_work() from anon;

-- -----------------------------------------------------------------------------
-- 2. `docs_select` y el mismo fallo que tenía `academic_works`
--
-- La política llevaba `deleted_at is null`, y PostgreSQL exige que la fila
-- resultante de un UPDATE siga siendo visible para quien lo ejecuta: archivar
-- un documento habría fallado igual que fallaba archivar un trabajo (§5.2.quater
-- de SECURITY.md), y si hubiera funcionado habría sido irreversible. Quien
-- valida entregables, y la administración, ven también lo archivado.
-- -----------------------------------------------------------------------------
alter policy docs_select on documents
  using (
    work_id in (select app.accessible_work_ids())
    and (
      deleted_at is null
      -- `created_by` no es un añadido cosmético: sin él, el autor no puede
      -- retirar su propio documento. Al poner `deleted_at`, la fila dejaría de
      -- serle visible y PostgreSQL rechaza el UPDATE. Lo detectó la prueba [57].
      or created_by = app.uid()
      or app.has_work_capability(work_id, 'can_validate_deliverables')
      or app.is_admin_of_work(work_id)
    )
  );

-- REGLA GENERAL, aprendida a base de tropezar tres veces con ella:
-- toda política de SELECT que filtre por `deleted_at` debe dejar ver lo
-- archivado a TODOS los que puedan archivarlo. Si no, el borrado lógico falla
-- con «new row violates row-level security policy», porque PostgreSQL exige
-- que la fila resultante de un UPDATE siga siendo visible para quien lo hace.
-- Y si por algún camino llegara a archivarse, sería irrecuperable.

-- -----------------------------------------------------------------------------
-- 2.bis. `docs_write` era demasiado ancha
--
-- La política original era una sola, `for all`, con `app.is_work_member(work_id)`
-- tanto en `using` como en `with check`. Eso significa que CUALQUIER
-- participante del trabajo podía modificar y BORRAR cualquier documento: un
-- estudiante podía hacer desaparecer la memoria que había subido su director.
-- No es un escenario rebuscado: es un clic en un icono de papelera.
--
-- Se parte en tres, con el reparto que corresponde:
--   · INSERT  cualquier participante (el estudiante debe poder entregar),
--   · UPDATE  su propio autor, quien valida entregables, o la administración,
--   · DELETE  solo quien valida entregables o la administración.
--
-- Que el autor pueda modificar el suyo es a propósito: debe poder retirar o
-- corregir lo que acaba de subir. Lo que no puede es tocar lo de los demás.
-- -----------------------------------------------------------------------------
drop policy if exists docs_write on documents;

create policy docs_insert on documents for insert to authenticated
  with check (app.is_work_member(work_id) or app.is_admin_of_work(work_id));

create policy docs_update on documents for update to authenticated
  using (
    created_by = app.uid()
    or app.has_work_capability(work_id, 'can_validate_deliverables')
    or app.is_admin_of_work(work_id)
  )
  with check (
    created_by = app.uid()
    or app.has_work_capability(work_id, 'can_validate_deliverables')
    or app.is_admin_of_work(work_id)
  );

create policy docs_delete on documents for delete to authenticated
  using (
    app.has_work_capability(work_id, 'can_validate_deliverables')
    or app.is_admin_of_work(work_id)
  );

-- -----------------------------------------------------------------------------
-- 3. Storage
--
-- Convención de ruta: <work_id>/<document_id>/<nombre de fichero>
-- El primer segmento es la llave de autorización: de él se deduce a qué
-- trabajo pertenece el objeto, y con eso basta para reutilizar
-- `app.accessible_work_ids()` sin duplicar ninguna regla.
--
-- El cubo es PRIVADO. Las descargas se hacen con URL firmadas de duración
-- corta, generadas por la aplicación con la clave pública: Storage solo las
-- emite si estas políticas dejan leer el objeto.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Sin esquema storage (entorno de pruebas): se omite la parte de ficheros.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'work-documents', 'work-documents', false,
    26214400,  -- 25 MB por fichero: de sobra para memorias y artículos, y deja
               -- margen dentro del 1 GB del plan gratuito.
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

  raise notice 'Cubo work-documents listo (privado, 25 MB por fichero).';
end $$;

-- Función de autorización reutilizada por las cuatro políticas del cubo.
-- Se declara siempre, también en el entorno de pruebas, para poder verificarla.
create or replace function app.can_access_storage_object(object_name text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  w uuid;
begin
  -- El primer segmento de la ruta es el trabajo. Si no es un uuid válido, la
  -- ruta no la ha generado la aplicación: se deniega.
  begin
    w := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return w in (select app.accessible_work_ids());
end;
$$;

revoke all on function app.can_access_storage_object(text) from public;
revoke all on function app.can_access_storage_object(text) from anon;
grant execute on function app.can_access_storage_object(text) to authenticated;

-- Quien puede gestionar el plan del trabajo, o es miembro, puede subir; el
-- detalle de quién sube qué lo marca `document_versions.author_id`, cuya
-- política ya exige `author_id = app.uid()`.
create or replace function app.can_write_storage_object(object_name text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  w uuid;
begin
  begin
    w := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return app.is_work_member(w) or app.is_admin_of_work(w);
end;
$$;

revoke all on function app.can_write_storage_object(text) from public;
revoke all on function app.can_write_storage_object(text) from anon;
grant execute on function app.can_write_storage_object(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Sin storage.objects: se omiten las politicas del cubo.';
    return;
  end if;

  execute 'drop policy if exists work_documents_select on storage.objects';
  execute 'drop policy if exists work_documents_insert on storage.objects';
  execute 'drop policy if exists work_documents_update on storage.objects';
  execute 'drop policy if exists work_documents_delete on storage.objects';

  execute $p$
    create policy work_documents_select on storage.objects for select to authenticated
      using (bucket_id = 'work-documents' and app.can_access_storage_object(name))
  $p$;
  execute $p$
    create policy work_documents_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'work-documents' and app.can_write_storage_object(name))
  $p$;
  execute $p$
    create policy work_documents_update on storage.objects for update to authenticated
      using (bucket_id = 'work-documents' and app.can_write_storage_object(name))
      with check (bucket_id = 'work-documents' and app.can_write_storage_object(name))
  $p$;
  execute $p$
    create policy work_documents_delete on storage.objects for delete to authenticated
      using (bucket_id = 'work-documents' and app.can_write_storage_object(name))
  $p$;

  raise notice 'Politicas del cubo work-documents aplicadas.';
end $$;

-- -----------------------------------------------------------------------------
-- 4. Verificación
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'documents' and column_name = 'task_id'
  ) then
    raise exception 'documents.task_id no existe';
  end if;
  if not has_function_privilege('authenticated', 'app.can_access_storage_object(text)', 'execute') then
    raise exception 'authenticated no puede ejecutar app.can_access_storage_object';
  end if;
  if has_function_privilege('anon', 'app.can_access_storage_object(text)', 'execute') then
    raise exception 'anon puede ejecutar app.can_access_storage_object';
  end if;
  raise notice 'Migracion 0010 correcta.';
end $$;
