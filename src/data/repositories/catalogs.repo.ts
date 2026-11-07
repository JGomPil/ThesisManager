import { supabase } from '@/lib/supabase'
import { ordenarConOtrosAlFinal } from '@/domain/admin/catalog-order'
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
type StatusInsert = Database['public']['Tables']['work_statuses']['Insert']
type StatusUpdate = Database['public']['Tables']['work_statuses']['Update']
type RoleInsert = Database['public']['Tables']['work_roles']['Insert']
type RoleUpdate = Database['public']['Tables']['work_roles']['Update']
type DocTypeInsert = Database['public']['Tables']['document_types']['Insert']
type DocTypeUpdate = Database['public']['Tables']['document_types']['Update']

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
 * Como `unwrap`, pero para un UPDATE del que se espera que vuelva LA fila.
 *
 * POR QUÉ NO BASTA `.single()`
 * PostgreSQL no da error cuando una política de RLS descarta las filas de un
 * UPDATE: no cambia nada y no dice nada, igual que la casilla de la lista de
 * comprobación que cerró la migración 0009. Con `.single()`, esos cero filas
 * llegaban a la pantalla convertidos en «Cannot coerce the result to a single
 * JSON object [PGRST116] The result contains 0 rows», que es verdad y no
 * significa nada para quien está delante. Fue el aviso que apareció el 7 de
 * noviembre de 2026 al editar un TFG, y debajo había un tipo de trabajo global
 * que ninguna política permitía editar (lo abrió la 0022).
 *
 * Así que `.maybeSingle()` y el caso se dice con palabras. No sobra con la
 * 0022 aplicada: queda para el próximo catálogo al que le falte su política, y
 * para una instalación que vaya por detrás en las migraciones.
 */
function unwrapUpdated<T>(
  { data, error }: { data: T | null; error: { message: string } | null },
  queEra: string,
): T {
  if (error) throw error
  if (data === null) {
    throw new Error(
      `La base de datos no ha modificado ${queEra}. O ya no existe, o ninguna política de ` +
        'seguridad permite a tu cuenta cambiar esa fila. Si deberías poder, lo más probable es ' +
        'que falte aplicar alguna migración de supabase/migrations/.',
    )
  }
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
    unwrapUpdated(await supabase.from('work_types').update(patch).eq('id', id).select('*').maybeSingle(), 'este tipo de trabajo'),

  /**
   * No se borran los tipos en uso: la base de datos lo impide con
   * ON DELETE RESTRICT para no perder los trabajos históricos. Retirar un tipo
   * es desactivarlo.
   */
  deactivateWorkType: async (id: string): Promise<WorkTypeRow> =>
    unwrapUpdated(await supabase.from('work_types').update({ is_active: false }).eq('id', id).select('*').maybeSingle(), 'este tipo de trabajo'),

  listWorkStatuses: async (): Promise<WorkStatusRow[]> =>
    unwrap(await supabase.from('work_statuses').select('*').eq('is_active', true).order('display_order')),

  /** Restricciones de ciclo de vida por tipo. Sin filas para un tipo ⇒ todos los estados. */
  listWorkTypeStatuses: async (): Promise<WorkTypeStatusRow[]> =>
    unwrap(await supabase.from('work_type_statuses').select('*').order('display_order')),

  listWorkRoles: async (): Promise<WorkRoleRow[]> =>
    unwrap(await supabase.from('work_roles').select('*').eq('is_active', true).order('display_order')),

  // ---------------------------------------------------------------------------
  // Administración de estados y roles (migración 0020)
  //
  // Lo que estas funciones NO ofrecen es tan importante como lo que ofrecen:
  // no hay forma de cambiar el `code` de un estado ni las capacidades de un
  // rol, porque no existe la columna en los parches. Y eso es comodidad, no
  // seguridad: quien quiera intentarlo puede llamar a PostgREST sin pasar por
  // aquí, y se encontrará con los disparadores de la 0020.
  // ---------------------------------------------------------------------------

  /** Incluye los retirados: es la lista de administración. */
  listAllWorkStatuses: async (): Promise<WorkStatusRow[]> =>
    unwrap(await supabase.from('work_statuses').select('*').order('display_order')),

  listAllWorkRoles: async (): Promise<WorkRoleRow[]> =>
    unwrap(await supabase.from('work_roles').select('*').order('display_order')),

  createWorkStatus: async (input: StatusInsert): Promise<WorkStatusRow> =>
    unwrap(await supabase.from('work_statuses').insert(input).select('*').single()),

  /** `code` no viaja: lo rechazaría el disparador `work_statuses_code_inmutable`. */
  updateWorkStatus: async (
    id: string,
    patch: Pick<StatusUpdate, 'name' | 'color' | 'display_order' | 'is_terminal' | 'is_active'>,
  ): Promise<WorkStatusRow> =>
    unwrapUpdated(await supabase.from('work_statuses').update(patch).eq('id', id).select('*').maybeSingle(), 'este estado'),

  removeWorkStatus: async (id: string): Promise<void> => {
    const { error } = await supabase.from('work_statuses').delete().eq('id', id)
    if (error) throw error
  },

  /**
   * Un rol nuevo nace sin capacidades, y no porque este parche las omita: lo
   * impone la política `roles_insert`. Aquí solo se envía lo que clasifica.
   */
  createWorkRole: async (
    input: Pick<RoleInsert, 'code' | 'name' | 'display_order'> &
      Partial<Pick<RoleInsert, 'is_student' | 'is_supervisory'>>,
  ): Promise<WorkRoleRow> =>
    unwrap(await supabase.from('work_roles').insert(input).select('*').single()),

  updateWorkRole: async (
    id: string,
    patch: Pick<RoleUpdate, 'name' | 'display_order' | 'is_active'>,
  ): Promise<WorkRoleRow> =>
    unwrapUpdated(await supabase.from('work_roles').update(patch).eq('id', id).select('*').maybeSingle(), 'esta función académica'),

  removeWorkRole: async (id: string): Promise<void> => {
    const { error } = await supabase.from('work_roles').delete().eq('id', id)
    if (error) throw error
  },

  // ---------------------------------------------------------------------------
  // Tipos de documento y ciclo de vida por tipo de trabajo (migración 0021)
  // ---------------------------------------------------------------------------

  /** Incluye los retirados y los globales: es la lista de administración. */
  listAllDocumentTypes: async (): Promise<DocumentTypeRow[]> =>
    unwrap(await supabase.from('document_types').select('*').order('display_order')),

  createDocumentType: async (input: DocTypeInsert): Promise<DocumentTypeRow> =>
    unwrap(await supabase.from('document_types').insert(input).select('*').single()),

  /**
   * `organization_id` no viaja: lo rechazaría el disparador
   * `doctypes_org_inmutable`. Y no es una formalidad —con dos políticas
   * permisivas, el WITH CHECK no basta para impedirlo (ver 0021)—.
   */
  updateDocumentType: async (
    id: string,
    patch: Pick<DocTypeUpdate, 'name' | 'display_order' | 'is_active'>,
  ): Promise<DocumentTypeRow> =>
    unwrapUpdated(await supabase.from('document_types').update(patch).eq('id', id).select('*').maybeSingle(), 'este tipo de documento'),

  removeDocumentType: async (id: string): Promise<void> => {
    const { error } = await supabase.from('document_types').delete().eq('id', id)
    if (error) throw error
  },

  /**
   * Cuántos documentos y cuántos entregables de plantilla usan cada tipo.
   *
   * Aquí la clave ajena es `on delete set null`, no `restrict`: borrar un tipo
   * **no falla**, deja en blanco el tipo de todo lo que lo usaba y no queda
   * rastro de cuál era. Por eso el recuento no es un adorno: es lo que permite
   * decir «lo usan 4 documentos» antes de que alguien lo borre.
   */
  documentTypeUsage: async (): Promise<Record<string, number>> => {
    const docs = unwrap(await supabase.from('documents').select('document_type_id'))
    const cuenta: Record<string, number> = {}
    for (const d of docs) if (d.document_type_id) cuenta[d.document_type_id] = (cuenta[d.document_type_id] ?? 0) + 1
    return cuenta
  },

  /** Estados aplicables a un tipo: sin filas, le aplican todos los activos. */
  setWorkTypeStatuses: async (workTypeId: string, statusIds: string[]): Promise<void> => {
    const borrado = await supabase.from('work_type_statuses').delete().eq('work_type_id', workTypeId)
    if (borrado.error) throw borrado.error
    if (statusIds.length === 0) return
    const filas = statusIds.map((status_id, i) => ({
      work_type_id: workTypeId, status_id, display_order: i + 1,
    }))
    const { error } = await supabase.from('work_type_statuses').insert(filas)
    if (error) throw error
  },

  /**
   * Cuántos trabajos usan cada estado y cuántos participantes cada rol.
   *
   * Aquí las claves ajenas son `on delete restrict`, al contrario que en las
   * líneas o las titulaciones: borrar algo en uso **falla**, no deja un hueco
   * silencioso. Así que esto no está para evitar una pérdida de datos sino para
   * no ofrecer un botón que va a dar error, y para poder decir «lo usan 3
   * trabajos» antes de que alguien lo intente.
   */
  statusRoleUsage: async (): Promise<{ statuses: Record<string, number>; roles: Record<string, number> }> => {
    const trabajos = unwrap(await supabase.from('academic_works').select('status_id'))
    const miembros = unwrap(await supabase.from('work_members').select('work_role_id'))
    const statuses: Record<string, number> = {}
    const roles: Record<string, number> = {}
    for (const t of trabajos) if (t.status_id) statuses[t.status_id] = (statuses[t.status_id] ?? 0) + 1
    for (const m of miembros) if (m.work_role_id) roles[m.work_role_id] = (roles[m.work_role_id] ?? 0) + 1
    return { statuses, roles }
  },

  listAcademicLevels: async (): Promise<AcademicLevelRow[]> =>
    unwrap(await supabase.from('academic_levels').select('*').order('display_order')),

  listAcademicYears: async (): Promise<AcademicYearRow[]> =>
    unwrap(await supabase.from('academic_years').select('*').order('code', { ascending: false })),

  listPrograms: async (): Promise<ProgramRow[]> =>
    unwrap(await supabase.from('programs').select('*').eq('is_active', true).order('name')),

  // Las dos listas de líneas pasan por `ordenarConOtrosAlFinal`: si solo lo
  // hiciera el selector de alta, la pantalla de administración y el formulario
  // mostrarían el mismo catálogo en dos órdenes distintos.
  listResearchLines: async (): Promise<ResearchLineRow[]> =>
    ordenarConOtrosAlFinal(
      unwrap(await supabase.from('research_lines').select('*').eq('is_active', true).order('name')),
    ),

  // -------------------------------------------------------------------------
  // Administración de los catálogos planos (líneas, titulaciones, cursos).
  //
  // Las listas de administración NO filtran por `is_active`: desde el panel hay
  // que ver también lo retirado, que es justo lo que no debe aparecer en los
  // formularios. Son métodos aparte y no una opción del mismo, para que no
  // quepa pasar `includeInactive` por descuido en un selector de alta.
  // -------------------------------------------------------------------------
  listAllResearchLines: async (): Promise<ResearchLineRow[]> =>
    ordenarConOtrosAlFinal(unwrap(await supabase.from('research_lines').select('*').order('name'))),

  createResearchLine: async (input: LineInsert): Promise<ResearchLineRow> =>
    unwrap(await supabase.from('research_lines').insert(input).select('*').single()),

  updateResearchLine: async (id: string, patch: LineUpdate): Promise<ResearchLineRow> =>
    unwrapUpdated(await supabase.from('research_lines').update(patch).eq('id', id).select('*').maybeSingle(), 'esta línea de investigación'),

  removeResearchLine: async (id: string): Promise<void> => {
    const { error } = await supabase.from('research_lines').delete().eq('id', id)
    if (error) throw error
  },

  listAllPrograms: async (): Promise<ProgramRow[]> =>
    unwrap(await supabase.from('programs').select('*').order('name')),

  createProgram: async (input: ProgramInsert): Promise<ProgramRow> =>
    unwrap(await supabase.from('programs').insert(input).select('*').single()),

  updateProgram: async (id: string, patch: ProgramUpdate): Promise<ProgramRow> =>
    unwrapUpdated(await supabase.from('programs').update(patch).eq('id', id).select('*').maybeSingle(), 'esta titulación'),

  removeProgram: async (id: string): Promise<void> => {
    const { error } = await supabase.from('programs').delete().eq('id', id)
    if (error) throw error
  },

  listAllAcademicYears: async (): Promise<AcademicYearRow[]> =>
    unwrap(await supabase.from('academic_years').select('*').order('code', { ascending: false })),

  createAcademicYear: async (input: YearInsert): Promise<AcademicYearRow> =>
    unwrap(await supabase.from('academic_years').insert(input).select('*').single()),

  updateAcademicYear: async (id: string, patch: YearUpdate): Promise<AcademicYearRow> =>
    unwrapUpdated(await supabase.from('academic_years').update(patch).eq('id', id).select('*').maybeSingle(), 'este curso académico'),

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
