import {
  attentionReasons, computeWorkProgress, daysUntil,
  type AttentionReason, type WorkProgress,
} from '@/domain/works/progress'
import type { TaskStatus } from '@/data/types/database'

/**
 * Agregación para los informes. TODO el cálculo vive aquí, en funciones puras y
 * con pruebas, por las mismas razones que el Gantt: una cifra equivocada en un
 * informe de seguimiento no se nota —parece un dato— y acaba en una reunión de
 * comisión. Las pantallas solo dibujan.
 *
 * LO QUE ESTAS CIFRAS SON, Y HAY QUE DECIRLO EN LA PANTALLA
 * Se calculan sobre lo que RLS ha devuelto a quien mira, no sobre el grupo
 * entero. Un director ve los indicadores de SUS trabajos; la administración, de
 * todos. Es la consecuencia correcta de los permisos, pero presentada sin
 * aclararlo parecería un total institucional, y eso sí sería un error de dato.
 *
 * LAS DOS CIFRAS DE PROGRESO NO SE FUNDEN NUNCA (criterio explícito del
 * proyecto): `taskCompletion` es mecánica y `academicProgress` es el juicio del
 * supervisor. Aquí se arrastran separadas hasta el CSV, donde son dos columnas
 * distintas con dos títulos distintos.
 */

export type ReportTask = {
  work_id: string
  status: TaskStatus
  due_date: string | null
  parent_task_id: string | null
}

export type ReportMilestone = {
  work_id: string
  due_date: string
  is_met: boolean
}

/** Lo que el informe necesita de un trabajo. Estructural a propósito: `WorkWithRelations` encaja. */
export type ReportWork = {
  id: string
  title: string
  start_date: string | null
  expected_end_date: string | null
  actual_end_date: string | null
  defense_date: string | null
  progress_override: number | null
  work_type: { name: string; short_name: string } | null
  status: { name: string; color: string; is_terminal: boolean } | null
  academic_year: { code: string } | null
  program: { name: string } | null
  research_line: { name: string } | null
  members: {
    user_id: string
    status: string
    is_primary: boolean
    role: { is_student: boolean; is_supervisory: boolean } | null
    profile: { id: string; full_name: string } | null
  }[]
}

export type PersonLite = { id: string; name: string }

export type WorkReportRow = {
  id: string
  title: string
  typeName: string
  typeShort: string
  statusName: string
  statusColor: string
  isTerminal: boolean
  academicYear: string
  programName: string
  researchLine: string
  startDate: string | null
  expectedEndDate: string | null
  actualEndDate: string | null
  defenseDate: string | null
  /** Días hasta la fecha prevista; negativo = retraso. Nulo si no hay fecha. */
  daysToEnd: number | null
  progress: WorkProgress
  totalMilestones: number
  metMilestones: number
  overdueMilestones: number
  attention: AttentionReason[]
  students: PersonLite[]
  supervisors: PersonLite[]
  primarySupervisor: PersonLite | null
}

const VACIO = '—'

/**
 * Una fila de informe por trabajo.
 *
 * Las tareas y los hitos llegan en una sola lista cada uno, de todos los
 * trabajos visibles, y se agrupan aquí: pedirlos trabajo por trabajo serían
 * decenas de peticiones para construir una tabla, y el plan gratuito se mide en
 * peticiones. Agrupar en memoria unas centenas de filas no cuesta nada.
 */
export function buildWorkReports(
  works: ReportWork[],
  tasks: ReportTask[],
  milestones: ReportMilestone[],
  today = new Date(),
): WorkReportRow[] {
  const porTrabajo = new Map<string, ReportTask[]>()
  for (const t of tasks) {
    const lista = porTrabajo.get(t.work_id)
    if (lista) lista.push(t)
    else porTrabajo.set(t.work_id, [t])
  }
  const hitosPorTrabajo = new Map<string, ReportMilestone[]>()
  for (const m of milestones) {
    const lista = hitosPorTrabajo.get(m.work_id)
    if (lista) lista.push(m)
    else hitosPorTrabajo.set(m.work_id, [m])
  }
  const hoy = today.toISOString().slice(0, 10)

  return works.map((w) => {
    const activos = w.members.filter((m) => m.status === 'ACTIVE')
    const persona = (m: ReportWork['members'][number]): PersonLite => ({
      id: m.profile?.id ?? m.user_id,
      name: m.profile?.full_name ?? 'Sin nombre',
    })
    const students = activos.filter((m) => m.role?.is_student).map(persona)
    const supervisores = activos.filter((m) => m.role?.is_supervisory)
    const progress = computeWorkProgress(porTrabajo.get(w.id) ?? [], w.progress_override, today)
    const hitos = hitosPorTrabajo.get(w.id) ?? []
    const isTerminal = w.status?.is_terminal ?? false

    return {
      id: w.id,
      title: w.title,
      typeName: w.work_type?.name ?? VACIO,
      typeShort: w.work_type?.short_name ?? VACIO,
      statusName: w.status?.name ?? VACIO,
      statusColor: w.status?.color ?? 'slate',
      isTerminal,
      academicYear: w.academic_year?.code ?? VACIO,
      programName: w.program?.name ?? VACIO,
      researchLine: w.research_line?.name ?? VACIO,
      startDate: w.start_date,
      expectedEndDate: w.expected_end_date,
      actualEndDate: w.actual_end_date,
      defenseDate: w.defense_date,
      daysToEnd: daysUntil(w.expected_end_date, today),
      progress,
      totalMilestones: hitos.length,
      metMilestones: hitos.filter((m) => m.is_met).length,
      // Un hito vencido es el que NO se ha cumplido y cuya fecha ya pasó. Se
      // compara en texto ISO a propósito: las fechas de hito son fechas sin
      // hora, y pasarlas por `Date` las movería con el huso.
      overdueMilestones: hitos.filter((m) => !m.is_met && m.due_date < hoy).length,
      attention: attentionReasons(progress, w.expected_end_date, isTerminal, today),
      students,
      supervisors: supervisores.map(persona),
      primarySupervisor: supervisores.find((m) => m.is_primary)
        ? persona(supervisores.find((m) => m.is_primary)!)
        : (supervisores[0] ? persona(supervisores[0]) : null),
    }
  })
}

export type Bucket = { label: string; total: number; late: number; color?: string }

export type Indicators = {
  total: number
  active: number
  finished: number
  late: number
  withoutPlan: number
  /** Trabajos cuya fecha prevista cae en los próximos 30 días y no han terminado. */
  endingSoon: number
  byType: Bucket[]
  byStatus: Bucket[]
  byYear: Bucket[]
}

/** Un trabajo cuenta como «con retraso» si pasó su fecha prevista o tiene tareas vencidas. */
export function isLate(row: WorkReportRow): boolean {
  return row.attention.includes('PAST_DEADLINE') || row.attention.includes('OVERDUE_TASKS')
}

export function summarize(rows: WorkReportRow[]): Indicators {
  const agrupa = (clave: (r: WorkReportRow) => string, color?: (r: WorkReportRow) => string): Bucket[] => {
    const m = new Map<string, Bucket>()
    for (const r of rows) {
      const k = clave(r)
      const b = m.get(k) ?? { label: k, total: 0, late: 0, ...(color ? { color: color(r) } : {}) }
      b.total += 1
      if (isLate(r)) b.late += 1
      m.set(k, b)
    }
    return [...m.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'es'))
  }

  return {
    total: rows.length,
    active: rows.filter((r) => !r.isTerminal).length,
    finished: rows.filter((r) => r.isTerminal).length,
    late: rows.filter(isLate).length,
    withoutPlan: rows.filter((r) => !r.isTerminal && r.progress.totalTasks === 0).length,
    endingSoon: rows.filter((r) => !r.isTerminal && r.daysToEnd !== null && r.daysToEnd >= 0 && r.daysToEnd <= 30).length,
    byType: agrupa((r) => r.typeShort),
    byStatus: agrupa((r) => r.statusName, (r) => r.statusColor),
    byYear: agrupa((r) => r.academicYear),
  }
}

export type PersonReport = {
  id: string
  name: string
  works: WorkReportRow[]
  active: number
  late: number
  overdueTasks: number
}

/**
 * Informe por persona. `papel` decide si se agrupa por estudiante o por quien
 * supervisa, porque los roles NO son excluyentes: la misma persona puede ser
 * doctoranda de su tesis y directora de un TFG, y debe aparecer en los dos
 * listados con sus trabajos correspondientes. Esa es justo la razón de que no
 * valga un único «informe por persona».
 */
export function byPerson(rows: WorkReportRow[], papel: 'student' | 'supervisor'): PersonReport[] {
  const m = new Map<string, PersonReport>()
  for (const r of rows) {
    const gente = papel === 'student' ? r.students : r.supervisors
    for (const p of gente) {
      const actual = m.get(p.id) ?? { id: p.id, name: p.name, works: [], active: 0, late: 0, overdueTasks: 0 }
      actual.works.push(r)
      if (!r.isTerminal) actual.active += 1
      if (isLate(r)) actual.late += 1
      actual.overdueTasks += r.progress.overdueTasks
      m.set(p.id, actual)
    }
  }
  return [...m.values()].sort((a, b) => b.active - a.active || a.name.localeCompare(b.name, 'es'))
}

export const CSV_HEADERS = [
  'Título', 'Tipo', 'Estado', 'Curso', 'Titulación', 'Línea de investigación',
  'Estudiante(s)', 'Dirección principal', 'Toda la dirección',
  'Inicio', 'Fin previsto', 'Días para el fin', 'Fin real', 'Defensa',
  'Tareas', 'Tareas completadas', '% tareas completadas', 'Progreso académico (%)',
  'Tareas atrasadas', 'Tareas bloqueadas',
  'Hitos', 'Hitos cumplidos', 'Hitos vencidos', 'Señales de atención',
] as const

/**
 * CSV para abrir en Excel o LibreOffice.
 *
 * SEPARADOR `;`, no coma: Excel en configuración regional española espera punto
 * y coma y con comas mete toda la fila en una sola celda. El BOM de UTF-8 lo
 * pone quien descarga (`reports.repo`), que es donde se construye el fichero;
 * sin él, Excel abre «Dirección» como «DirecciÃ³n».
 *
 * NO SE EXPORTA NADA que no esté ya en la pantalla: el CSV sale de las mismas
 * filas. En particular, ninguna nota privada de reunión; la política ya se lo
 * negaría al cliente, pero conviene que esta función tampoco sepa de ellas.
 */
export function toCsv(rows: WorkReportRow[], labels: Record<AttentionReason, string>): string {
  const esc = (v: string | number | null): string => {
    if (v === null) return ''
    const s = String(v)
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const linea = (celdas: (string | number | null)[]) => celdas.map(esc).join(';')

  const cuerpo = rows.map((r) => linea([
    r.title, r.typeName, r.statusName, r.academicYear, r.programName, r.researchLine,
    r.students.map((s) => s.name).join(' / '),
    r.primarySupervisor?.name ?? '',
    r.supervisors.map((s) => s.name).join(' / '),
    r.startDate, r.expectedEndDate, r.daysToEnd, r.actualEndDate, r.defenseDate,
    r.progress.totalTasks, r.progress.completedTasks,
    r.progress.taskCompletion, r.progress.academicProgress,
    r.progress.overdueTasks, r.progress.blockedTasks,
    r.totalMilestones, r.metMilestones, r.overdueMilestones,
    r.attention.map((a) => labels[a]).join(' / '),
  ]))

  return [linea([...CSV_HEADERS]), ...cuerpo].join('\r\n')
}
