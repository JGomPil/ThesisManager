import {
  addDays, eachDayOfInterval, endOfMonth, endOfWeek, format, parseISO,
  startOfMonth, startOfWeek,
} from 'date-fns'

/**
 * Eventos del calendario.
 *
 * Reúne en una sola lista cosas que viven en tablas distintas —tareas, hitos y
 * reuniones— porque para quien lo mira son lo mismo: cosas que pasan un día.
 *
 * NO FILTRA NADA POR PERMISOS, y no es un descuido: cada consulta ya viene
 * filtrada por RLS, de modo que lo que llega aquí es exactamente lo que esa
 * persona puede ver. El criterio de aceptación de la fase («cada usuario ve en
 * el calendario solo los eventos de sus trabajos») se cumple en la base de
 * datos, no en esta función; si se intentara cumplir aquí, habría dos reglas
 * que mantener a la vez y una de ellas se quedaría atrás.
 */

export type EventKind = 'TASK_DUE' | 'TASK_START' | 'MEETING' | 'MILESTONE'

export type CalendarEvent = {
  id: string
  /** Día en formato yyyy-MM-dd, que es la clave de la rejilla. */
  day: string
  kind: EventKind
  title: string
  workId: string
  workTitle: string | null
  /** Hora, solo cuando el evento la tiene (las reuniones). */
  time: string | null
  /**
   * El instante exacto, en UTC, de lo que tiene hora. Solo las reuniones.
   *
   * `day` y `time` ya están en la zona de quien mira, que es lo que necesita
   * la rejilla; este campo guarda el original porque la exportación a
   * iCalendar necesita el instante, no la hora local: escribir «15:30» sin
   * zona deja una hora flotante que cada calendario interpreta en la suya.
   */
  at: string | null
  /** Duración en minutos, cuando se sabe (reuniones). */
  minutes: number | null
  /** Dónde, cuando se sabe (reuniones). */
  location: string | null
  done: boolean
  href: string
}

type TaskLike = {
  id: string; title: string; work_id: string; status: string
  start_date: string | null; due_date: string | null
  work?: { title: string } | null
}
type MeetingLike = {
  id: string; title: string; work_id: string; scheduled_at: string
  duration_min?: number | null; location?: string | null
  work?: { title: string } | null
}
type MilestoneLike = {
  id: string; name: string; work_id: string; due_date: string; is_met: boolean
  work?: { title: string } | null
}

export function collectEvents(input: {
  tasks?: TaskLike[]
  meetings?: MeetingLike[]
  milestones?: MilestoneLike[]
}): CalendarEvent[] {
  const eventos: CalendarEvent[] = []

  for (const t of input.tasks ?? []) {
    const base = {
      workId: t.work_id,
      workTitle: t.work?.title ?? null,
      time: null,
      at: null,
      minutes: null,
      location: null,
      href: `/trabajos/${t.work_id}`,
      done: t.status === 'COMPLETADA',
    }
    // El inicio y el vencimiento son dos eventos distintos: ver solo el segundo
    // oculta cuándo había que ponerse, que es la mitad de la planificación.
    if (t.start_date) {
      eventos.push({ ...base, id: `${t.id}-ini`, day: t.start_date, kind: 'TASK_START', title: t.title })
    }
    if (t.due_date) {
      eventos.push({ ...base, id: `${t.id}-fin`, day: t.due_date, kind: 'TASK_DUE', title: t.title })
    }
  }

  for (const m of input.meetings ?? []) {
    const fecha = parseISO(m.scheduled_at)
    eventos.push({
      id: m.id,
      day: format(fecha, 'yyyy-MM-dd'),
      kind: 'MEETING',
      title: m.title,
      workId: m.work_id,
      workTitle: m.work?.title ?? null,
      time: format(fecha, 'HH:mm'),
      at: m.scheduled_at,
      minutes: m.duration_min ?? null,
      location: m.location ?? null,
      done: false,
      href: `/trabajos/${m.work_id}`,
    })
  }

  for (const h of input.milestones ?? []) {
    eventos.push({
      id: h.id,
      day: h.due_date,
      kind: 'MILESTONE',
      title: h.name,
      workId: h.work_id,
      workTitle: h.work?.title ?? null,
      time: null,
      at: null,
      minutes: null,
      location: null,
      done: h.is_met,
      href: `/trabajos/${h.work_id}`,
    })
  }

  return eventos.sort((a, b) => (a.day === b.day ? orden(a) - orden(b) : a.day < b.day ? -1 : 1))
}

// Dentro de un mismo día: primero lo que tiene hora, luego hitos, luego tareas.
const PESO: Record<EventKind, number> = { MEETING: 0, MILESTONE: 1, TASK_DUE: 2, TASK_START: 3 }
const orden = (e: CalendarEvent) => PESO[e.kind]

export function groupByDay(eventos: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const m = new Map<string, CalendarEvent[]>()
  for (const e of eventos) {
    const prev = m.get(e.day)
    if (prev) prev.push(e)
    else m.set(e.day, [e])
  }
  return m
}

/**
 * Rejilla del mes, siempre en semanas completas de lunes a domingo.
 *
 * Devuelve los días de los meses vecinos que completan la primera y la última
 * semana: una rejilla con huecos obliga a quien la lee a contar casillas.
 */
export function monthGrid(month: Date): { day: string; inMonth: boolean }[][] {
  const ini = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
  const fin = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
  const dias = eachDayOfInterval({ start: ini, end: fin })
  const mes = month.getMonth()

  const semanas: { day: string; inMonth: boolean }[][] = []
  for (let i = 0; i < dias.length; i += 7) {
    semanas.push(
      dias.slice(i, i + 7).map((d) => ({ day: format(d, 'yyyy-MM-dd'), inMonth: d.getMonth() === mes })),
    )
  }
  return semanas
}

/** Días de la semana que contiene `date`, de lunes a domingo. */
export function weekDays(date: Date): string[] {
  const ini = startOfWeek(date, { weekStartsOn: 1 })
  return Array.from({ length: 7 }, (_, i) => format(addDays(ini, i), 'yyyy-MM-dd'))
}

export const KIND_LABELS: Record<EventKind, string> = {
  TASK_START: 'Inicio de tarea',
  TASK_DUE: 'Vencimiento de tarea',
  MEETING: 'Reunión',
  MILESTONE: 'Hito',
}

/**
 * LOS MISMOS CUATRO TIPOS, EN UNA PALABRA CADA UNO.
 *
 * `KIND_LABELS` describe UN evento («Vencimiento de tarea») y así tiene que
 * seguir: es lo que se lee en la agenda, en el `title` de un enlace y en la
 * descripción del fichero `.ics`. Pero las pastillas de la barra de filtros son
 * otra cosa —un interruptor para una categoría— y ahí esos rótulos sumaban unos
 * 400 px: en un teléfono de 390 px se salían por la derecha, y al ensanchar la
 * página descolocaban todo lo demás. En plural, porque lo que se enciende y se
 * apaga es el conjunto, no un evento.
 */
export const KIND_LABELS_FILTRO: Record<EventKind, string> = {
  TASK_START: 'Inicios',
  TASK_DUE: 'Vencimientos',
  MEETING: 'Reuniones',
  MILESTONE: 'Hitos',
}

export const KIND_TONES: Record<EventKind, string> = {
  TASK_START: 'slate',
  TASK_DUE: 'amber',
  MEETING: 'blue',
  MILESTONE: 'violet',
}
