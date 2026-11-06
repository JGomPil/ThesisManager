import { supabase } from '@/lib/supabase'
import type {
  AcademicLevelRow, AcademicYearRow, ProgramRow, ResearchLineRow,
  DocumentTypeRow, WorkRoleRow, WorkStatusRow, WorkTypeRow, WorkTypeStatusRow,
} from '@/data/types/database'
import type { Database } from '@/data/types/database'

type WorkTypeInsert = Database['public']['Tables']['work_types']['Insert']
type WorkTypeUpdate = Database['public']['Tables']['work_types']['Update']

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw error
  if (data === null) throw new Error('Respuesta vacía del servidor.')
  return data
}

/**
 * Acceso al catálogo. Es lo que permite que TFG, TFM, tesis, Academia de
 * Alumnos Internos y cualquier tipo futuro sean configuración y no código.
 */
export const catalogsRepo = {
  listWorkTypes: async (opts?: { includeInactive?: boolean }): Promise<WorkTypeRow[]> => {
    let q = supabase.from('work_types').select('*').order('display_order')
    if (!opts?.includeInactive) q = q.eq('is_active', true)
    return unwrap(await q)
  },

  createWorkType: async (input: WorkTypeInsert): Promise<WorkTypeRow> =>
    unwrap(await supabase.from('work_types').insert(input).select('*').single()),

  updateWorkType: async (id: string, patch: WorkTypeUpdate): Promise<WorkTypeRow> =>
    unwrap(await supabase.from('work_types').update(patch).eq('id', id).select('*').single()),

  /**
   * No se borran los tipos en uso: la base de datos lo impide con
   * ON DELETE RESTRICT para no perder los trabajos históricos. Retirar un tipo
   * es desactivarlo.
   */
  deactivateWorkType: async (id: string): Promise<WorkTypeRow> =>
    unwrap(await supabase.from('work_types').update({ is_active: false }).eq('id', id).select('*').single()),

  listWorkStatuses: async (): Promise<WorkStatusRow[]> =>
    unwrap(await supabase.from('work_statuses').select('*').eq('is_active', true).order('display_order')),

  /** Restricciones de ciclo de vida por tipo. Sin filas para un tipo ⇒ todos los estados. */
  listWorkTypeStatuses: async (): Promise<WorkTypeStatusRow[]> =>
    unwrap(await supabase.from('work_type_statuses').select('*').order('display_order')),

  listWorkRoles: async (): Promise<WorkRoleRow[]> =>
    unwrap(await supabase.from('work_roles').select('*').eq('is_active', true).order('display_order')),

  listAcademicLevels: async (): Promise<AcademicLevelRow[]> =>
    unwrap(await supabase.from('academic_levels').select('*').order('display_order')),

  listAcademicYears: async (): Promise<AcademicYearRow[]> =>
    unwrap(await supabase.from('academic_years').select('*').order('code', { ascending: false })),

  listPrograms: async (): Promise<ProgramRow[]> =>
    unwrap(await supabase.from('programs').select('*').eq('is_active', true).order('name')),

  listResearchLines: async (): Promise<ResearchLineRow[]> =>
    unwrap(await supabase.from('research_lines').select('*').eq('is_active', true).order('name')),

  listDocumentTypes: async (): Promise<DocumentTypeRow[]> =>
    unwrap(await supabase.from('document_types').select('*').eq('is_active', true).order('display_order')),
}
