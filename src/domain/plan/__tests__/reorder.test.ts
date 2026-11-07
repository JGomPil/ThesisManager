import { describe, expect, it } from 'vitest'
import { moveItem, reorderWrites } from '@/domain/plan/reorder'

describe('moveItem', () => {
  it('mueve un elemento hacia abajo', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('mueve un elemento hacia arriba', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('no toca la lista si el origen y el destino son el mismo', () => {
    const lista = ['a', 'b']
    expect(moveItem(lista, 1, 1)).toBe(lista)
  })

  it('no toca la lista si los índices están fuera de rango', () => {
    const lista = ['a', 'b']
    expect(moveItem(lista, -1, 0)).toBe(lista)
    expect(moveItem(lista, 0, 5)).toBe(lista)
    expect(moveItem(lista, 2, 0)).toBe(lista)
  })

  it('no muta la lista original', () => {
    const lista = ['a', 'b', 'c']
    moveItem(lista, 0, 2)
    expect(lista).toEqual(['a', 'b', 'c'])
  })
})

describe('reorderWrites', () => {
  it('no escribe nada si el orden guardado ya es el deseado', () => {
    expect(reorderWrites([
      { id: 'a', order_index: 0 },
      { id: 'b', order_index: 1 },
    ])).toEqual([])
  })

  it('al intercambiar dos vecinos solo escribe esos dos', () => {
    // Orden deseado: b, a, c. c ya está en su sitio (posición 2).
    expect(reorderWrites([
      { id: 'b', order_index: 1 },
      { id: 'a', order_index: 0 },
      { id: 'c', order_index: 2 },
    ])).toEqual([
      { id: 'b', order_index: 0 },
      { id: 'a', order_index: 1 },
    ])
  })

  it('numera desde cero una lista que nunca se había ordenado', () => {
    // El caso real: los puntos creados a mano nacían todos con order_index 0.
    expect(reorderWrites([
      { id: 'a', order_index: 0 },
      { id: 'b', order_index: 0 },
      { id: 'c', order_index: 0 },
    ])).toEqual([
      { id: 'b', order_index: 1 },
      { id: 'c', order_index: 2 },
    ])
  })

  it('la lista vacía no necesita ninguna escritura', () => {
    expect(reorderWrites([])).toEqual([])
  })
})
