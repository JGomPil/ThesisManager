import { supabase } from '@/lib/supabase'
import { worksRepo, type WorkFilters, type WorkWithRelations } from '@/data/repositories/works.repo'
import type { ReportMilestone, ReportTask } from '@/domain/reports/aggregate'

/**
 * Datos para los informes: tres consultas, no una por trabajo.
 *
 * Las tareas y los hitos se piden ENTEROS (de todos los trabajos visibles) y se
 * agrupan en memoria. Pedirlos trabajo por trabajo serían decenas de peticiones
 * para pintar una tabla, y el plan gratuito de Supabase se mide en peticiones;
 * agrupar unas centenas de filas en el navegador no cuesta nada.
 *
 * No se filtra por usuario en ningún sitio: RLS devuelve lo accesible y nada
 * más. La consecuencia, que la pantalla dice en voz alta, es que los
 * indicadores son los de QUIEN MIRA: un director ve los suyos, la
 * administración ve todos.
 */

export type ReportSnapshot = {
  works: WorkWithRelations[]
  tasks: ReportTask[]
  milestones: ReportMilestone[]
  /**
   * Si PostgREST ha recortado alguna de las listas. Importa de verdad: con la
   * lista recortada los totales saldrían MENORES de lo real y parecerían
   * buenos. Es el peor fallo posible en un informe, porque no se nota. La
   * pantalla avisa en vez de mostrar una cifra falsa.
   */
  truncated: boolean
  truncatedWhat: string[]
}

/** Techo propio, por debajo del de PostgREST, para que el recorte se detecte aquí. */
const TECHO = 5000

async function lista<T>(
  tabla: 'tasks' | 'milestones',
  columnas: string,
): Promise<{ rows: T[]; truncated: boolean }> {
  const { data, error, count } = await supabase
    .from(tabla)
    .select(columnas, { count: 'exact' })
    .limit(TECHO)
  if (error) throw error
  const rows = (data ?? []) as unknown as T[]
  return { rows, truncated: count !== null && count > rows.length }
}

export const reportsRepo = {
  load: async (filters: WorkFilters = {}): Promise<ReportSnapshot> => {
    const [works, tareas, hitos] = await Promise.all([
      worksRepo.list(filters),
      lista<ReportTask>('tasks', 'work_id,status,due_date,parent_task_id'),
      lista<ReportMilestone>('milestones', 'work_id,due_date,is_met'),
    ])

    // Las tareas y los hitos se piden sin filtrar por trabajo —no hay forma
    // razonable de pasar una lista larga de identificadores a PostgREST— y se
    // recortan aquí a los trabajos que el informe muestra. Si no, un filtro de
    // tipo o de curso dejaría los totales de la tabla correctos y los
    // indicadores globales contando trabajos que no están a la vista.
    const visibles = new Set(works.map((w) => w.id))
    const truncatedWhat = [
      ...(tareas.truncated ? ['tareas'] : []),
      ...(hitos.truncated ? ['hitos'] : []),
    ]

    return {
      works,
      tasks: tareas.rows.filter((t) => visibles.has(t.work_id)),
      milestones: hitos.rows.filter((m) => visibles.has(m.work_id)),
      truncated: truncatedWhat.length > 0,
      truncatedWhat,
    }
  },
}
