import { supabase } from '@/lib/supabase'
import type {
  AcademicLevelRow, AcademicYearRow, ProgramRow, ResearchLineRow,
  DocumentTypeRow, WorkRoleRow, WorkStatusRow, WorkTypeRow, WorkTypeStatusRow,
} from '@/data/types/database'
import type { Database } from '@/data/types/database'

type WorkTypeInsert = Database['public']['Tables']['work_types']['Insert']
type WorkTypeUpdate = Database['public']['Tables']['work_types']['Update']
type LineInsert = Database['public']['Tables']['research_lines']['Insert']
type LineUpdate = Database['public']['Tables']['research_lines']['Update']
type ProgramInsert = Database['public']['Tables']['programs']['Insert']
type ProgramUpdate = Database['public']['Tables']['programs']['Update']
type YearInsert = Database['public']['Tables']['academic_years']['Insert']
type YearUpdate = Database['public']['Tables']['academic_years']['Update']

/**
 * Cuántos trabajos usan cada línea, titulación y curso.
 *
 * Hace falta porque las tres columnas de `academic_works` que apuntan a estos
 * catálogos son `on delete set null`: borrar una línea NO falla, deja en blanco
 * la línea de todos los trabajos que la usaban y no queda rastro de cuál era.
 * Antes de ofrecer un borrado hay que poder decir a cuántos trabajos afecta.
 *
 * Una sola consulta de tres columnas y el recuento en memoria: son decenas de
 * filas, y la alternativa (una consulta de recuento por cada fila del catálogo)
 * son decenas de idas y vueltas para lo mismo.
 */
export type CatalogUsage = {
  lines: Record<string, number>
  programs: Record<string, number>
  years: Record<string, number>
}

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

  // -------------------------------------------------------------------------
  // Administración de los catálogos planos (líneas, titulaciones, cursos).
  //
  // Las listas de administración NO filtran por `is_active`: desde el panel hay
  // que ver también lo retirado, que es justo lo que no debe aparecer en los
  // formularios. Son métodos aparte y no una opción del mismo, para que no
  // quepa pasar `includeInactive` por descuido en un selector de alta.
  // -------------------------------------------------------------------------
  listAllResearchLines: async (): Promise<ResearchLineRow[]> =>
    unwrap(await supabase.from('research_lines').select('*').order('name')),

  createResearchLine: async (input: LineInsert): Promise<ResearchLineRow> =>
    unwrap(await supabase.from('research_lines').insert(input).select('*').single()),

  updateResearchLine: async (id: string, patch: LineUpdate): Promise<ResearchLineRow> =>
    unwrap(await supabase.from('research_lines').update(patch).eq('id', id).select('*').single()),

  removeResearchLine: async (id: string): Promise<void> => {
    const { error } = await supabase.from('research_lines').delete().eq('id', id)
    if (error) throw error
  },

  listAllPrograms: async (): Promise<ProgramRow[]> =>
    unwrap(await supabase.from('programs').select('*').order('name')),

  createProgram: async (input: ProgramInsert): Promise<ProgramRow> =>
    unwrap(await supabase.from('programs').insert(input).select('*').single()),

  updateProgram: async (id: string, patch: ProgramUpdate): Promise<ProgramRow> =>
    unwrap(await supabase.from('programs').update(patch).eq('id', id).select('*').single()),

  removeProgram: async (id: string): Promise<void> => {
    const { error } = await supabase.from('programs').delete().eq('id', id)
    if (error) throw error
  },

  listAllAcademicYears: async (): Promise<AcademicYearRow[]> =>
    unwrap(await supabase.from('academic_years').select('*').order('code', { ascending: false })),

  createAcademicYear: async (input: YearInsert): Promise<AcademicYearRow> =>
    unwrap(await supabase.from('academic_years').insert(input).select('*').single()),

  updateAcademicYear: async (id: string, patch: YearUpdate): Promise<AcademicYearRow> =>
    unwrap(await supabase.from('academic_years').update(patch).eq('id', id).select('*').single()),

  removeAcademicYear: async (id: string): Promise<void> => {
    const { error } = await supabase.from('academic_years').delete().eq('id', id)
    if (error) throw error
  },

  /** Ver `CatalogUsage`: sirve para avisar antes de borrar, no para decidir. */
  catalogUsage: async (): Promise<CatalogUsage> => {
    const filas = unwrap(
      await supabase.from('academic_works').select('research_line_id, program_id, academic_year_id'),
    )
    const vacio: CatalogUsage = { lines: {}, programs: {}, years: {} }
    for (const f of filas) {
      if (f.research_line_id) vacio.lines[f.research_line_id] = (vacio.lines[f.research_line_id] ?? 0) + 1
      if (f.program_id) vacio.programs[f.program_id] = (vacio.programs[f.program_id] ?? 0) + 1
      if (f.academic_year_id) vacio.years[f.academic_year_id] = (vacio.years[f.academic_year_id] ?? 0) + 1
    }
    return vacio
  },

  listDocumentTypes: async (): Promise<DocumentTypeRow[]> =>
    unwrap(await supabase.from('document_types').select('*').eq('is_active', true).order('display_order')),
}
