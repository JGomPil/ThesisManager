import { addDays, differenceInCalendarDays, parseISO } from 'date-fns'

/**
 * Geometría del diagrama de Gantt.
 *
 * Todo el cálculo vive aquí y devuelve números, para que el componente SVG no
 * tenga nada que decidir y esto se pueda probar sin montar nada. Es también la
 * razón de no traer una librería de Gantt: el dibujo son rectángulos y el
 * cálculo es este fichero; una dependencia nueva traería su propio CSS, su
 * propio modelo de datos y su propio peso al bundle para resolver un problema
 * que no tenemos.
 */

export type GanttInput = {
  id: string
  title: string
  start_date: string | null
  due_date: string | null
  status: string
  parent_task_id: string | null
}

export type GanttBar = {
  id: string
  title: string
  x: number
  width: number
  y: number
  status: string
  isSubtask: boolean
  /** Sin fechas no hay barra; se lista aparte para no esconder la tarea. */
  hasDates: boolean
}

export type GanttMark = { id: string; title: string; x: number; y: number; isMet: boolean }
export type GanttTick = { x: number; label: string; isMonthStart: boolean }

export type GanttLayout = {
  bars: GanttBar[]
  marks: GanttMark[]
  ticks: GanttTick[]
  undated: GanttInput[]
  width: number
  height: number
  todayX: number | null
  from: Date
  to: Date
}

export const ROW_HEIGHT = 26
export const HEADER_HEIGHT = 28

/**
 * Ventana temporal del diagrama: de la fecha más temprana a la más tardía, con
 * tres días de margen a cada lado para que una barra no muera pegada al borde.
 * Si no hay ninguna fecha, se centra en hoy en lugar de devolver un rango vacío
 * que daría una división por cero al calcular la escala.
 */
export function ganttRange(
  items: { start_date: string | null; due_date: string | null }[],
  today = new Date(),
): { from: Date; to: Date } {
  const fechas: Date[] = []
  for (const i of items) {
    if (i.start_date) fechas.push(parseISO(i.start_date))
    if (i.due_date) fechas.push(parseISO(i.due_date))
  }
  if (fechas.length === 0) return { from: addDays(today, -15), to: addDays(today, 15) }

  const min = fechas.reduce((a, b) => (a < b ? a : b))
  const max = fechas.reduce((a, b) => (a > b ? a : b))
  // Un plan de un solo día daría anchura cero: se garantiza un mínimo.
  const to = differenceInCalendarDays(max, min) < 7 ? addDays(min, 7) : max
  return { from: addDays(min, -3), to: addDays(to, 3) }
}

export function buildGantt(
  tasks: GanttInput[],
  milestones: { id: string; name: string; due_date: string; is_met: boolean }[],
  options: { pxPerDay?: number; today?: Date } = {},
): GanttLayout {
  const today = options.today ?? new Date()
  const pxPerDay = options.pxPerDay ?? 8
  const { from, to } = ganttRange(
    [...tasks, ...milestones.map((m) => ({ start_date: m.due_date, due_date: m.due_date }))],
    today,
  )

  const dias = Math.max(differenceInCalendarDays(to, from), 1)
  const width = dias * pxPerDay
  const x = (d: Date) => differenceInCalendarDays(d, from) * pxPerDay

  const conFechas = tasks.filter((t) => t.start_date || t.due_date)
  const undated = tasks.filter((t) => !t.start_date && !t.due_date)

  const bars: GanttBar[] = conFechas.map((t, i) => {
    // Una tarea con solo una de las dos fechas se dibuja como un bloque de un
    // día en esa fecha, en lugar de no dibujarse: el hueco en el plan es
    // información, y esconderlo hace creer que la tarea no existe.
    const ini = t.start_date ? parseISO(t.start_date) : parseISO(t.due_date!)
    const fin = t.due_date ? parseISO(t.due_date) : parseISO(t.start_date!)
    const x0 = x(ini)
    return {
      id: t.id,
      title: t.title,
      x: x0,
      width: Math.max((differenceInCalendarDays(fin, ini) + 1) * pxPerDay, pxPerDay),
      y: HEADER_HEIGHT + i * ROW_HEIGHT,
      status: t.status,
      isSubtask: t.parent_task_id !== null,
      hasDates: true,
    }
  })

  const marks: GanttMark[] = milestones.map((m) => ({
    id: m.id,
    title: m.name,
    x: x(parseISO(m.due_date)),
    y: HEADER_HEIGHT,
    isMet: m.is_met,
  }))

  // Una marca por día 1 de mes, y una cada lunes si el plan es corto. En planes
  // de año y medio, etiquetar semanas llena la cabecera de texto ilegible.
  const ticks: GanttTick[] = []
  const porSemanas = dias <= 120
  for (let d = 0; d <= dias; d++) {
    const fecha = addDays(from, d)
    const esInicioMes = fecha.getDate() === 1
    const esLunes = fecha.getDay() === 1
    if (esInicioMes || (porSemanas && esLunes)) {
      ticks.push({
        x: x(fecha),
        label: esInicioMes
          ? fecha.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })
          : String(fecha.getDate()),
        isMonthStart: esInicioMes,
      })
    }
  }

  const dentro = today >= from && today <= to
  return {
    bars,
    marks,
    ticks,
    undated,
    width,
    height: HEADER_HEIGHT + Math.max(bars.length, 1) * ROW_HEIGHT,
    todayX: dentro ? x(today) : null,
    from,
    to,
  }
}
