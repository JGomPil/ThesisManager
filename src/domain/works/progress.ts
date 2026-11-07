import { differenceInCalendarDays, isAfter, parseISO } from 'date-fns'
import type { TaskStatus } from '@/data/types/database'

/**
 * Progreso de un trabajo. DOS cifras distintas que no deben confundirse
 * (requisito explícito del proyecto):
 *
 *  · `taskCompletion`: porcentaje de tareas completadas. Dato mecánico.
 *  · `academicProgress`: juicio del supervisor (`progress_override`).
 *
 * La interfaz muestra ambas etiquetadas y nunca presenta la primera como si
 * fuera la segunda. Un trabajo puede tener el 90 % de las tareas hechas y un
 * progreso académico del 40 % porque el capítulo central hay que reescribirlo.
 */
export type WorkProgress = {
  taskCompletion: number | null
  academicProgress: number | null
  totalTasks: number
  completedTasks: number
  overdueTasks: number
  blockedTasks: number
}

/**
 * Progreso del trabajo a partir de sus tareas.
 *
 * SOLO CUENTA LAS TAREAS DE PRIMER NIVEL. Las subtareas son los puntos de las
 * listas de comprobación, y contarlas falsearía la cifra en los dos sentidos:
 * una tarea grande con diez puntos pesaría diez veces más que una sin lista, y
 * marcar puntos sueltos subiría el progreso del trabajo sin haber terminado
 * nada. El avance de una lista se ve dentro de su tarea, que es donde
 * significa algo.
 *
 * Acepta tareas con `parent_task_id` opcional para que quien llame pueda
 * pasarle la lista completa sin filtrar: el filtro vive aquí, con la regla.
 */
export function computeWorkProgress(
  allTasks: { status: TaskStatus; due_date: string | null; parent_task_id?: string | null }[],
  progressOverride: number | null,
  today = new Date(),
): WorkProgress {
  const tasks = allTasks.filter((t) => (t.parent_task_id ?? null) === null)
  const total = tasks.length
  const completed = tasks.filter((t) => t.status === 'COMPLETADA').length
  const overdue = tasks.filter(
    (t) => t.status !== 'COMPLETADA' && t.due_date !== null && isAfter(today, parseISO(t.due_date)),
  ).length
  const blocked = tasks.filter((t) => t.status === 'BLOQUEADA').length

  return {
    taskCompletion: total === 0 ? null : Math.round((completed / total) * 100),
    academicProgress: progressOverride,
    totalTasks: total,
    completedTasks: completed,
    overdueTasks: overdue,
    blockedTasks: blocked,
  }
}

/** Días restantes hasta la fecha prevista. Negativo = retraso. */
export function daysUntil(date: string | null, today = new Date()): number | null {
  if (!date) return null
  return differenceInCalendarDays(parseISO(date), today)
}

export type AttentionReason = 'OVERDUE_TASKS' | 'BLOCKED_TASKS' | 'DEADLINE_SOON' | 'PAST_DEADLINE' | 'NO_PLAN'

/** Señales de que un trabajo necesita atención. Orden: de más grave a menos. */
export function attentionReasons(
  progress: WorkProgress,
  expectedEndDate: string | null,
  isTerminal: boolean,
  today = new Date(),
): AttentionReason[] {
  if (isTerminal) return []
  const reasons: AttentionReason[] = []
  const days = daysUntil(expectedEndDate, today)

  if (days !== null && days < 0) reasons.push('PAST_DEADLINE')
  if (progress.blockedTasks > 0) reasons.push('BLOCKED_TASKS')
  if (progress.overdueTasks > 0) reasons.push('OVERDUE_TASKS')
  if (days !== null && days >= 0 && days <= 30) reasons.push('DEADLINE_SOON')
  if (progress.totalTasks === 0) reasons.push('NO_PLAN')

  return reasons
}

/**
 * Gravedad de un trabajo, para ordenar una lista: cuanto más bajo, más urgente.
 *
 * `attentionReasons` ya devuelve sus motivos de más grave a menos, así que la
 * gravedad de un trabajo es la de su primer motivo. Hace falta porque la
 * tarjeta del resumen muestra unos pocos trabajos y hasta ahora enseñaba los
 * primeros que venían de la consulta: un trabajo con la fecha superada podía
 * quedarse fuera de la lista mientras se mostraba otro al que solo le faltaba
 * el plan. Un aviso que no prioriza no es un aviso, es una lista.
 */
const GRAVEDAD: Record<AttentionReason, number> = {
  PAST_DEADLINE: 0,
  BLOCKED_TASKS: 1,
  OVERDUE_TASKS: 2,
  DEADLINE_SOON: 3,
  NO_PLAN: 4,
}

export function attentionSeverity(reasons: AttentionReason[]): number {
  if (reasons.length === 0) return Number.MAX_SAFE_INTEGER
  return Math.min(...reasons.map((r) => GRAVEDAD[r]))
}

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  PAST_DEADLINE: 'Fecha prevista superada',
  BLOCKED_TASKS: 'Tareas bloqueadas',
  OVERDUE_TASKS: 'Tareas atrasadas',
  DEADLINE_SOON: 'Entrega en menos de un mes',
  NO_PLAN: 'Sin planificación',
}
