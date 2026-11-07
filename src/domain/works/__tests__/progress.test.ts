import { describe, expect, it } from 'vitest'
import {
  attentionReasons, attentionSeverity, computeWorkProgress, daysUntil,
} from '../progress'
import { statusesForWorkType } from '../statuses'
import type { WorkStatusRow, WorkTypeStatusRow } from '@/data/types/database'

const HOY = new Date('2026-11-05T12:00:00Z')

describe('computeWorkProgress', () => {
  it('distingue el porcentaje de tareas del progreso académico', () => {
    const p = computeWorkProgress(
      [
        { status: 'COMPLETADA', due_date: null },
        { status: 'COMPLETADA', due_date: null },
        { status: 'EN_CURSO', due_date: null },
        { status: 'PENDIENTE', due_date: null },
      ],
      40, // el supervisor dice 40 % aunque haya el 50 % de tareas hechas
      HOY,
    )
    expect(p.taskCompletion).toBe(50)
    expect(p.academicProgress).toBe(40)
  })

  it('sin tareas no inventa un 0 %: devuelve null', () => {
    const p = computeWorkProgress([], null, HOY)
    expect(p.taskCompletion).toBeNull()
    expect(p.totalTasks).toBe(0)
  })

  it('cuenta atrasadas y bloqueadas, y no cuenta como atrasada una completada', () => {
    const p = computeWorkProgress(
      [
        { status: 'PENDIENTE', due_date: '2026-10-01' },
        { status: 'BLOQUEADA', due_date: '2026-12-01' },
        { status: 'COMPLETADA', due_date: '2026-01-01' },
      ],
      null,
      HOY,
    )
    expect(p.overdueTasks).toBe(1)
    expect(p.blockedTasks).toBe(1)
  })
})

describe('daysUntil', () => {
  it('devuelve días restantes y negativo si ya pasó', () => {
    expect(daysUntil('2026-11-15', HOY)).toBe(10)
    expect(daysUntil('2026-10-26', HOY)).toBe(-10)
    expect(daysUntil(null, HOY)).toBeNull()
  })
})

describe('attentionReasons', () => {
  it('un trabajo finalizado no necesita atención', () => {
    const p = computeWorkProgress([{ status: 'PENDIENTE', due_date: '2020-01-01' }], null, HOY)
    expect(attentionReasons(p, '2020-01-01', true, HOY)).toEqual([])
  })

  it('detecta fecha superada y tareas atrasadas, de más grave a menos', () => {
    const p = computeWorkProgress([{ status: 'PENDIENTE', due_date: '2026-10-01' }], null, HOY)
    const r = attentionReasons(p, '2026-10-30', false, HOY)
    expect(r[0]).toBe('PAST_DEADLINE')
    expect(r).toContain('OVERDUE_TASKS')
  })

  it('avisa de un trabajo sin planificación', () => {
    const p = computeWorkProgress([], null, HOY)
    expect(attentionReasons(p, null, false, HOY)).toContain('NO_PLAN')
  })

  /**
   * La regresión de verdad: un trabajo CON tareas no está «sin planificación».
   *
   * Parece una obviedad y fue un fallo real en el resumen, que llamaba a
   * `computeWorkProgress([], …)` con una lista vacía: los nueve trabajos salían
   * como no planificados y, peor, «Tareas atrasadas» y «Tareas bloqueadas» no
   * aparecían nunca, porque esos recuentos también eran cero. El dominio estaba
   * bien; lo que estaba mal era lo que se le pasaba.
   */
  it('un trabajo CON tareas no se anuncia como sin planificación', () => {
    const p = computeWorkProgress([{ status: 'EN_CURSO', due_date: '2027-01-01' }], null, HOY)
    expect(attentionReasons(p, '2027-06-30', false, HOY)).not.toContain('NO_PLAN')
  })

  it('una tarea bloqueada y una atrasada sí se anuncian', () => {
    const p = computeWorkProgress(
      [
        { status: 'BLOQUEADA', due_date: '2027-01-01' },
        { status: 'PENDIENTE', due_date: '2026-10-01' },
      ],
      null,
      HOY,
    )
    const r = attentionReasons(p, '2027-06-30', false, HOY)
    expect(r).toContain('BLOCKED_TASKS')
    expect(r).toContain('OVERDUE_TASKS')
    expect(r).not.toContain('NO_PLAN')
  })
})

describe('attentionSeverity', () => {
  it('ordena por el motivo más grave de cada trabajo', () => {
    const conFecha = attentionSeverity(['PAST_DEADLINE', 'NO_PLAN'])
    const soloPlan = attentionSeverity(['NO_PLAN'])
    const bloqueada = attentionSeverity(['BLOCKED_TASKS'])
    expect(conFecha).toBeLessThan(bloqueada)
    expect(bloqueada).toBeLessThan(soloPlan)
  })

  it('no depende del orden en que lleguen los motivos', () => {
    expect(attentionSeverity(['NO_PLAN', 'PAST_DEADLINE'])).toBe(
      attentionSeverity(['PAST_DEADLINE', 'NO_PLAN']),
    )
  })

  it('un trabajo sin motivos va al final de cualquier lista', () => {
    expect(attentionSeverity([])).toBeGreaterThan(attentionSeverity(['NO_PLAN']))
  })
})

describe('statusesForWorkType', () => {
  const statuses = [
    { id: 's1', code: 'PROPUESTA', display_order: 1 },
    { id: 's2', code: 'EN_DESARROLLO', display_order: 2 },
    { id: 's3', code: 'PENDIENTE_DEPOSITO', display_order: 3 },
    { id: 's4', code: 'DEFENDIDO', display_order: 4 },
    { id: 's5', code: 'FINALIZADO', display_order: 5 },
  ] as WorkStatusRow[]

  it('sin restricciones, un tipo admite todos los estados', () => {
    expect(statusesForWorkType('tfg', statuses, []).map((s) => s.code)).toEqual(
      statuses.map((s) => s.code),
    )
  })

  it('ACADEMIA no ofrece depósito ni defensa', () => {
    const mappings = [
      { work_type_id: 'academia', status_id: 's1', display_order: 1 },
      { work_type_id: 'academia', status_id: 's2', display_order: 2 },
      { work_type_id: 'academia', status_id: 's5', display_order: 3 },
    ] as WorkTypeStatusRow[]
    const codes = statusesForWorkType('academia', statuses, mappings).map((s) => s.code)
    expect(codes).toEqual(['PROPUESTA', 'EN_DESARROLLO', 'FINALIZADO'])
    expect(codes).not.toContain('PENDIENTE_DEPOSITO')
    expect(codes).not.toContain('DEFENDIDO')
  })
})

describe('computeWorkProgress con subtareas', () => {
  it('no cuenta las subtareas: son puntos de una lista, no tareas del trabajo', () => {
    const conSubtareas = computeWorkProgress(
      [
        { status: 'COMPLETADA', due_date: null, parent_task_id: null },
        { status: 'PENDIENTE', due_date: null, parent_task_id: null },
        // Ocho puntos de la lista de la primera tarea: no deben pesar.
        ...Array.from({ length: 8 }, () => ({
          status: 'COMPLETADA' as const,
          due_date: null,
          parent_task_id: 'padre-1',
        })),
      ],
      null,
    )
    const sinSubtareas = computeWorkProgress(
      [
        { status: 'COMPLETADA', due_date: null, parent_task_id: null },
        { status: 'PENDIENTE', due_date: null, parent_task_id: null },
      ],
      null,
    )
    expect(conSubtareas.totalTasks).toBe(2)
    expect(conSubtareas.taskCompletion).toBe(50)
    expect(conSubtareas.taskCompletion).toBe(sinSubtareas.taskCompletion)
  })

  it('una subtarea vencida no cuenta como tarea atrasada del trabajo', () => {
    const r = computeWorkProgress(
      [
        { status: 'PENDIENTE', due_date: null, parent_task_id: null },
        { status: 'PENDIENTE', due_date: '2020-01-01', parent_task_id: 'padre-1' },
      ],
      null,
      new Date('2026-11-06'),
    )
    expect(r.overdueTasks).toBe(0)
  })

  it('sigue funcionando si no se informa parent_task_id (retrocompatible)', () => {
    const r = computeWorkProgress(
      [{ status: 'COMPLETADA', due_date: null }, { status: 'PENDIENTE', due_date: null }],
      null,
    )
    expect(r.totalTasks).toBe(2)
    expect(r.taskCompletion).toBe(50)
  })
})
