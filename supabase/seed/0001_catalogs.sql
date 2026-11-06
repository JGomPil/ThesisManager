-- =============================================================================
-- seed/0001_catalogs.sql
-- Catálogos iniciales. Ningún dato personal: solo configuración.
-- Todo lo de aquí es editable después desde la interfaz de administración.
-- =============================================================================

insert into academic_levels (code, name, display_order) values
  ('GRADO',     'Grado',     1),
  ('MASTER',    'Máster',    2),
  ('DOCTORADO', 'Doctorado', 3),
  ('OTRO',      'Otro',      4)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Tipos de trabajo. Catálogo GLOBAL (organization_id = NULL).
-- Añadir "Prácticas de empresa", "Estancia de investigación", "Beca de
-- colaboración"… es un INSERT desde la UI: ninguna migración, ningún despliegue.
-- -----------------------------------------------------------------------------
insert into work_types (
  organization_id, code, name, short_name, academic_level, color, icon, display_order,
  default_duration_months, requires_defense, requires_deposit, requires_program,
  allows_multiple_students, max_supervisors, counts_toward_workload
) values
  (null, 'TFG',      'Trabajo de Fin de Grado',        'TFG',      'GRADO',     'blue',   'graduation-cap', 1,  9, true,  true,  true,  false, 3, true),
  (null, 'TFM',      'Trabajo de Fin de Máster',       'TFM',      'MASTER',    'violet', 'scroll-text',    2,  9, true,  true,  true,  false, 3, true),
  (null, 'TESIS',    'Tesis doctoral',                 'Tesis',    'DOCTORADO', 'amber',  'book-open',      3, 48, true,  true,  true,  false, 3, true),
  -- Academia de Alumnos Internos (reglas confirmadas por el responsable del
  -- grupo): sin acto de defensa ni depósito oficial, sin titulación asociada,
  -- duración igual que un TFG (9 meses) y una memoria final como entregable
  -- principal, además de entregables opcionales.
  (null, 'ACADEMIA', 'Academia de Alumnos Internos',   'Academia', 'GRADO',     'emerald','users',          4,  9, false, false, false, false, 2, true)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Estados del trabajo
-- -----------------------------------------------------------------------------
insert into work_statuses (code, name, color, display_order, is_terminal) values
  ('PROPUESTA',          'Propuesta',             'slate',   1, false),
  ('ASIGNADO',           'Asignado',              'sky',     2, false),
  ('EN_PLANIFICACION',   'En planificación',      'cyan',    3, false),
  ('EN_DESARROLLO',      'En desarrollo',         'blue',    4, false),
  ('EN_REVISION',        'En revisión',           'amber',   5, false),
  ('PENDIENTE_DEPOSITO', 'Pendiente de depósito', 'orange',  6, false),
  ('DEFENDIDO',          'Defendido',             'emerald', 7, false),
  ('FINALIZADO',         'Finalizado',            'green',   8, true),
  ('CANCELADO',          'Cancelado',             'red',     9, true)
on conflict (code) do nothing;

-- Ciclo de vida restringido SOLO para ACADEMIA (sin depósito ni defensa).
-- Los tipos sin filas aquí admiten todos los estados activos.
insert into work_type_statuses (work_type_id, status_id, display_order)
select wt.id, ws.id, ws.display_order
from work_types wt
join work_statuses ws on ws.code in (
  'PROPUESTA','ASIGNADO','EN_PLANIFICACION','EN_DESARROLLO','EN_REVISION','FINALIZADO','CANCELADO'
)
where wt.code = 'ACADEMIA' and wt.organization_id is null
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Funciones académicas. Las políticas RLS leen los FLAGS, no el `code`:
-- un rol nuevo funciona correctamente sin reescribir seguridad.
-- -----------------------------------------------------------------------------
insert into work_roles (
  code, name, is_student, is_supervisory,
  can_manage_plan, can_see_private_notes, can_validate_deliverables, can_manage_members,
  display_order
) values
  ('PRIMARY_SUPERVISOR', 'Director',          false, true,  true,  true,  true,  true,  1),
  ('CO_SUPERVISOR',      'Codirector',         false, true,  true,  true,  true,  false, 2),
  ('COLLABORATOR',       'Colaborador',        false, true,  false, false, false, false, 3),
  ('STUDENT',            'Estudiante',         true,  false, false, false, false, false, 4)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Tipos de documento (catálogo global)
-- -----------------------------------------------------------------------------
insert into document_types (organization_id, code, name, display_order) values
  (null, 'PROPUESTA',      'Propuesta inicial',            1),
  (null, 'PLAN',           'Plan de trabajo',              2),
  (null, 'ESTADO_ARTE',    'Estado del arte',              3),
  (null, 'MEMORIA',        'Memoria',                      4),
  (null, 'ARTICULO',       'Artículo científico',          5),
  (null, 'PRESENTACION',   'Presentación',                 6),
  (null, 'DATOS',          'Datos y resultados',           7),
  (null, 'ADMINISTRATIVO', 'Documentación administrativa', 8),
  (null, 'OTRO',           'Otros',                        9)
on conflict do nothing;
