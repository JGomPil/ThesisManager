import { describe, expect, it } from 'vitest'
import {
  columnKeyOf, columnasIniciales, columnasPorEstado, groupCards, planCardMove, resolveBoard,
  siguienteOrden, type BoardCard, type BoardColumn,
} from '@/domain/plan/board'

/**
 * El tipo de fila se escribe aquí a mano en lugar de importarse de
 * `@/data/types/database`: estas pruebas no tocan infraestructura y
 * `scripts/check-pure-tests.sh` lo exige. Si la tabla cambiara de forma, el
 * compilador lo diría al llamar a `resolveBoard`, que sí usa el tipo de verdad.
 */
type Estado = 'PENDIENTE' | 'EN_CURSO' | 'BLOQUEADA' | 'EN_REVISION' | 'COMPLETADA'

const col = (id: string, name: string, orden: number) => ({
  id,
  work_id: 'trabajo',
  name,
  color: 'slate',
  display_order: orden,
  created_at: '2026-11-08T00:00:00Z',
})

const card = (
  id: string, orden: number, columna: string | null, estado: Estado = 'PENDIENTE',
): BoardCard => ({ id, order_index: orden, board_column_id: columna, status: estado })

const keys = (columnas: BoardColumn[]) => columnas.map((c) => c.name)

describe('resolveBoard', () => {
  it('sin columnas, el tablero de siempre: una por estado', () => {
    const tablero = resolveBoard([])
    expect(keys(tablero)).toEqual(['Pendiente', 'En curso', 'Bloqueada', 'En revisión', 'Completada'])
    // Son columnas sin fila detrás, y cada una agrupa un estado.
    expect(tablero.every((c) => c.id === null && c.estado !== null)).toBe(true)
  })

  it('con columnas del trabajo, esas y en su orden', () => {
    const tablero = resolveBoard([col('b', 'Estudios', 1), col('a', 'Papers', 0)])
    expect(keys(tablero)).toEqual(['Papers', 'Estudios'])
    // Y ninguna significa nada: el estado de la tarea es otro dato.
    expect(tablero.every((c) => c.estado === null)).toBe(true)
  })

  it('a igual orden, por nombre: el tablero no baila entre dos cargas', () => {
    expect(keys(resolveBoard([col('b', 'Zeta', 0), col('a', 'Alfa', 0)]))).toEqual(['Alfa', 'Zeta'])
  })
})

describe('columnKeyOf', () => {
  it('en el tablero por estado, la columna de su estado', () => {
    const tablero = resolveBoard([])
    expect(columnKeyOf(card('t1', 0, null, 'EN_CURSO'), tablero)).toBe('estado:EN_CURSO')
  })

  it('con columnas, la suya', () => {
    const tablero = resolveBoard([col('a', 'Papers', 0), col('b', 'Estudios', 1)])
    expect(columnKeyOf(card('t1', 0, 'b'), tablero)).toBe('b')
  })

  it('una tarjeta sin columna cae en la PRIMERA, no desaparece', () => {
    const tablero = resolveBoard([col('a', 'Papers', 0), col('b', 'Estudios', 1)])
    expect(columnKeyOf(card('t1', 0, null, 'COMPLETADA'), tablero)).toBe('a')
  })

  it('y si su columna ya no existe, también: trabajo invisible, nunca', () => {
    const tablero = resolveBoard([col('a', 'Papers', 0)])
    expect(columnKeyOf(card('t1', 0, 'borrada'), tablero)).toBe('a')
  })
})

describe('groupCards', () => {
  it('conserva el orden de llegada y deja vacías las columnas sin tarjetas', () => {
    const tablero = resolveBoard([col('a', 'Papers', 0), col('b', 'Estudios', 1)])
    const grupos = groupCards([card('t1', 0, 'a'), card('t2', 1, 'a')], tablero)
    expect(grupos.get('a')!.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(grupos.get('b')).toEqual([])
  })

  it('no agrupa por estado cuando hay columnas: el orden lo decide quien planifica', () => {
    const tablero = resolveBoard([col('a', 'Papers', 0)])
    const grupos = groupCards(
      [card('t1', 0, 'a', 'EN_CURSO'), card('t2', 1, 'a', 'PENDIENTE')], tablero,
    )
    expect(grupos.get('a')!.map((t) => t.id)).toEqual(['t1', 't2'])
  })
})

describe('planCardMove', () => {
  const tablero = resolveBoard([col('a', 'Papers', 0), col('b', 'Estudios', 1)])
  const tarjetas = [card('t1', 0, 'a'), card('t2', 1, 'a'), card('t3', 0, 'b')]

  it('cambiar de columna NO toca el estado', () => {
    const movs = planCardMove({
      tarjetas, columnas: tablero, arrastradaId: 't1', destinoKey: 'b', antesDe: null,
    })
    expect(movs).toContainEqual({ id: 't1', order_index: 1, board_column_id: 'b' })
    expect(movs.every((m) => m.status === undefined)).toBe(true)
  })

  it('en el tablero POR ESTADO sí, porque allí la columna es el estado', () => {
    const porEstado = columnasPorEstado()
    const movs = planCardMove({
      tarjetas: [card('t1', 0, null, 'PENDIENTE')],
      columnas: porEstado, arrastradaId: 't1', destinoKey: 'estado:COMPLETADA', antesDe: null,
    })
    expect(movs).toEqual([{ id: 't1', order_index: 0, status: 'COMPLETADA' }])
  })

  it('soltar donde ya estaba no escribe nada', () => {
    expect(planCardMove({
      tarjetas, columnas: tablero, arrastradaId: 't1', destinoKey: 'a', antesDe: 't2',
    })).toEqual([])
  })

  it('reordenar dentro de una columna escribe solo las filas que se mueven', () => {
    const movs = planCardMove({
      tarjetas, columnas: tablero, arrastradaId: 't2', destinoKey: 'a', antesDe: 't1',
    })
    expect(movs).toEqual([{ id: 't2', order_index: 0 }, { id: 't1', order_index: 1 }])
  })

  it('la columna de origen no se renumera: un hueco no cambia el orden', () => {
    const movs = planCardMove({
      tarjetas, columnas: tablero, arrastradaId: 't1', destinoKey: 'b', antesDe: 't3',
    })
    // t2 se queda con su order_index 1 y un hueco delante.
    expect(movs.map((m) => m.id)).toEqual(['t1', 't3'])
  })

  it('sin permiso para ordenar, una sola escritura y al final de la columna', () => {
    const movs = planCardMove({
      tarjetas, columnas: tablero, arrastradaId: 't1', destinoKey: 'b', antesDe: 't3',
      puedeOrdenar: false,
    })
    // Renumerar las vecinas sería escribir filas que RLS le descarta en
    // silencio: el tablero quedaría a medio ordenar y sin ningún error.
    expect(movs).toEqual([{ id: 't1', order_index: 1, board_column_id: 'b' }])
  })

  it('y en su propia columna, sin permiso, no se escribe nada', () => {
    expect(planCardMove({
      tarjetas, columnas: tablero, arrastradaId: 't1', destinoKey: 'a', antesDe: 't2',
      puedeOrdenar: false,
    })).toEqual([])
  })

  it('una tarjeta o una columna que no existen no escriben nada', () => {
    expect(planCardMove({
      tarjetas, columnas: tablero, arrastradaId: 'fantasma', destinoKey: 'a', antesDe: null,
    })).toEqual([])
    expect(planCardMove({
      tarjetas, columnas: tablero, arrastradaId: 't1', destinoKey: 'fantasma', antesDe: null,
    })).toEqual([])
  })
})

describe('columnasIniciales', () => {
  it('reparte los cinco estados, sin dejarse ninguno ni repetir', () => {
    const estados = columnasIniciales().flatMap((c) => c.estados)
    expect(estados.slice().sort()).toEqual(
      ['BLOQUEADA', 'COMPLETADA', 'EN_CURSO', 'EN_REVISION', 'PENDIENTE'],
    )
  })
})

describe('siguienteOrden', () => {
  it('la primera columna es la 0 y las demás van al final', () => {
    expect(siguienteOrden([])).toBe(0)
    expect(siguienteOrden([col('a', 'Papers', 0), col('b', 'Estudios', 4)])).toBe(5)
  })
})
