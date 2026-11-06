import { describe, expect, it } from 'vitest'
import { blockedByDependencies, topologicalOrder, wouldCreateCycle, type Dep } from '../dependencies'

const dep = (a: string, b: string): Dep => ({ task_id: a, depends_on_task_id: b })

describe('wouldCreateCycle', () => {
  it('rechaza que una tarea dependa de sí misma', () => {
    expect(wouldCreateCycle([], 'A', 'A')).toBe(true)
  })

  it('acepta una dependencia nueva que no cierra nada', () => {
    expect(wouldCreateCycle([dep('A', 'B')], 'B', 'C')).toBe(false)
  })

  it('detecta el ciclo directo A->B->A', () => {
    expect(wouldCreateCycle([dep('A', 'B')], 'B', 'A')).toBe(true)
  })

  it('detecta el ciclo largo A->B->C->A', () => {
    expect(wouldCreateCycle([dep('A', 'B'), dep('B', 'C')], 'C', 'A')).toBe(true)
  })

  it('termina aunque el grafo ya tuviera un ciclo', () => {
    // No debería poder ocurrir (lo impide la base de datos), pero si ocurriera,
    // colgar la pestaña del navegador sería la peor forma de enterarse.
    const corrupto = [dep('A', 'B'), dep('B', 'A')]
    expect(wouldCreateCycle(corrupto, 'C', 'A')).toBe(false)
  })

  it('no confunde dos ramas que llegan al mismo sitio con un ciclo', () => {
    // A->C y B->C: añadir A->B es legítimo aunque ambas acaben en C.
    expect(wouldCreateCycle([dep('A', 'C'), dep('B', 'C')], 'A', 'B')).toBe(false)
  })
})

describe('blockedByDependencies', () => {
  const tareas = [
    { id: 'A', status: 'PENDIENTE' },
    { id: 'B', status: 'PENDIENTE' },
    { id: 'C', status: 'COMPLETADA' },
  ]

  it('marca la tarea cuya dependencia no está terminada', () => {
    expect(blockedByDependencies(tareas, [dep('A', 'B')]).has('A')).toBe(true)
  })

  it('no marca la tarea cuya dependencia ya está completada', () => {
    expect(blockedByDependencies(tareas, [dep('A', 'C')]).has('A')).toBe(false)
  })

  it('ignora dependencias hacia tareas que no se ven', () => {
    // En un grafo filtrado por RLS puede faltar el otro extremo; tratarlo como
    // pendiente pintaría de rojo media pantalla sin explicación.
    expect(blockedByDependencies(tareas, [dep('A', 'DESCONOCIDA')]).size).toBe(0)
  })
})

describe('topologicalOrder', () => {
  it('pone primero aquello de lo que se depende', () => {
    const orden = topologicalOrder(['A', 'B'], [dep('A', 'B')])
    expect(orden.indexOf('B')).toBeLessThan(orden.indexOf('A'))
  })

  it('conserva el orden de entrada cuando no hay dependencias', () => {
    expect(topologicalOrder(['A', 'B', 'C'], [])).toEqual(['A', 'B', 'C'])
  })

  it('no pierde ninguna tarea si hubiera un ciclo', () => {
    const orden = topologicalOrder(['A', 'B'], [dep('A', 'B'), dep('B', 'A')])
    expect(orden).toHaveLength(2)
    expect(new Set(orden)).toEqual(new Set(['A', 'B']))
  })

  it('ignora dependencias hacia tareas fuera del conjunto', () => {
    expect(topologicalOrder(['A'], [dep('A', 'FUERA')])).toEqual(['A'])
  })
})
