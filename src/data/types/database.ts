/**
 * Tipos de la base de datos.
 *
 * ESCRITO A MANO en la Fase 1 porque todavía no hay un proyecto de Supabase
 * contra el que ejecutar `supabase gen types typescript`. En cuanto exista,
 * `npm run types:db` lo regenera y sustituye este fichero: a partir de ese
 * momento NO se edita a mano, se regenera.
 *
 * Debe mantenerse en correspondencia con supabase/migrations/.
 */

/**
 * Nota de tipado: R, I y U deben ser ALIAS de tipo objeto, no `interface`.
 * TypeScript no da index signature implícita a las interfaces, y los
 * ayudantes de supabase-js exigen que encajen en Record<string, unknown>;
 * con interfaces, los argumentos de insert()/update() colapsan a `never`.
 */
type Table<R, I, U = Partial<I>> = { Row: R; Insert: I; Update: U; Relationships: [] }

/** Columnas que pone la base de datos por defecto. */
type Auto<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

// -----------------------------------------------------------------------------
// Filas
// -----------------------------------------------------------------------------

export type ProfileRow = {
  id: string
  full_name: string
  email: string
  avatar_url: string | null
  department: string | null
  position: string | null
  orcid: string | null
  bio: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type OrganizationRow = {
  id: string
  name: string
  slug: string
  created_at: string
  updated_at: string
}

export type OrganizationMemberRow = {
  id: string
  organization_id: string
  user_id: string
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  is_active: boolean
  created_at: string
}

export type ResearchGroupRow = {
  id: string
  organization_id: string
  name: string
  acronym: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type AcademicLevelRow = {
  code: string
  name: string
  display_order: number
}

export type AcademicYearRow = {
  id: string
  organization_id: string
  code: string
  start_date: string
  end_date: string
  is_current: boolean
}

export type ProgramRow = {
  id: string
  organization_id: string
  code: string
  name: string
  academic_level: string | null
  is_active: boolean
}

export type ResearchLineRow = {
  id: string
  organization_id: string
  research_group_id: string | null
  name: string
  description: string | null
  is_active: boolean
}

/** EL catálogo clave: los tipos de trabajo son datos, no código. */
export type WorkTypeRow = {
  id: string
  organization_id: string | null
  code: string
  name: string
  short_name: string
  academic_level: string | null
  color: string
  icon: string | null
  display_order: number
  is_active: boolean
  default_duration_months: number | null
  requires_defense: boolean
  requires_deposit: boolean
  requires_program: boolean
  allows_multiple_students: boolean
  max_supervisors: number | null
  counts_toward_workload: boolean
  default_template_id: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type WorkStatusRow = {
  id: string
  code: string
  name: string
  color: string
  display_order: number
  is_terminal: boolean
  is_active: boolean
}

export type WorkTypeStatusRow = {
  work_type_id: string
  status_id: string
  display_order: number
}

export type WorkRoleRow = {
  id: string
  code: string
  name: string
  is_student: boolean
  is_supervisory: boolean
  can_manage_plan: boolean
  can_see_private_notes: boolean
  can_validate_deliverables: boolean
  can_manage_members: boolean
  display_order: number
  is_active: boolean
}

export type DocumentTypeRow = {
  id: string
  organization_id: string | null
  code: string
  name: string
  display_order: number
  is_active: boolean
}

export type AcademicWorkRow = {
  id: string
  organization_id: string
  research_group_id: string | null
  work_type_id: string
  status_id: string
  program_id: string | null
  academic_year_id: string | null
  research_line_id: string | null
  title: string
  description: string | null
  objectives: string | null
  hypothesis: string | null
  methodology: string | null
  keywords: string[]
  notes: string | null
  start_date: string | null
  expected_end_date: string | null
  actual_end_date: string | null
  defense_date: string | null
  progress_override: number | null
  is_archived: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type WorkMemberRow = {
  id: string
  work_id: string
  user_id: string
  work_role_id: string
  is_primary: boolean
  permissions: Record<string, boolean>
  start_date: string | null
  end_date: string | null
  status: 'ACTIVE' | 'INACTIVE'
  created_by: string | null
  created_at: string
  updated_at: string
}

export type TaskStatus = 'PENDIENTE' | 'EN_CURSO' | 'BLOQUEADA' | 'EN_REVISION' | 'COMPLETADA'
export type TaskPriority = 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE'

export type TaskRow = {
  id: string
  work_id: string
  parent_task_id: string | null
  milestone_id: string | null
  title: string
  description: string | null
  assignee_id: string | null
  status: TaskStatus
  priority: TaskPriority
  start_date: string | null
  due_date: string | null
  completed_at: string | null
  order_index: number
  /**
   * En qué COLUMNA del tablero está la tarjeta (migración 0024).
   *
   * `null` significa «sin columna asignada», y es un estado normal, no un
   * olvido: una organización que no ha configurado columnas ve el tablero de
   * siempre y sus tareas no apuntan a ninguna. En ese caso la columna se
   * deduce del estado. Con columna asignada manda la columna: un disparador
   * deriva `status` de ella (`maps_to`), así que estas dos no se contradicen
   * nunca.
   */
  board_column_id: string | null
  /**
   * De qué tarea de plantilla sale esta tarea (migración 0014). Es el enlace
   * que le da su material de referencia SIN copiar ningún fichero: la rúbrica
   * vive una sola vez en la plantilla y se corrige para todos los trabajos a la
   * vez. `on delete set null`: si se borra la tarea de plantilla, la tarea se
   * queda sin material y no avisa.
   */
  template_task_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Columna del tablero de tareas (migración 0024). El catálogo que hace
 * configurable el Kanban.
 *
 * `maps_to` es la pieza que mantiene honesto el resto de la aplicación: la
 * columna se llama como quiera —«Papers», «Estudios»— y además DECLARA qué
 * significa, de modo que el progreso, los colores del cronograma, los bloqueos
 * por dependencia y los informes siguen leyendo `tasks.status` sin saber que
 * existe este catálogo.
 */
export type BoardColumnRow = {
  id: string
  organization_id: string
  name: string
  color: string
  maps_to: TaskStatus
  display_order: number
  is_active: boolean
  created_at: string
}

export type MilestoneRow = {
  id: string
  work_id: string
  phase_id: string | null
  name: string
  description: string | null
  due_date: string
  is_met: boolean
  met_at: string | null
  order_index: number
  created_at: string
}

export type WorkPhaseRow = {
  id: string
  work_id: string
  name: string
  start_date: string | null
  end_date: string | null
  order_index: number
}

/**
 * Dependencia entre tareas. La clave primaria es el par, así que no hay `id`:
 * una dependencia no es una entidad con vida propia, es una arista.
 */
export type TaskDependencyRow = {
  task_id: string
  depends_on_task_id: string
}

export type TemplateRow = {
  id: string
  organization_id: string
  work_type_id: string | null
  name: string
  description: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
}

/**
 * Tarea de una plantilla. Las fechas son RELATIVAS: `offset_days` desde el
 * inicio del trabajo y `duration_days` de duración, de modo que la misma
 * plantilla sirva para un trabajo que empieza en octubre y para otro que
 * empieza en febrero. `parent_index` apunta al `order_index` del padre dentro
 * de la misma plantilla, no a un uuid: cuando se escribe la plantilla las
 * tareas reales todavía no existen. Lo resuelve `app.apply_template`.
 */
export type TemplateTaskRow = {
  id: string
  template_id: string
  title: string
  description: string | null
  offset_days: number
  duration_days: number
  priority: TaskPriority
  order_index: number
  parent_index: number | null
  /**
   * Quién hace la tarea, por FUNCIÓN y no por persona: una plantilla sirve para
   * trabajos que todavía no existen. `app.apply_template` lo resuelve contra
   * los participantes activos del trabajo, prefiriendo al principal.
   */
  assignee_role_id: string | null
}

/**
 * Un documento que la plantilla da por previsto: lo que hay que ENTREGAR en
 * todos los trabajos de ese tipo (memoria, anexos, presentación de la defensa).
 *
 * Al aplicar la plantilla se crea un documento del trabajo con este nombre y
 * SIN ninguna versión, que es la ficha vacía que significa «pendiente de
 * entregar». El documento creado NO guarda de dónde salió: en cuanto nace es
 * del trabajo —se le cambia el nombre, se le suben versiones, se revisa— y
 * guardar el origen solo sugeriría que corregir la plantilla corrige los
 * trabajos ya creados, que no es verdad.
 *
 * `is_required` se muestra y no bloquea nada: sirve para que se vea que falta.
 */
export type TemplateDocumentRow = {
  id: string
  template_id: string
  document_type_id: string | null
  name: string
  description: string | null
  is_required: boolean
  order_index: number
  created_by: string | null
  created_at: string
}

/**
 * Material de referencia de una plantilla: guiones, rúbricas, formatos. Con
 * `template_task_id` cuelga de una tarea concreta; sin él, de la plantilla
 * entera. Dos orígenes posibles, como en `document_versions`: fichero en el
 * cubo `template-files` o enlace externo.
 *
 * NO contiene datos de ninguna persona: es material común a todos los trabajos
 * de ese tipo, y lo lee cualquier miembro de la organización.
 */
export type TemplateFileRow = {
  id: string
  template_id: string
  template_task_id: string | null
  title: string
  description: string | null
  storage_path: string | null
  external_url: string | null
  mime_type: string | null
  size_bytes: number | null
  created_by: string | null
  created_at: string
}

export type NotificationRow = {
  id: string
  user_id: string
  work_id: string | null
  type: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

export type InvitationStatus = 'PENDING' | 'SENT' | 'ACCEPTED' | 'CANCELLED'

export type InvitationRow = {
  id: string
  organization_id: string
  email: string
  full_name: string | null
  intended_role: 'OWNER' | 'ADMIN' | 'MEMBER'
  status: InvitationStatus
  notes: string | null
  sent_at: string | null
  accepted_at: string | null
  accepted_user_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type KeepaliveRow = {
  id: number
  label: string
  last_ping_at: string | null
  note: string
  created_at: string
}

// -----------------------------------------------------------------------------
// Database
// -----------------------------------------------------------------------------

export type DocumentReviewStatus =
  | 'BORRADOR' | 'ENTREGADO' | 'EN_REVISION' | 'REVISADO' | 'APROBADO' | 'RECHAZADO'

export type DocumentRow = {
  id: string
  work_id: string
  /** Vínculo OPCIONAL con una tarea (migración 0010). El documento pertenece al trabajo. */
  task_id: string | null
  document_type_id: string | null
  name: string
  description: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type DocumentVersionRow = {
  id: string
  document_id: string
  work_id: string
  version_label: string
  /** Fichero que vive fuera (Drive institucional, repositorio de la universidad). */
  external_url: string | null
  /** Ruta dentro del cubo privado `work-documents`: <work_id>/<document_id>/<fichero>. */
  storage_path: string | null
  author_id: string | null
  review_status: DocumentReviewStatus
  submitted_at: string
  reviewed_at: string | null
  reviewer_id: string | null
  notes: string | null
}

/**
 * Comentario sobre una VERSIÓN de un documento (puesto en marcha por la 0015).
 *
 * `work_id` lo deriva el disparador `app.enforce_doc_comment_scope` de la
 * versión comentada: es la columna por la que la política decide quién lo ve, y
 * no debe depender de lo que mande el cliente.
 */
export type DocumentCommentRow = {
  id: string
  version_id: string
  work_id: string
  author_id: string
  content: string
  created_at: string
}

export type MeetingModality = 'PRESENCIAL' | 'ONLINE' | 'HIBRIDA'

export type MeetingRow = {
  id: string
  work_id: string
  title: string
  scheduled_at: string
  duration_min: number | null
  modality: MeetingModality
  location: string | null
  topics: string | null
  /** Acta COMPARTIDA: la ve también el estudiante. */
  summary: string | null
  next_meeting_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type MeetingParticipantRow = {
  meeting_id: string
  user_id: string
  attended: boolean | null
}

export type MeetingAgreementRow = {
  id: string
  meeting_id: string
  work_id: string
  description: string
  /** Tarea derivada del acuerdo, si se ha generado. */
  task_id: string | null
  order_index: number
}

/**
 * Notas privadas de dirección. Tabla SEPARADA de `meetings` a propósito: si
 * fuesen una columna más del acta, cualquier consulta que trajera la reunión
 * traería la nota, y bastaría un `select *` mal puesto para filtrarla al
 * estudiante. Separarlas hace que la política de RLS sea la única puerta.
 */
export type MeetingPrivateNoteRow = {
  id: string
  meeting_id: string
  work_id: string
  author_id: string
  content: string
  created_at: string
  updated_at: string
}

export type CommentEntityType = 'WORK' | 'TASK' | 'DOCUMENT' | 'MEETING'

export type CommentRow = {
  id: string
  work_id: string
  entity_type: CommentEntityType
  entity_id: string | null
  parent_comment_id: string | null
  author_id: string
  content: string
  mentions: string[]
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, Auto<ProfileRow, 'avatar_url' | 'department' | 'position' | 'orcid' | 'bio' | 'is_active' | 'created_at' | 'updated_at'>>
      organizations: Table<OrganizationRow, Auto<OrganizationRow, 'id' | 'created_at' | 'updated_at'>>
      organization_members: Table<OrganizationMemberRow, Auto<OrganizationMemberRow, 'id' | 'is_active' | 'created_at'>>
      research_groups: Table<ResearchGroupRow, Auto<ResearchGroupRow, 'id' | 'acronym' | 'is_active' | 'created_at' | 'updated_at'>>
      academic_levels: Table<AcademicLevelRow, Auto<AcademicLevelRow, 'display_order'>>
      academic_years: Table<AcademicYearRow, Auto<AcademicYearRow, 'id' | 'is_current'>>
      programs: Table<ProgramRow, Auto<ProgramRow, 'id' | 'academic_level' | 'is_active'>>
      research_lines: Table<ResearchLineRow, Auto<ResearchLineRow, 'id' | 'research_group_id' | 'description' | 'is_active'>>
      work_types: Table<WorkTypeRow, Auto<WorkTypeRow, 'id' | 'color' | 'icon' | 'display_order' | 'is_active' | 'default_duration_months' | 'requires_defense' | 'requires_deposit' | 'requires_program' | 'allows_multiple_students' | 'max_supervisors' | 'counts_toward_workload' | 'default_template_id' | 'notes' | 'academic_level' | 'created_by' | 'created_at' | 'updated_at'>>
      work_statuses: Table<WorkStatusRow, Auto<WorkStatusRow, 'id' | 'color' | 'display_order' | 'is_terminal' | 'is_active'>>
      work_type_statuses: Table<WorkTypeStatusRow, Auto<WorkTypeStatusRow, 'display_order'>>
      // Las seis banderas tienen `default false` en la 0001, así que no hacen
      // falta al insertar; y es justo lo que se quiere, porque la política
      // `roles_insert` (0020) rechaza un rol nuevo con capacidades.
      work_roles: Table<WorkRoleRow, Auto<WorkRoleRow, 'id' | 'display_order' | 'is_active'
        | 'is_student' | 'is_supervisory' | 'can_manage_plan' | 'can_see_private_notes'
        | 'can_validate_deliverables' | 'can_manage_members'>>
      document_types: Table<DocumentTypeRow, Auto<DocumentTypeRow, 'id' | 'organization_id' | 'display_order' | 'is_active'>>
      academic_works: Table<AcademicWorkRow, Auto<AcademicWorkRow, 'id' | 'research_group_id' | 'program_id' | 'academic_year_id' | 'research_line_id' | 'description' | 'objectives' | 'hypothesis' | 'methodology' | 'keywords' | 'notes' | 'start_date' | 'expected_end_date' | 'actual_end_date' | 'defense_date' | 'progress_override' | 'is_archived' | 'created_by' | 'created_at' | 'updated_at' | 'deleted_at'>>
      work_members: Table<WorkMemberRow, Auto<WorkMemberRow, 'id' | 'is_primary' | 'permissions' | 'start_date' | 'end_date' | 'status' | 'created_by' | 'created_at' | 'updated_at'>>
      tasks: Table<TaskRow, Auto<TaskRow, 'id' | 'parent_task_id' | 'milestone_id' | 'description' | 'assignee_id' | 'status' | 'priority' | 'start_date' | 'due_date' | 'completed_at' | 'order_index' | 'board_column_id' | 'template_task_id' | 'created_by' | 'created_at' | 'updated_at'>>
      board_columns: Table<BoardColumnRow, Auto<BoardColumnRow, 'id' | 'color' | 'maps_to' | 'display_order' | 'is_active' | 'created_at'>>
      milestones: Table<MilestoneRow, Auto<MilestoneRow, 'id' | 'phase_id' | 'description' | 'is_met' | 'met_at' | 'order_index' | 'created_at'>>
      meetings: Table<MeetingRow, Auto<MeetingRow, 'id' | 'duration_min' | 'modality' | 'location' | 'topics' | 'summary' | 'next_meeting_at' | 'created_by' | 'created_at' | 'updated_at'>>
      meeting_participants: Table<MeetingParticipantRow, Auto<MeetingParticipantRow, 'attended'>>
      meeting_agreements: Table<MeetingAgreementRow, Auto<MeetingAgreementRow, 'id' | 'task_id' | 'order_index'>>
      meeting_private_notes: Table<MeetingPrivateNoteRow, Auto<MeetingPrivateNoteRow, 'id' | 'created_at' | 'updated_at'>>
      comments: Table<CommentRow, Auto<CommentRow, 'id' | 'entity_id' | 'parent_comment_id' | 'mentions' | 'created_at' | 'updated_at' | 'deleted_at'>>
      notifications: Table<NotificationRow, Auto<NotificationRow, 'id' | 'work_id' | 'body' | 'link' | 'read_at' | 'created_at'>>
      invitations: Table<InvitationRow, Auto<InvitationRow, 'id' | 'full_name' | 'intended_role' | 'status' | 'notes' | 'sent_at' | 'accepted_at' | 'accepted_user_id' | 'created_by' | 'created_at' | 'updated_at'>>
      documents: Table<DocumentRow, Auto<DocumentRow, 'id' | 'task_id' | 'document_type_id' | 'description' | 'created_by' | 'created_at' | 'updated_at' | 'deleted_at'>>
      document_versions: Table<DocumentVersionRow, Auto<DocumentVersionRow, 'id' | 'external_url' | 'storage_path' | 'author_id' | 'review_status' | 'submitted_at' | 'reviewed_at' | 'reviewer_id' | 'notes'>>
      work_phases: Table<WorkPhaseRow, Auto<WorkPhaseRow, 'id' | 'start_date' | 'end_date' | 'order_index'>>
      task_dependencies: Table<TaskDependencyRow, TaskDependencyRow>
      templates: Table<TemplateRow, Auto<TemplateRow, 'id' | 'work_type_id' | 'description' | 'is_active' | 'created_by' | 'created_at'>>
      template_tasks: Table<TemplateTaskRow, Auto<TemplateTaskRow, 'id' | 'description' | 'offset_days' | 'duration_days' | 'priority' | 'order_index' | 'parent_index' | 'assignee_role_id'>>
      template_files: Table<TemplateFileRow, Auto<TemplateFileRow, 'id' | 'template_task_id' | 'description' | 'storage_path' | 'external_url' | 'mime_type' | 'size_bytes' | 'created_by' | 'created_at'>>
      template_documents: Table<TemplateDocumentRow, Auto<TemplateDocumentRow, 'id' | 'document_type_id' | 'description' | 'is_required' | 'order_index' | 'created_by' | 'created_at'>>
      document_comments: Table<DocumentCommentRow, Auto<DocumentCommentRow, 'id' | 'work_id' | 'created_at'>>
      keepalive: Table<KeepaliveRow, Auto<KeepaliveRow, 'id' | 'label' | 'last_ping_at' | 'note' | 'created_at'>>
    }
    Views: Record<string, never>
    Functions: {
      keepalive_ping: { Args: Record<string, never>; Returns: string }
      /**
       * Envoltura en `public` de `app.apply_template` (migración 0012):
       * PostgREST no expone el esquema `app`. Devuelve el número de tareas
       * creadas. No lleva `security definer`, así que las políticas de `tasks`
       * siguen decidiendo quién puede planificar.
       */
      /**
       * Cuentas que existen pero no pertenecen a ninguna organización
       * (migración 0013). Devuelve filas solo si quien llama administra alguna;
       * al resto, una lista vacía. Existe porque `profiles_select` —a
       * propósito— no deja ver a quien no comparte organización, y una cuenta
       * creada a mano no comparte ninguna con nadie.
       */
      pending_accounts: {
        Args: Record<string, never>
        Returns: { id: string; full_name: string; email: string; created_at: string }[]
      }
      apply_template: {
        Args: { p_work: string; p_template: string; p_start?: string | null }
        Returns: number
      }
      /**
       * Localiza a UNA persona por su correo exacto (migración 0016).
       *
       * `profiles_select` ya no deja ver a toda la organización, así que para
       * poder añadir a un codirector con el que no se ha coincidido nunca hace
       * falta esto. Exige igualdad de correo —sin comodines— y solo contesta a
       * quien puede añadir participantes en algún trabajo; al resto, lista
       * vacía. Devuelve 0 o 1 filas.
       */
      find_person_by_email: {
        Args: { p_email: string }
        Returns: { id: string; full_name: string; email: string; department: string | null }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
