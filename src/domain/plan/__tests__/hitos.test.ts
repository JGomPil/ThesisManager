import { describe, expect, it } from 'vitest'
import { fraseDeHito, resumenDeHito, type TareaDeHito } from '@/domain/plan/hitos'

const t = (
  milestone_id: string | null,
  status: TareaDeHito['status'] = 'PENDIENTE',
  parent_task_id: string | null = null,
): TareaDeHito => ({ milestone_id, parent_task_id, status })

describe('resumenDeHito', () => {
  it('cuenta solo las tareas de ese hito', () => {
    const r = resumenDeHito([t('h1'), t('h1', 'COMPLETADA'), t('h2'), t(null)], 'h1')
    expect(r).toEqual({ total: 2, pendientes: 1 })
  })

  it('NO cuenta los puntos de una lista de comprobación', () => {
    // Si contaran, una tarea con diez puntos diría «11 tareas» en su hito.
    const r = resumenDeHito([t('h1'), t('h1', 'PENDIENTE', 'tarea-madre')], 'h1')
    expect(r).toEqual({ total: 1, pendientes: 1 })
  })

  it('sin tareas, cero', () => {
    expect(resumenDeHito([], 'h1')).toEqual({ total: 0, pendientes: 0 })
  })
})

describe('fraseDeHito', () => {
  it('no dice nada cuando no hay nada colgado', () => {
    expect(fraseDeHito({ total: 0, pendientes: 0 })).toBeNull()
  })

  it('singular de verdad', () => {
    expect(fraseDeHito({ total: 1, pendientes: 1 })).toBe('1 tarea pendiente')
    expect(fraseDeHito({ total: 1, pendientes: 0 })).toBe('1 tarea, hecha')
  })

  it('distingue todo hecho, nada hecho y a medias', () => {
    expect(fraseDeHito({ total: 5, pendientes: 0 })).toBe('5 tareas, todas hechas')
    expect(fraseDeHito({ total: 5, pendientes: 5 })).toBe('5 tareas, ninguna hecha')
    expect(fraseDeHito({ total: 5, pendientes: 3 })).toBe('5 tareas, 3 sin terminar')
  })
})
