import { describe, expect, it } from 'vitest'
import {
  columnKeyOf, columnasPorDefecto, groupCards, planCardMove, resolveBoard,
  type BoardCard, type BoardColumn,
} from '@/domain/plan/board'

/**
 * El tipo de fila se escribe aquí a mano en lugar de importarse de
 * `@/data/types/database`: estas pruebas no tocan infraestructura y
 * `scripts/check-pure-tests.sh` lo exige. Si la tabla cambiara de forma, el
 * compilador lo diría al llamar a `resolveBoard`, que sí usa el tipo de verdad.
 */
type Estado = 'PENDIENTE' | 'EN_CURSO' | 'BLOQUEADA' | 'EN_REVISION' | 'COMPLETADA'

const col = (
  id: string, name: string, mapsTo: Estado, orden: number, activa = true,
) => ({
  id,
  organization_id: 'org',
  name,
  color: 'slate',
  maps_to: mapsTo,
  display_order: orden,
  is_active: activa,
  created_at: '2026-11-08T00:00:00Z',
})

const card = (
  id: string, orden: number, columna: string | null, estado: BoardCard['status'] = 'PENDIENTE',
): BoardCard => ({ id, order_index: orden, board_column_id: columna, status: estado })

describe('resolveBoard', () => {
  it('sin catálogo configurado, dibuja las cinco de siempre', () => {
    const columnas = resolveBoard([], [])
    expect(columnas.map((c) => c.mapsTo)).toEqual([
      'PENDIENTE', 'EN_CURSO', 'BLOQUEADA', 'EN_REVISION', 'COMPLETADA',
    ])
    // Ninguna tiene fila en la base: no hay nada que apuntar.
    expect(columnas.every((c) => c.id === null)).toBe(true)
  })

  it('con catálogo, respeta el orden configurado', () => {
    const columnas = resolveBoard([
      col('c', 'Hecho', 'COMPLETADA', 2),
      col('a', 'Por hacer', 'PENDIENTE', 0),
      col('b', 'Papers', 'EN_CURSO', 1),
    ], [])
    expect(columnas.map((c) => c.name)).toEqual(['Por hacer', 'Papers', 'Hecho'])
  })

  it('una columna retirada no se dibuja… salvo que todavía tenga tarjetas', () => {
    const catalogo = [col('a', 'Por hacer', 'PENDIENTE', 0), col('z', 'Vieja', 'EN_CURSO', 1, false)]
    expect(resolveBoard(catalogo, []).map((c) => c.name)).toEqual(['Por hacer'])
    // Con una tarjeta dentro, se sigue dibujando: si no, el trabajo seguiría
    // ahí y nadie lo vería.
    expect(resolveBoard(catalogo, [card('t1', 0, 'z')]).map((c) => c.name))
      .toEqual(['Por hacer', 'Vieja'])
  })
})

describe('columnKeyOf', () => {
  const columnas = resolveBoard([
    col('a', 'Por hacer', 'PENDIENTE', 0),
    col('b', 'Papers', 'EN_CURSO', 1),
  ], [])

  it('respeta la columna asignada', () => {
    expect(columnKeyOf(card('t', 0, 'b'), columnas)).toBe('b')
  })

  it('sin columna asignada, cae en la primera que signifique su estado', () => {
    expect(columnKeyOf(card('t', 0, null, 'EN_CURSO'), columnas)).toBe('b')
  })

  it('si la columna asignada ya no se dibuja, vuelve a decidirse por el estado', () => {
    expect(columnKeyOf(card('t', 0, 'borrada', 'EN_CURSO'), columnas)).toBe('b')
  })

  it('si ningún significado encaja, cae en la primera columna y no se pierde', () => {
    expect(columnKeyOf(card('t', 0, null, 'COMPLETADA'), columnas)).toBe('a')
  })
})

describe('groupCards', () => {
  it('reparte y conserva el orden de llegada', () => {
    const columnas = resolveBoard([
      col('a', 'A', 'PENDIENTE', 0), col('b', 'B', 'EN_CURSO', 1),
    ], [])
    const grupos = groupCards(
      [card('t1', 0, 'a'), card('t2', 1, 'b'), card('t3', 2, 'a')],
      columnas,
    )
    expect(grupos.get('a')!.map((t) => t.id)).toEqual(['t1', 't3'])
    expect(grupos.get('b')!.map((t) => t.id)).toEqual(['t2'])
  })
})

describe('planCardMove', () => {
  const columnas: BoardColumn[] = resolveBoard([
    col('a', 'Por hacer', 'PENDIENTE', 0),
    col('b', 'Papers', 'EN_CURSO', 1),
  ], [])
  const tarjetas = [
    card('t1', 0, 'a'), card('t2', 1, 'a'), card('t3', 2, 'a'),
    card('t4', 0, 'b'),
  ]

  it('mueve a otra columna, al final', () => {
    expect(planCardMove({
      tarjetas, columnas, arrastradaId: 't1', destinoKey: 'b', antesDe: null,
    })).toEqual([{ id: 't1', order_index: 1, board_column_id: 'b' }])
  })

  it('mueve a otra columna, delante de una tarjeta concreta', () => {
    expect(planCardMove({
      tarjetas, columnas, arrastradaId: 't1', destinoKey: 'b', antesDe: 't4',
    })).toEqual([
      { id: 't1', order_index: 0, board_column_id: 'b' },
      { id: 't4', order_index: 1 },
    ])
  })

  it('reordena dentro de la misma columna y solo escribe lo que cambia', () => {
    expect(planCardMove({
      tarjetas, columnas, arrastradaId: 't3', destinoKey: 'a', antesDe: 't1',
    })).toEqual([
      { id: 't3', order_index: 0 },
      { id: 't1', order_index: 1 },
      { id: 't2', order_index: 2 },
    ])
  })

  it('soltar una tarjeta donde ya estaba no escribe nada', () => {
    expect(planCardMove({
      tarjetas, columnas, arrastradaId: 't1', destinoKey: 'a', antesDe: 't2',
    })).toEqual([])
    expect(planCardMove({
      tarjetas, columnas, arrastradaId: 't1', destinoKey: 'a', antesDe: 't1',
    })).toEqual([])
  })

  it('sin catálogo, mover de columna cambia el ESTADO (no hay fila que apuntar)', () => {
    const porDefecto = columnasPorDefecto()
    const sueltas = [card('t1', 0, null, 'PENDIENTE'), card('t2', 0, null, 'EN_CURSO')]
    expect(planCardMove({
      tarjetas: sueltas,
      columnas: porDefecto,
      arrastradaId: 't1',
      destinoKey: 'estado:EN_CURSO',
      antesDe: 't2',
    })).toEqual([
      { id: 't1', order_index: 0, board_column_id: null, status: 'EN_CURSO' },
      { id: 't2', order_index: 1 },
    ])
  })

  it('una tarjeta que no existe o un destino que no existe no mueven nada', () => {
    expect(planCardMove({
      tarjetas, columnas, arrastradaId: 'fantasma', destinoKey: 'a', antesDe: null,
    })).toEqual([])
    expect(planCardMove({
      tarjetas, columnas, arrastradaId: 't1', destinoKey: 'fantasma', antesDe: null,
    })).toEqual([])
  })
})
