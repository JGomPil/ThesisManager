import { supabase } from '@/lib/supabase'
import type { AcademicWorkRow, Database, TaskStatus, WorkMemberRow } from '@/data/types/database'

type WorkInsert = Database['public']['Tables']['academic_works']['Insert']
type WorkUpdate = Database['public']['Tables']['academic_works']['Update']
type MemberInsert = Database['public']['Tables']['work_members']['Insert']

/** Columnas con los catálogos ya resueltos: evita N+1 en las listas. */
// Las pistas `!<restriccion>` de los embeds NO son opcionales: cuando hay más de
// una clave ajena entre dos tablas, PostgREST responde HTTP 300 PGRST201
// («more than one relationship was found») y la pantalla entera se queda sin
// datos. `work_members` apunta a `profiles` por `user_id` y por `created_by`.
// Verificado contra PostgREST real: sin la pista falla; con la pista equivocada
// devuelve a la persona equivocada. `scripts/check-embeds.sh` lo vigila.
const WORK_SELECT = `
  *,
  work_type:work_types(id,code,name,short_name,color,icon,requires_defense,requires_deposit,requires_program,allows_multiple_students,max_supervisors,default_duration_months),
  status:work_statuses(id,code,name,color,display_order,is_terminal),
  program:programs(id,code,name),
  academic_year:academic_years(id,code),
  research_line:research_lines(id,name),
  members:work_members(
    id,user_id,is_primary,status,permissions,
    role:work_roles(id,code,name,is_student,is_supervisory,can_manage_plan,can_see_private_notes,can_validate_deliverables,can_manage_members),
    profile:profiles!work_members_user_id_fkey(id,full_name,email,avatar_url)
  )
`

export type WorkMemberWithRole = Pick<WorkMemberRow, 'id' | 'user_id' | 'is_primary' | 'status' | 'permissions'> & {
  role: {
    id: string; code: string; name: string
    is_student: boolean; is_supervisory: boolean
    can_manage_plan: boolean; can_see_private_notes: boolean
    can_validate_deliverables: boolean; can_manage_members: boolean
  } | null
  profile: { id: string; full_name: string; email: string; avatar_url: string | null } | null
}

export type WorkWithRelations = AcademicWorkRow & {
  work_type: {
    id: string; code: string; name: string; short_name: string; color: string; icon: string | null
    requires_defense: boolean; requires_deposit: boolean; requires_program: boolean
    allows_multiple_students: boolean; max_supervisors: number | null
    default_duration_months: number | null
  } | null
  status: { id: string; code: string; name: string; color: string; display_order: number; is_terminal: boolean } | null
  program: { id: string; code: string; name: string } | null
  academic_year: { id: string; code: string } | null
  research_line: { id: string; name: string } | null
  members: WorkMemberWithRole[]
}

export type WorkFilters = {
  workTypeId?: string
  statusId?: string
  academicYearId?: string
  search?: string
  onlyActive?: boolean
}

export const worksRepo = {
  /**
   * No se filtra por usuario: RLS ya devuelve únicamente los trabajos
   * accesibles. Filtrar aquí daría una falsa sensación de seguridad y
   * duplicaría la lógica de autorización.
   */
  list: async (filters: WorkFilters = {}): Promise<WorkWithRelations[]> => {
    let q = supabase.from('academic_works').select(WORK_SELECT).is('deleted_at', null)

    if (filters.workTypeId) q = q.eq('work_type_id', filters.workTypeId)
    if (filters.statusId) q = q.eq('status_id', filters.statusId)
    if (filters.academicYearId) q = q.eq('academic_year_id', filters.academicYearId)
    if (filters.onlyActive) q = q.eq('is_archived', false)
    if (filters.search?.trim()) q = q.ilike('title', `%${filters.search.trim()}%`)

    const { data, error } = await q.order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as unknown as WorkWithRelations[]
  },

  get: async (id: string): Promise<WorkWithRelations | null> => {
    const { data, error } = await supabase.from('academic_works').select(WORK_SELECT).eq('id', id).maybeSingle()
    if (error) throw error
    return (data as unknown as WorkWithRelations) ?? null
  },

  create: async (input: WorkInsert): Promise<AcademicWorkRow> => {
    const { data, error } = await supabase.from('academic_works').insert(input).select('*').single()
    if (error) throw error
    return data
  },

  update: async (id: string, patch: WorkUpdate): Promise<AcademicWorkRow> => {
    const { data, error } = await supabase.from('academic_works').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    return data
  },

  /**
   * Archivado (borrado lógico): los trabajos históricos tienen valor académico,
   * así que nunca se borran de verdad. Dos cosas que no son evidentes:
   *
   * - Solo la administración puede hacerlo. Lo impone el disparador
   *   `app.enforce_soft_delete_scope()` de la migración 0008, no este código:
   *   un director tiene permiso de UPDATE sobre el trabajo, pero no sobre esta
   *   columna.
   * - La política de SELECT deja ver lo archivado SOLO a la administración.
   *   Es imprescindible: PostgreSQL exige que la fila resultante de un UPDATE
   *   siga siendo visible para quien lo ejecuta, así que sin eso esta llamada
   *   fallaría; y además un archivado invisible para todos sería irreversible.
   */
  archive: async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('academic_works')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  },

  restore: async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('academic_works')
      .update({ deleted_at: null })
      .eq('id', id)
    if (error) throw error
  },

  /** Archivados. Solo devuelve filas a la administración, por la política de SELECT. */
  listArchived: async (): Promise<WorkWithRelations[]> => {
    const { data, error } = await supabase
      .from('academic_works')
      .select(WORK_SELECT)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as unknown as WorkWithRelations[]
  },

  addMember: async (input: MemberInsert): Promise<WorkMemberRow> => {
    const { data, error } = await supabase.from('work_members').insert(input).select('*').single()
    if (error) throw error
    return data
  },

  removeMember: async (memberId: string): Promise<void> => {
    const { error } = await supabase.from('work_members').delete().eq('id', memberId)
    if (error) throw error
  },

  setMemberStatus: async (memberId: string, status: 'ACTIVE' | 'INACTIVE'): Promise<void> => {
    const { error } = await supabase.from('work_members').update({ status }).eq('id', memberId)
    if (error) throw error
  },

  /** Recuentos por tipo de trabajo para el dashboard, en una sola consulta. */
  countsByType: async (): Promise<Record<string, number>> => {
    const { data, error } = await supabase
      .from('academic_works')
      .select('work_type_id, status:work_statuses(is_terminal)')
      .is('deleted_at', null)
      .eq('is_archived', false)
    if (error) throw error

    const counts: Record<string, number> = {}
    for (const row of (data ?? []) as unknown as { work_type_id: string; status: { is_terminal: boolean } | null }[]) {
      if (row.status?.is_terminal) continue
      counts[row.work_type_id] = (counts[row.work_type_id] ?? 0) + 1
    }
    return counts
  },
}

export type TaskStatusValue = TaskStatus
