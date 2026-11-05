-- =============================================================================
-- ARRANQUE: organización, grupo, curso y primer administrador
--
-- REQUISITO PREVIO: el usuario debe existir ya en Supabase Auth.
--   Panel → Authentication → Users → Add user → Create new user
--   Correo: javier.gomez.pilar@uva.es   ·  marcar «Auto Confirm User»
--
-- Este script NO necesita que copies ningún UUID: localiza al usuario por su
-- correo. Es idempotente: ejecutarlo dos veces no duplica nada.
--
-- Si usas otro correo, cámbialo en la línea marcada más abajo.
-- =============================================================================

do $$
declare
  v_email      text := 'javier.gomez.pilar@uva.es';   -- ← CAMBIA AQUÍ si usas otro correo
  v_nombre     text := 'Javier Gómez Pilar';
  v_depto      text := 'Teoría de la Señal y Comunicaciones';
  v_user_id    uuid;
  v_org_id     uuid;
  v_group_id   uuid;
begin
  -- 1. Localizar al usuario autenticado por su correo.
  select id into v_user_id from auth.users where lower(email) = lower(v_email);

  if v_user_id is null then
    raise exception
      'No existe ningún usuario con el correo %. Créalo primero en Authentication → Users → Add user.',
      v_email;
  end if;

  -- 2. Organización.
  select id into v_org_id from organizations where slug = 'uva';
  if v_org_id is null then
    insert into organizations (name, slug)
    values ('Universidad de Valladolid', 'uva')
    returning id into v_org_id;
    raise notice 'Organización creada.';
  else
    raise notice 'La organización ya existía.';
  end if;

  -- 3. Grupo de investigación.
  select id into v_group_id
  from research_groups
  where organization_id = v_org_id and acronym = 'GIB';
  if v_group_id is null then
    insert into research_groups (organization_id, name, acronym)
    values (v_org_id, 'Grupo de Ingeniería Biomédica', 'GIB')
    returning id into v_group_id;
    raise notice 'Grupo de investigación creado.';
  end if;

  -- 4. Curso académico actual.
  insert into academic_years (organization_id, code, start_date, end_date, is_current)
  values (v_org_id, '2026/2027', '2026-09-01', '2027-08-31', true)
  on conflict (organization_id, code) do nothing;

  -- 5. Titulaciones de partida. Edítalas o amplíalas luego desde la aplicación.
  insert into programs (organization_id, code, name, academic_level) values
    (v_org_id, 'GITI',   'Grado en Ingeniería de Tecnologías de Telecomunicación', 'GRADO'),
    (v_org_id, 'MUIT',   'Máster Universitario en Ingeniería de Telecomunicación', 'MASTER'),
    (v_org_id, 'DOCTIC', 'Programa de Doctorado en Tecnologías de la Información', 'DOCTORADO')
  on conflict (organization_id, code) do nothing;

  -- 6. Líneas de investigación de partida.
  insert into research_lines (organization_id, research_group_id, name) values
    (v_org_id, v_group_id, 'Análisis de señales biomédicas'),
    (v_org_id, v_group_id, 'Neuroimagen funcional')
  on conflict (organization_id, name) do nothing;

  -- 7. Perfil. La fila ya la creó el trigger al nacer el usuario en auth.
  update profiles
  set full_name = v_nombre, department = v_depto
  where id = v_user_id;

  -- 8. Permisos administrativos. Son INDEPENDIENTES de las funciones
  --    académicas: esto no te convierte en director de ningún trabajo.
  insert into organization_members (organization_id, user_id, role)
  values (v_org_id, v_user_id, 'ADMIN')
  on conflict (organization_id, user_id) do update set role = 'ADMIN', is_active = true;

  insert into research_group_members (research_group_id, user_id)
  values (v_group_id, v_user_id)
  on conflict (research_group_id, user_id) do nothing;

  raise notice 'Listo: % es administrador de la organización.', v_email;
end $$;

-- Comprobación. Debe devolver una fila con role = ADMIN.
select p.full_name, p.email, om.role, o.name as organizacion
from profiles p
join organization_members om on om.user_id = p.id
join organizations o on o.id = om.organization_id
where lower(p.email) = lower('javier.gomez.pilar@uva.es');
