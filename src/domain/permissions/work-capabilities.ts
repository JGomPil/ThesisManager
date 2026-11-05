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
    roleNames: mine.map((m) => m.role!).map((r) => (r.is_student ? 'Estudiante' : r.is_supervisory ? 'Supervisión' : 'Otra')),
  }
}

/** ¿Puede el usuario cambiar el estado de esta tarea? (no el resto de campos) */
export function canUpdateTaskStatus(
  caps: WorkCapabilities,
  task: { assignee_id: string | null },
  userId: string | null,
): boolean {
  return caps.canManagePlan || (userId !== null && task.assignee_id === userId)
}
