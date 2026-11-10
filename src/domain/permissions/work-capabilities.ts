/**
 * Resolución de capacidades de un usuario sobre UN trabajo.
 *
 * ESPEJO EN CLIENTE de las funciones `app.*` de supabase/migrations/0003.
 * Sirve para decidir qué mostrar; NO es una medida de seguridad. La frontera
 * real es RLS en PostgreSQL. Si estas reglas y las políticas se separasen, la
 * base de datos seguiría siendo correcta y la interfaz solo estaría mal
 * dibujada. Cualquier cambio aquí debe reflejarse en 0003_rls_policies.sql y
 * viceversa.
 *
 * Reglas (SECURITY.md §4):
 *  1. Unión de capacidades de las filas activas: tener más funciones nunca resta.
 *  2. `work_members.permissions` puede conceder o denegar y tiene precedencia.
 *  3. Si alguna función activa es de estudiante, `can_see_private_notes` se
 *     fuerza a falso: nadie lee notas de supervisión sobre sí mismo.
 *  4. El rol administrativo no se deduce de una relación académica.
 */

export type RoleFlags = {
  is_student: boolean
  is_supervisory: boolean
  can_manage_plan: boolean
  can_see_private_notes: boolean
  can_validate_deliverables: boolean
  can_manage_members: boolean
}

export type MemberLike = {
  user_id: string
  status: 'ACTIVE' | 'INACTIVE'
  permissions?: Record<string, boolean> | null
  role: RoleFlags | null
}

export type WorkCapabilities = {
  isMember: boolean
  isStudent: boolean
  isSupervisor: boolean
  canManagePlan: boolean
  canSeePrivateNotes: boolean
  canValidateDeliverables: boolean
  canManageMembers: boolean
  canEditWork: boolean
  /**
   * LO QUE EL ALUMNO PUEDE HACER EN SU PROPIO TRABAJO (migración 0030).
   *
   * Son tres capacidades y no una porque no se conceden juntas ni se revocan
   * juntas: el contenido académico lo escribe quien hace el trabajo, los hitos
   * los cumple él, y una reunión la convoca cualquiera de las dos partes.
   * Meterlas en `canManagePlan` habría dado de paso borrar tareas y reasignar
   * responsables, que es justo lo que no se quería.
   */
  canManageMilestones: boolean
  canManageMeetings: boolean
  canEditAcademicContent: boolean
  roleNames: string[]
}

const CAPS = [
  'can_manage_plan',
  'can_see_private_notes',
  'can_validate_deliverables',
  'can_manage_members',
] as const

export function resolveWorkCapabilities(
  members: MemberLike[],
  userId: string | null,
  isOrgAdmin: boolean,
): WorkCapabilities {
  const mine = userId
    ? members.filter((m) => m.user_id === userId && m.status === 'ACTIVE' && m.role !== null)
    : []

  const granted = new Set<string>()
  for (const m of mine) {
    for (const cap of CAPS) {
      // Regla 2: la excepción explícita manda sobre el flag del rol.
      const override = m.permissions?.[cap]
      const value = override ?? m.role![cap]
      if (value) granted.add(cap)
    }
  }

  const isStudent = mine.some((m) => m.role!.is_student)
  const isSupervisory = mine.some((m) => m.role!.is_supervisory)

  // Regla 3: protección del estudiante, incluso frente al rol administrativo.
  const canSeePrivateNotes = isStudent ? false : granted.has('can_see_private_notes') || isOrgAdmin

  return {
    isMember: mine.length > 0 || isOrgAdmin,
    isStudent,
    isSupervisor: isSupervisory,
    canManagePlan: granted.has('can_manage_plan') || isOrgAdmin,
    canSeePrivateNotes,
    canValidateDeliverables: granted.has('can_validate_deliverables') || isOrgAdmin,
    canManageMembers: granted.has('can_manage_members') || isOrgAdmin,
    canEditWork: isSupervisory || isOrgAdmin,
    // Espejo de `milestones_write`, `app.can_manage_meetings` y
    // `works_update` + `app.enforce_work_update_scope` de la 0030.
    canManageMilestones: granted.has('can_manage_plan') || isOrgAdmin || isStudent,
    canManageMeetings: isSupervisory || isOrgAdmin || isStudent,
    canEditAcademicContent: isSupervisory || isOrgAdmin || isStudent,
    roleNames: mine.map((m) => m.role!).map((r) => (r.is_student ? 'Estudiante' : r.is_supervisory ? 'Supervisión' : 'Otra')),
  }
}

/**
 * ¿Puede editar esta tarea entera —título, descripción, fechas, prioridad,
 * color y su lista de comprobación—?
 *
 * Espejo de `app.enforce_task_update_scope` (0030): quien planifica, siempre;
 * y el responsable, en la suya. Lo que NO da esta función, porque tampoco lo
 * da el disparador, es cambiar el responsable ni ARCHIVAR —ni la tarea ni un
 * punto de su lista—: las dos cosas son planificar, y para eso está
 * `caps.canManagePlan`.
 *
 * Lo de archivar no es una cautela de la interfaz, es que la base de datos lo
 * rechaza: `tasks_select` (0025) solo enseña lo archivado a quien tiene
 * `can_manage_plan`, de modo que la fila archivada dejaría de ser visible para
 * quien la archiva y el UPDATE muere con «new row violates row-level security
 * policy». Dibujar el botón solo serviría para que diera error.
 */
export function canEditTask(
  caps: WorkCapabilities,
  task: { assignee_id: string | null },
  userId: string | null,
): boolean {
  return caps.canManagePlan || (userId !== null && task.assignee_id === userId)
}

/** ¿Puede el usuario cambiar el estado de esta tarea? (no el resto de campos) */
export function canUpdateTaskStatus(
  caps: WorkCapabilities,
  task: { assignee_id: string | null },
  userId: string | null,
): boolean {
  return caps.canManagePlan || (userId !== null && task.assignee_id === userId)
}
