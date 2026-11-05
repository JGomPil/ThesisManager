-- =============================================================================
-- seed/0002_demo_data.sql · DATOS DE DEMOSTRACIÓN
--
-- COMPLETAMENTE FICTICIOS. Los correos usan el dominio .invalid, reservado por
-- el RFC 2606 precisamente para ejemplos, de modo que no pueda enviarse correo
-- real a nadie por error.
--
-- NO contiene contraseñas: los usuarios de `auth.users` los crea el
-- administrador por invitación desde el panel de Supabase, y después se
-- ejecuta este fichero sustituyendo los UUID de abajo por los reales.
-- Ver el bloque de instrucciones al final.
--
-- NO ejecutar en producción con datos reales ya cargados.
-- =============================================================================

-- UUID fijos para poder reejecutar el fichero de forma idempotente.
-- Sustitúyelos por los `id` reales de auth.users antes de ejecutar.
--   admin        11111111-1111-1111-1111-111111111111
--   investigador 22222222-2222-2222-2222-222222222222  ← el caso de 3 papeles
--   investigadora 33333333-3333-3333-3333-333333333333
--   4 estudiantes 4444...0001 a 0004

begin;

-- --- Organización y grupo ----------------------------------------------------
insert into organizations (id, name, slug) values
  ('aaaa0000-0000-0000-0000-000000000001', 'Universidad de Valladolid', 'uva')
on conflict (id) do nothing;

insert into research_groups (id, organization_id, name, acronym) values
  ('aaaa0000-0000-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-000000000001',
   'Grupo de Ingeniería Biomédica', 'GIB')
on conflict (id) do nothing;

insert into academic_years (id, organization_id, code, start_date, end_date, is_current) values
  ('aaaa0000-0000-0000-0000-000000000003', 'aaaa0000-0000-0000-0000-000000000001',
   '2026/2027', '2026-09-01', '2027-08-31', true)
on conflict (id) do nothing;

insert into programs (id, organization_id, code, name, academic_level) values
  ('aaaa0000-0000-0000-0000-000000000010', 'aaaa0000-0000-0000-0000-000000000001',
   'GITI', 'Grado en Ingeniería de Tecnologías de Telecomunicación', 'GRADO'),
  ('aaaa0000-0000-0000-0000-000000000011', 'aaaa0000-0000-0000-0000-000000000001',
   'MUIT', 'Máster Universitario en Ingeniería de Telecomunicación', 'MASTER'),
  ('aaaa0000-0000-0000-0000-000000000012', 'aaaa0000-0000-0000-0000-000000000001',
   'DOCTIC', 'Programa de Doctorado en Tecnologías de la Información', 'DOCTORADO')
on conflict (id) do nothing;

insert into research_lines (id, organization_id, research_group_id, name) values
  ('aaaa0000-0000-0000-0000-000000000020', 'aaaa0000-0000-0000-0000-000000000001',
   'aaaa0000-0000-0000-0000-000000000002', 'Análisis de señales biomédicas'),
  ('aaaa0000-0000-0000-0000-000000000021', 'aaaa0000-0000-0000-0000-000000000001',
   'aaaa0000-0000-0000-0000-000000000002', 'Neuroimagen funcional')
on conflict (id) do nothing;

-- --- Perfiles ----------------------------------------------------------------
-- El trigger on_auth_user_created ya habrá creado la fila al invitar al
-- usuario; aquí solo se completan los datos del perfil.
insert into profiles (id, full_name, email, department) values
  ('11111111-1111-1111-1111-111111111111', 'Ana Ficticia Administradora', 'admin@ejemplo.invalid', 'Teoría de la Señal'),
  ('22222222-2222-2222-2222-222222222222', 'Bruno Ficticio Investigador',  'bruno@ejemplo.invalid', 'Teoría de la Señal'),
  ('33333333-3333-3333-3333-333333333333', 'Carmen Ficticia Investigadora','carmen@ejemplo.invalid', 'Teoría de la Señal'),
  ('44440000-0000-0000-0000-000000000001', 'Diego Ficticio Estudiante',    'diego@ejemplo.invalid', null),
  ('44440000-0000-0000-0000-000000000002', 'Elena Ficticia Estudiante',    'elena@ejemplo.invalid', null),
  ('44440000-0000-0000-0000-000000000003', 'Fermín Ficticio Estudiante',   'fermin@ejemplo.invalid', null),
  ('44440000-0000-0000-0000-000000000004', 'Gema Ficticia Estudiante',     'gema@ejemplo.invalid', null)
on conflict (id) do update set full_name = excluded.full_name, department = excluded.department;

-- --- Pertenencia administrativa (independiente de lo académico) -------------
insert into organization_members (organization_id, user_id, role) values
  ('aaaa0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ADMIN'),
  ('aaaa0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'MEMBER'),
  ('aaaa0000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'MEMBER'),
  ('aaaa0000-0000-0000-0000-000000000001', '44440000-0000-0000-0000-000000000001', 'MEMBER'),
  ('aaaa0000-0000-0000-0000-000000000001', '44440000-0000-0000-0000-000000000002', 'MEMBER'),
  ('aaaa0000-0000-0000-0000-000000000001', '44440000-0000-0000-0000-000000000003', 'MEMBER'),
  ('aaaa0000-0000-0000-0000-000000000001', '44440000-0000-0000-0000-000000000004', 'MEMBER')
on conflict (organization_id, user_id) do nothing;

insert into research_group_members (research_group_id, user_id)
select 'aaaa0000-0000-0000-0000-000000000002', user_id
from organization_members where organization_id = 'aaaa0000-0000-0000-0000-000000000001'
on conflict (research_group_id, user_id) do nothing;

-- --- Trabajos ----------------------------------------------------------------
-- Función auxiliar local para no repetir subconsultas.
create or replace function pg_temp.wt(p_code text) returns uuid language sql stable as $$
  select id from work_types where code = p_code order by organization_id nulls last limit 1
$$;
create or replace function pg_temp.ws(p_code text) returns uuid language sql stable as $$
  select id from work_statuses where code = p_code
$$;
create or replace function pg_temp.wr(p_code text) returns uuid language sql stable as $$
  select id from work_roles where code = p_code
$$;

insert into academic_works
  (id, organization_id, research_group_id, work_type_id, status_id, program_id,
   academic_year_id, research_line_id, title, start_date, expected_end_date,
   objectives, progress_override, created_by)
values
  ('bbbb0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001',
   'aaaa0000-0000-0000-0000-000000000002', pg_temp.wt('TFG'), pg_temp.ws('EN_DESARROLLO'),
   'aaaa0000-0000-0000-0000-000000000010', 'aaaa0000-0000-0000-0000-000000000003',
   'aaaa0000-0000-0000-0000-000000000020',
   'Detección automática de artefactos en registros de electroencefalografía',
   '2026-10-01', '2027-06-30',
   'Implementar y validar un método de detección de artefactos oculares y musculares.', 35,
   '11111111-1111-1111-1111-111111111111'),

  ('bbbb0000-0000-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-000000000001',
   'aaaa0000-0000-0000-0000-000000000002', pg_temp.wt('TFG'), pg_temp.ws('EN_PLANIFICACION'),
   'aaaa0000-0000-0000-0000-000000000010', 'aaaa0000-0000-0000-0000-000000000003',
   'aaaa0000-0000-0000-0000-000000000021',
   'Interfaz de visualización de conectividad funcional cerebral',
   '2026-10-15', '2027-07-15',
   'Desarrollar una herramienta de visualización interactiva de matrices de conectividad.', null,
   '11111111-1111-1111-1111-111111111111'),

  ('bbbb0000-0000-0000-0000-000000000003', 'aaaa0000-0000-0000-0000-000000000001',
   'aaaa0000-0000-0000-0000-000000000002', pg_temp.wt('TFM'), pg_temp.ws('EN_REVISION'),
   'aaaa0000-0000-0000-0000-000000000011', 'aaaa0000-0000-0000-0000-000000000003',
   'aaaa0000-0000-0000-0000-000000000020',
   'Modelos de aprendizaje profundo para la clasificación de patrones de sueño',
   '2026-02-01', '2026-11-30',
   'Comparar arquitecturas convolucionales y recurrentes en clasificación automática.', 80,
   '11111111-1111-1111-1111-111111111111'),

  -- La tesis de Bruno: él es el DOCTORANDO de este trabajo.
  ('bbbb0000-0000-0000-0000-000000000004', 'aaaa0000-0000-0000-0000-000000000001',
   'aaaa0000-0000-0000-0000-000000000002', pg_temp.wt('TESIS'), pg_temp.ws('EN_DESARROLLO'),
   'aaaa0000-0000-0000-0000-000000000012', 'aaaa0000-0000-0000-0000-000000000003',
   'aaaa0000-0000-0000-0000-000000000021',
   'Caracterización de la dinámica cerebral mediante medidas de complejidad',
   '2024-01-15', '2027-12-31',
   'Caracterizar la dinámica cortical en distintos estados mediante medidas de complejidad.', 55,
   '11111111-1111-1111-1111-111111111111'),

  -- Academia de Alumnos Internos: sin defensa ni depósito, 9 meses.
  ('bbbb0000-0000-0000-0000-000000000005', 'aaaa0000-0000-0000-0000-000000000001',
   'aaaa0000-0000-0000-0000-000000000002', pg_temp.wt('ACADEMIA'), pg_temp.ws('EN_DESARROLLO'),
   null, 'aaaa0000-0000-0000-0000-000000000003', 'aaaa0000-0000-0000-0000-000000000020',
   'Iniciación al procesado de señales biomédicas con Python',
   '2026-10-01', '2027-06-30',
   'Formarse en el flujo de trabajo del grupo y producir una memoria final.', 20,
   '11111111-1111-1111-1111-111111111111')
on conflict (id) do nothing;

-- --- Participación: EL CASO QUE VALIDA EL MODELO ----------------------------
-- Bruno es, simultáneamente:
--   · director principal de un TFG,
--   · codirector de otro TFG,
--   · ESTUDIANTE (doctorando) de su propia tesis.
-- Una sola cuenta, tres relaciones distintas, permisos independientes.
insert into work_members (work_id, user_id, work_role_id, is_primary) values
  -- TFG 1
  ('bbbb0000-0000-0000-0000-000000000001', '44440000-0000-0000-0000-000000000001', pg_temp.wr('STUDENT'), true),
  ('bbbb0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', pg_temp.wr('PRIMARY_SUPERVISOR'), true),
  ('bbbb0000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', pg_temp.wr('CO_SUPERVISOR'), false),
  -- TFG 2: aquí Bruno es CODIRECTOR
  ('bbbb0000-0000-0000-0000-000000000002', '44440000-0000-0000-0000-000000000002', pg_temp.wr('STUDENT'), true),
  ('bbbb0000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', pg_temp.wr('PRIMARY_SUPERVISOR'), true),
  ('bbbb0000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', pg_temp.wr('CO_SUPERVISOR'), false),
  -- TFM
  ('bbbb0000-0000-0000-0000-000000000003', '44440000-0000-0000-0000-000000000003', pg_temp.wr('STUDENT'), true),
  ('bbbb0000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', pg_temp.wr('PRIMARY_SUPERVISOR'), true),
  -- TESIS: Bruno es el DOCTORANDO; Carmen lo dirige
  ('bbbb0000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', pg_temp.wr('STUDENT'), true),
  ('bbbb0000-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333', pg_temp.wr('PRIMARY_SUPERVISOR'), true),
  -- ACADEMIA
  ('bbbb0000-0000-0000-0000-000000000005', '44440000-0000-0000-0000-000000000004', pg_temp.wr('STUDENT'), true),
  ('bbbb0000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', pg_temp.wr('PRIMARY_SUPERVISOR'), true)
on conflict (work_id, user_id, work_role_id) do nothing;

-- --- Tareas ------------------------------------------------------------------
insert into tasks (work_id, title, assignee_id, status, priority, start_date, due_date, order_index, created_by) values
  ('bbbb0000-0000-0000-0000-000000000001', 'Búsqueda bibliográfica sobre artefactos en EEG',
   '44440000-0000-0000-0000-000000000001', 'COMPLETADA', 'ALTA', '2026-10-01', '2026-10-31', 1,
   '22222222-2222-2222-2222-222222222222'),
  ('bbbb0000-0000-0000-0000-000000000001', 'Preparar el conjunto de datos de trabajo',
   '44440000-0000-0000-0000-000000000001', 'EN_CURSO', 'ALTA', '2026-11-01', '2026-11-30', 2,
   '22222222-2222-2222-2222-222222222222'),
  ('bbbb0000-0000-0000-0000-000000000001', 'Implementar la detección basada en ICA',
   '44440000-0000-0000-0000-000000000001', 'PENDIENTE', 'MEDIA', '2026-12-01', '2027-01-31', 3,
   '22222222-2222-2222-2222-222222222222'),
  -- Una tarea deliberadamente atrasada, para ver los avisos del dashboard.
  ('bbbb0000-0000-0000-0000-000000000003', 'Revisar el capítulo de resultados',
   '44440000-0000-0000-0000-000000000003', 'EN_REVISION', 'URGENTE', '2026-10-01', '2026-10-20', 1,
   '33333333-3333-3333-3333-333333333333'),
  ('bbbb0000-0000-0000-0000-000000000004', 'Redactar el artículo del segundo estudio',
   '22222222-2222-2222-2222-222222222222', 'EN_CURSO', 'ALTA', '2026-09-01', '2026-12-15', 1,
   '33333333-3333-3333-3333-333333333333'),
  ('bbbb0000-0000-0000-0000-000000000005', 'Completar el tutorial de NumPy y SciPy',
   '44440000-0000-0000-0000-000000000004', 'COMPLETADA', 'MEDIA', '2026-10-01', '2026-10-31', 1,
   '22222222-2222-2222-2222-222222222222'),
  ('bbbb0000-0000-0000-0000-000000000005', 'Primer borrador de la memoria final',
   '44440000-0000-0000-0000-000000000004', 'PENDIENTE', 'MEDIA', '2027-04-01', '2027-05-31', 2,
   '22222222-2222-2222-2222-222222222222')
on conflict do nothing;

commit;

-- =============================================================================
-- CÓMO USAR ESTE FICHERO
--
-- 1. Crea los 7 usuarios por invitación desde el panel de Supabase
--    (Authentication → Users → Invite). Recuerda el límite de correos por hora
--    del plan gratuito: hazlo en varias tandas o usa «Create new user».
-- 2. Copia el `id` real de cada usuario desde el panel.
-- 3. Sustituye los UUID de este fichero por los reales (búsqueda y reemplazo).
-- 4. Ejecuta el fichero en el editor SQL de Supabase.
--
-- Qué comprobar después, que es el motivo de que estos datos existan:
--   · Entra como Bruno: debe ver 4 trabajos (dirige 2, codirige 1, es
--     doctorando de 1) y poder actuar de forma distinta en cada uno.
--   · Entra como Diego: debe ver UN solo trabajo y ninguna información de los
--     demás estudiantes.
--   · El dashboard debe mostrar una tarjeta por tipo, incluida «Academia».
-- =============================================================================
