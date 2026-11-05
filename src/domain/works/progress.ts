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

export function computeWorkProgress(
  tasks: { status: TaskStatus; due_date: string | null }[],
  progressOverride: number | null,
  today = new Date(),
): WorkProgress {
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

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  PAST_DEADLINE: 'Fecha prevista superada',
  BLOCKED_TASKS: 'Tareas bloqueadas',
  OVERDUE_TASKS: 'Tareas atrasadas',
  DEADLINE_SOON: 'Entrega en menos de un mes',
  NO_PLAN: 'Sin planificación',
}
