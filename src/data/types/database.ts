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
  created_by: string | null
  created_at: string
  updated_at: string
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
      work_roles: Table<WorkRoleRow, Auto<WorkRoleRow, 'id' | 'display_order' | 'is_active'>>
      document_types: Table<DocumentTypeRow, Auto<DocumentTypeRow, 'id' | 'organization_id' | 'display_order' | 'is_active'>>
      academic_works: Table<AcademicWorkRow, Auto<AcademicWorkRow, 'id' | 'research_group_id' | 'program_id' | 'academic_year_id' | 'research_line_id' | 'description' | 'objectives' | 'hypothesis' | 'methodology' | 'keywords' | 'notes' | 'start_date' | 'expected_end_date' | 'actual_end_date' | 'defense_date' | 'progress_override' | 'is_archived' | 'created_by' | 'created_at' | 'updated_at' | 'deleted_at'>>
      work_members: Table<WorkMemberRow, Auto<WorkMemberRow, 'id' | 'is_primary' | 'permissions' | 'start_date' | 'end_date' | 'status' | 'created_by' | 'created_at' | 'updated_at'>>
      tasks: Table<TaskRow, Auto<TaskRow, 'id' | 'parent_task_id' | 'milestone_id' | 'description' | 'assignee_id' | 'status' | 'priority' | 'start_date' | 'due_date' | 'completed_at' | 'order_index' | 'created_by' | 'created_at' | 'updated_at'>>
      milestones: Table<MilestoneRow, Auto<MilestoneRow, 'id' | 'phase_id' | 'description' | 'is_met' | 'met_at' | 'order_index' | 'created_at'>>
      notifications: Table<NotificationRow, Auto<NotificationRow, 'id' | 'work_id' | 'body' | 'link' | 'read_at' | 'created_at'>>
      invitations: Table<InvitationRow, Auto<InvitationRow, 'id' | 'full_name' | 'intended_role' | 'status' | 'notes' | 'sent_at' | 'accepted_at' | 'accepted_user_id' | 'created_by' | 'created_at' | 'updated_at'>>
      keepalive: Table<KeepaliveRow, Auto<KeepaliveRow, 'id' | 'label' | 'last_ping_at' | 'note' | 'created_at'>>
    }
    Views: Record<string, never>
    Functions: {
      keepalive_ping: { Args: Record<string, never>; Returns: string }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
