-- =============================================================================
-- 0003_rls_policies.sql
-- Funciones auxiliares de autorización + Row Level Security.
--
-- El repositorio es PÚBLICO y la clave `anon` es pública por diseño: estas
-- políticas son la ÚNICA frontera de seguridad del sistema.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funciones auxiliares.
-- SECURITY DEFINER por dos razones, no por comodidad:
--   1) Rompen la recursión infinita de una política sobre work_members que
--      necesita consultar work_members.
--   2) STABLE ⇒ el planificador las evalúa una vez por consulta, no por fila.
-- search_path fijado para que no puedan ser secuestradas.
-- -----------------------------------------------------------------------------

create or replace function app.uid()
returns uuid language sql stable
set search_path = public, pg_temp
as $$ select auth.uid() $$;

create or replace function app.is_org_admin(org uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from organization_members m
    where m.user_id = auth.uid()
      and m.organization_id = org
      and m.is_active
      and m.role in ('OWNER','ADMIN')
  );
$$;

-- ¿Es administrador de la organización a la que pertenece ESTE trabajo?
create or replace function app.is_admin_of_work(work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from academic_works w
    join organization_members m on m.organization_id = w.organization_id
    where w.id = work
      and m.user_id = auth.uid()
      and m.is_active
      and m.role in ('OWNER','ADMIN')
  );
$$;

create or replace function app.is_work_member(work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from work_members wm
    where wm.work_id = work
      and wm.user_id = auth.uid()
      and wm.status = 'ACTIVE'
      and (wm.end_date is null or wm.end_date >= current_date)
  ) or app.is_admin_of_work(work);
$$;

create or replace function app.is_work_supervisor(work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from work_members wm
    join work_roles r on r.id = wm.work_role_id
    where wm.work_id = work
      and wm.user_id = auth.uid()
      and wm.status = 'ACTIVE'
      and (wm.end_date is null or wm.end_date >= current_date)
      and r.is_supervisory
  );
$$;

-- Unión de capacidades de todas las filas activas (§4 de SECURITY.md),
-- con work_members.permissions como última palabra.
create or replace function app.has_work_capability(work uuid, cap text)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    bool_or(
      coalesce(
        (wm.permissions ->> cap)::boolean,          -- excepción explícita
        case cap
          when 'can_manage_plan'           then r.can_manage_plan
          when 'can_see_private_notes'     then r.can_see_private_notes
          when 'can_validate_deliverables' then r.can_validate_deliverables
          when 'can_manage_members'        then r.can_manage_members
          else false
        end
      )
    ), false)
  from work_members wm
  join work_roles r on r.id = wm.work_role_id
  where wm.work_id = work
    and wm.user_id = auth.uid()
    and wm.status = 'ACTIVE'
    and (wm.end_date is null or wm.end_date >= current_date);
$$;

create or replace function app.can_manage_plan(work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.has_work_capability(work, 'can_manage_plan') or app.is_admin_of_work(work);
$$;

-- Regla de protección del estudiante: si alguna función activa del usuario en
-- este trabajo es de estudiante, NUNCA ve las notas privadas, aunque otra de
-- sus funciones lo permitiera. Caso real: el doctorando que dirige TFG.
create or replace function app.can_see_private_notes(work uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from work_members wm
      join work_roles r on r.id = wm.work_role_id
      where wm.work_id = work and wm.user_id = auth.uid()
        and wm.status = 'ACTIVE' and r.is_student
    ) then false
    else app.has_work_capability(work, 'can_see_private_notes') or app.is_admin_of_work(work)
  end;
$$;

-- Conjunto de trabajos accesibles: propios + todos los de la organización
-- donde el usuario sea administrador.
create or replace function app.accessible_work_ids()
returns setof uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select wm.work_id
  from work_members wm
  where wm.user_id = auth.uid()
    and wm.status = 'ACTIVE'
    and (wm.end_date is null or wm.end_date >= current_date)
  union
  select w.id
  from academic_works w
  join organization_members m
    on m.organization_id = w.organization_id
   and m.user_id = auth.uid()
   and m.is_active
   and m.role in ('OWNER','ADMIN');
$$;

create or replace function app.shares_organization(target uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from organization_members a
    join organization_members b on b.organization_id = a.organization_id
    where a.user_id = auth.uid() and a.is_active
      and b.user_id = target and b.is_active
  );
$$;

create or replace function app.my_org_ids()
returns setof uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select organization_id from organization_members
  where user_id = auth.uid() and is_active;
$$;

revoke all on function app.has_work_capability(uuid, text) from public;

-- =============================================================================
-- RLS: activado en TODAS las tablas. Una tabla sin RLS en Supabase es pública.
-- =============================================================================
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Perfiles y organización
-- -----------------------------------------------------------------------------
create policy profiles_select on profiles for select to authenticated
  using (id = app.uid() or app.shares_organization(id));
create policy profiles_update_self on profiles for update to authenticated
  using (id = app.uid()) with check (id = app.uid());

create policy orgs_select on organizations for select to authenticated
  using (id in (select app.my_org_ids()));

create policy org_members_select on organization_members for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy org_members_write on organization_members for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy groups_select on research_groups for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy groups_write on research_groups for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy group_members_select on research_group_members for select to authenticated
  using (exists (select 1 from research_groups g
                 where g.id = research_group_id
                   and g.organization_id in (select app.my_org_ids())));

-- -----------------------------------------------------------------------------
-- CATÁLOGOS: lectura para cualquier autenticado de la organización
-- (y de los catálogos globales); escritura SOLO administradores.
-- Así un admin crea "Academia de Alumnos Internos" desde la interfaz.
-- -----------------------------------------------------------------------------
create policy levels_select on academic_levels for select to authenticated using (true);

create policy work_types_select on work_types for select to authenticated
  using (organization_id is null or organization_id in (select app.my_org_ids()));
create policy work_types_write on work_types for all to authenticated
  using (organization_id is not null and app.is_org_admin(organization_id))
  with check (organization_id is not null and app.is_org_admin(organization_id));

create policy work_statuses_select on work_statuses for select to authenticated using (true);
create policy work_type_statuses_select on work_type_statuses for select to authenticated using (true);
create policy work_roles_select on work_roles for select to authenticated using (true);

create policy years_select on academic_years for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy years_write on academic_years for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy programs_select on programs for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy programs_write on programs for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy lines_select on research_lines for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy lines_write on research_lines for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy doctypes_select on document_types for select to authenticated
  using (organization_id is null or organization_id in (select app.my_org_ids()));

create policy settings_select on system_settings for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy settings_write on system_settings for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

-- -----------------------------------------------------------------------------
-- Trabajos y participación
-- -----------------------------------------------------------------------------
-- El término `app.is_org_admin(organization_id)` no es redundante con
-- accessible_work_ids(): esa función es STABLE y ve el snapshot del inicio de
-- la sentencia, por lo que en un INSERT ... RETURNING (lo que hace por defecto
-- supabase-js con .insert().select()) la fila nueva todavía no aparece en ella
-- y la política de SELECT fallaría. Al comprobar `organization_id` de la propia
-- fila, la condición no depende del snapshot. De paso evita el auto-JOIN para
-- los administradores.
create policy works_select on academic_works for select to authenticated
  using (
    deleted_at is null
    and (app.is_org_admin(organization_id) or id in (select app.accessible_work_ids()))
  );
create policy works_insert on academic_works for insert to authenticated
  with check (app.is_org_admin(organization_id));
create policy works_update on academic_works for update to authenticated
  using (app.is_org_admin(organization_id) or app.is_work_supervisor(id))
  with check (app.is_org_admin(organization_id) or app.is_work_supervisor(id));
create policy works_delete on academic_works for delete to authenticated
  using (app.is_org_admin(organization_id));

create policy wm_select on work_members for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy wm_write on work_members for all to authenticated
  using (app.is_admin_of_work(work_id) or app.has_work_capability(work_id, 'can_manage_members'))
  with check (app.is_admin_of_work(work_id) or app.has_work_capability(work_id, 'can_manage_members'));

-- -----------------------------------------------------------------------------
-- Planificación
-- -----------------------------------------------------------------------------
create policy phases_select on work_phases for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy phases_write on work_phases for all to authenticated
  using (app.can_manage_plan(work_id)) with check (app.can_manage_plan(work_id));

create policy milestones_select on milestones for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy milestones_write on milestones for all to authenticated
  using (app.can_manage_plan(work_id)) with check (app.can_manage_plan(work_id));

create policy tasks_select on tasks for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy tasks_insert on tasks for insert to authenticated
  with check (app.can_manage_plan(work_id));
create policy tasks_delete on tasks for delete to authenticated
  using (app.can_manage_plan(work_id));
-- El estudiante puede actualizar SU tarea; el trigger de abajo limita a qué
-- columnas. RLS decide SI se puede tocar la fila, no QUÉ columnas.
create policy tasks_update on tasks for update to authenticated
  using (app.can_manage_plan(work_id) or assignee_id = app.uid())
  with check (app.can_manage_plan(work_id) or assignee_id = app.uid());

create or replace function app.enforce_task_update_scope()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if app.can_manage_plan(new.work_id) then
    return new;
  end if;
  -- Sin can_manage_plan solo se permite mover el estado (y su marca temporal).
  if (new.title, new.description, new.assignee_id, new.priority, new.start_date,
      new.due_date, new.work_id, new.parent_task_id, new.milestone_id, new.order_index)
     is distinct from
     (old.title, old.description, old.assignee_id, old.priority, old.start_date,
      old.due_date, old.work_id, old.parent_task_id, old.milestone_id, old.order_index)
  then
    raise exception 'Solo puede actualizarse el estado de la tarea';
  end if;
  return new;
end;
$$;

create trigger tasks_update_scope before update on tasks
  for each row execute function app.enforce_task_update_scope();

create policy taskdeps_select on task_dependencies for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id
                 and t.work_id in (select app.accessible_work_ids())));
create policy taskdeps_write on task_dependencies for all to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and app.can_manage_plan(t.work_id)))
  with check (exists (select 1 from tasks t where t.id = task_id and app.can_manage_plan(t.work_id)));

-- -----------------------------------------------------------------------------
-- Reuniones. El acta compartida la ve el estudiante; las notas privadas, no.
-- -----------------------------------------------------------------------------
create policy meetings_select on meetings for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy meetings_write on meetings for all to authenticated
  using (app.is_work_supervisor(work_id) or app.is_admin_of_work(work_id))
  with check (app.is_work_supervisor(work_id) or app.is_admin_of_work(work_id));

create policy mparts_select on meeting_participants for select to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id
                 and m.work_id in (select app.accessible_work_ids())));
create policy mparts_write on meeting_participants for all to authenticated
  using (exists (select 1 from meetings m where m.id = meeting_id and app.is_work_supervisor(m.work_id)))
  with check (exists (select 1 from meetings m where m.id = meeting_id and app.is_work_supervisor(m.work_id)));

create policy agreements_select on meeting_agreements for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy agreements_write on meeting_agreements for all to authenticated
  using (app.is_work_supervisor(work_id)) with check (app.is_work_supervisor(work_id));

-- LA política crítica del sistema.
create policy private_notes_select on meeting_private_notes for select to authenticated
  using (app.can_see_private_notes(work_id));
create policy private_notes_write on meeting_private_notes for all to authenticated
  using (app.can_see_private_notes(work_id) and author_id = app.uid())
  with check (app.can_see_private_notes(work_id) and author_id = app.uid());

-- -----------------------------------------------------------------------------
-- Documentos
-- -----------------------------------------------------------------------------
create policy docs_select on documents for select to authenticated
  using (deleted_at is null and work_id in (select app.accessible_work_ids()));
create policy docs_write on documents for all to authenticated
  using (app.is_work_member(work_id)) with check (app.is_work_member(work_id));

create policy versions_select on document_versions for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy versions_insert on document_versions for insert to authenticated
  with check (app.is_work_member(work_id) and author_id = app.uid());
-- Cambiar el estado de revisión es acto de supervisión.
create policy versions_update on document_versions for update to authenticated
  using (app.has_work_capability(work_id, 'can_validate_deliverables') or app.is_admin_of_work(work_id))
  with check (app.has_work_capability(work_id, 'can_validate_deliverables') or app.is_admin_of_work(work_id));

create policy doccomments_select on document_comments for select to authenticated
  using (work_id in (select app.accessible_work_ids()));
create policy doccomments_insert on document_comments for insert to authenticated
  with check (app.is_work_member(work_id) and author_id = app.uid());
create policy doccomments_modify on document_comments for update to authenticated
  using (author_id = app.uid()) with check (author_id = app.uid());
create policy doccomments_delete on document_comments for delete to authenticated
  using (author_id = app.uid());

-- -----------------------------------------------------------------------------
-- Comunicación
-- -----------------------------------------------------------------------------
create policy comments_select on comments for select to authenticated
  using (deleted_at is null and work_id in (select app.accessible_work_ids()));
create policy comments_insert on comments for insert to authenticated
  with check (app.is_work_member(work_id) and author_id = app.uid());
create policy comments_update on comments for update to authenticated
  using (author_id = app.uid()) with check (author_id = app.uid());
create policy comments_delete on comments for delete to authenticated
  using (author_id = app.uid());

create policy notifs_select on notifications for select to authenticated
  using (user_id = app.uid());
create policy notifs_update on notifications for update to authenticated
  using (user_id = app.uid()) with check (user_id = app.uid());

create policy logs_select on activity_logs for select to authenticated
  using (work_id in (select app.accessible_work_ids()));

-- -----------------------------------------------------------------------------
-- Plantillas
-- -----------------------------------------------------------------------------
create policy templates_select on templates for select to authenticated
  using (organization_id in (select app.my_org_ids()));
create policy templates_write on templates for all to authenticated
  using (app.is_org_admin(organization_id)) with check (app.is_org_admin(organization_id));

create policy ttasks_select on template_tasks for select to authenticated
  using (exists (select 1 from templates t where t.id = template_id
                 and t.organization_id in (select app.my_org_ids())));
create policy ttasks_write on template_tasks for all to authenticated
  using (exists (select 1 from templates t where t.id = template_id and app.is_org_admin(t.organization_id)))
  with check (exists (select 1 from templates t where t.id = template_id and app.is_org_admin(t.organization_id)));

-- -----------------------------------------------------------------------------
-- Cierre: nada para anon salvo lo que conceda 0004 (keepalive).
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
