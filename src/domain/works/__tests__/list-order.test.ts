import { describe, expect, it } from 'vitest'
import { alPulsar, leeOrden, ordena } from '@/domain/works/list-order'
import type { ClaveDeOrden, Orden } from '@/domain/works/list-order'

/** Una fila mínima: solo lo que mira el orden. */
const fila = (p: Partial<ClaveDeOrden> & { titulo: string }): ClaveDeOrden => ({
  tipo: 'TFG',
  estado: 'En curso',
  estadoOrden: 1,
  estudiante: 'Ana',
  direccion: 'Pérez',
  fin: null,
  ...p,
})

const titulos = (filas: ClaveDeOrden[], orden: Orden) =>
  ordena(filas, (f) => f, orden).map((f) => f.titulo)

describe('leeOrden: lo que viene de la URL es de quien la escriba', () => {
  it('acepta las seis columnas y los dos sentidos', () => {
    expect(leeOrden('titulo', 'asc')).toEqual({ columna: 'titulo', sentido: 'asc' })
    expect(leeOrden('fin', 'desc')).toEqual({ columna: 'fin', sentido: 'desc' })
  })

  it('una columna inventada deja la pantalla en su orden de siempre', () => {
    expect(leeOrden('nombre_del_perro', 'asc')).toBeNull()
    expect(leeOrden(null, 'desc')).toBeNull()
    expect(leeOrden('', '')).toBeNull()
  })

  it('un sentido raro es ascendente, no un fallo', () => {
    expect(leeOrden('tipo', 'hacia arriba')).toEqual({ columna: 'tipo', sentido: 'asc' })
    expect(leeOrden('tipo', null)).toEqual({ columna: 'tipo', sentido: 'asc' })
  })
})

describe('alPulsar: qué hace una cabecera', () => {
  it('la primera vez, ascendente', () => {
    expect(alPulsar(null, 'fin')).toEqual({ columna: 'fin', sentido: 'asc' })
  })

  it('en la misma columna, alterna', () => {
    expect(alPulsar({ columna: 'fin', sentido: 'asc' }, 'fin')).toEqual({ columna: 'fin', sentido: 'desc' })
    expect(alPulsar({ columna: 'fin', sentido: 'desc' }, 'fin')).toEqual({ columna: 'fin', sentido: 'asc' })
  })

  it('al cambiar de columna vuelve a ascendente: no se hereda el sentido', () => {
    expect(alPulsar({ columna: 'fin', sentido: 'desc' }, 'titulo')).toEqual({
      columna: 'titulo', sentido: 'asc',
    })
  })
})

describe('ordena', () => {
  it('no toca el array que recibe', () => {
    const filas = [fila({ titulo: 'B' }), fila({ titulo: 'A' })]
    const copia = [...filas]
    ordena(filas, (f) => f, { columna: 'titulo', sentido: 'asc' })
    expect(filas).toEqual(copia)
  })

  it('por título, en los dos sentidos', () => {
    const filas = [fila({ titulo: 'Casa' }), fila({ titulo: 'Árbol' }), fila({ titulo: 'Barco' })]
    expect(titulos(filas, { columna: 'titulo', sentido: 'asc' })).toEqual(['Árbol', 'Barco', 'Casa'])
    expect(titulos(filas, { columna: 'titulo', sentido: 'desc' })).toEqual(['Casa', 'Barco', 'Árbol'])
  })

  /** Con `sensitivity: 'base'`, «Álvarez» va con las A y no detrás de la Z. */
  it('compara en español: las tildes no mandan al final', () => {
    const filas = [fila({ titulo: 'Zubiri' }), fila({ titulo: 'Álvarez' }), fila({ titulo: 'Alvar' })]
    expect(titulos(filas, { columna: 'titulo', sentido: 'asc' })).toEqual(['Alvar', 'Álvarez', 'Zubiri'])
  })

  it('…y cuenta los números como números', () => {
    const filas = [fila({ titulo: 'Estudio 10' }), fila({ titulo: 'Estudio 9' })]
    expect(titulos(filas, { columna: 'titulo', sentido: 'asc' })).toEqual(['Estudio 9', 'Estudio 10'])
  })

  it('por fecha de fin, que es texto ISO y se ordena como fecha', () => {
    const filas = [
      fila({ titulo: 'B', fin: '2027-01-15' }),
      fila({ titulo: 'A', fin: '2026-09-30' }),
      fila({ titulo: 'C', fin: '2026-12-01' }),
    ]
    expect(titulos(filas, { columna: 'fin', sentido: 'asc' })).toEqual(['A', 'C', 'B'])
    expect(titulos(filas, { columna: 'fin', sentido: 'desc' })).toEqual(['B', 'C', 'A'])
  })

  /**
   * REGLA 1. Un trabajo sin fecha no es el más antiguo ni el más reciente: es
   * uno del que no se sabe. Si siguiera al sentido, al invertir el orden la
   * mitad de la pantalla serían guiones.
   */
  it('lo vacío queda al final en los DOS sentidos', () => {
    const filas = [
      fila({ titulo: 'Sin fecha', fin: null }),
      fila({ titulo: 'Con fecha', fin: '2026-12-01' }),
      fila({ titulo: 'Otra', fin: '2027-01-01' }),
    ]
    expect(titulos(filas, { columna: 'fin', sentido: 'asc' })).toEqual(['Con fecha', 'Otra', 'Sin fecha'])
    expect(titulos(filas, { columna: 'fin', sentido: 'desc' })).toEqual(['Otra', 'Con fecha', 'Sin fecha'])
  })

  it('el guion de «no hay» cuenta como vacío, no como un nombre', () => {
    const filas = [
      fila({ titulo: 'B', estudiante: '—' }),
      fila({ titulo: 'A', estudiante: 'Zoe' }),
    ]
    expect(titulos(filas, { columna: 'estudiante', sentido: 'asc' })).toEqual(['A', 'B'])
    expect(titulos(filas, { columna: 'estudiante', sentido: 'desc' })).toEqual(['A', 'B'])
  })

  /**
   * REGLA 2. Sin desempate, veinte TFG seguidos quedan en el orden en que
   * vinieran, y la misma pantalla cargada dos veces sale distinta.
   */
  it('a igualdad de columna, desempata por título SIEMPRE A→Z', () => {
    const filas = [
      fila({ titulo: 'Carlos', tipo: 'TFG' }),
      fila({ titulo: 'Ana', tipo: 'TFG' }),
      fila({ titulo: 'Berta', tipo: 'TFG' }),
    ]
    expect(titulos(filas, { columna: 'tipo', sentido: 'asc' })).toEqual(['Ana', 'Berta', 'Carlos'])
    // El desempate NO se invierte: el bloque sigue leyéndose A→Z.
    expect(titulos(filas, { columna: 'tipo', sentido: 'desc' })).toEqual(['Ana', 'Berta', 'Carlos'])
  })

  /** El estado es un recorrido, y alfabéticamente saldría al revés. */
  it('el estado se ordena por el catálogo, no por su nombre', () => {
    const filas = [
      fila({ titulo: 'C', estado: 'Defendido', estadoOrden: 3 }),
      fila({ titulo: 'A', estado: 'En curso', estadoOrden: 1 }),
      fila({ titulo: 'B', estado: 'Depositado', estadoOrden: 2 }),
    ]
    expect(titulos(filas, { columna: 'estado', sentido: 'asc' })).toEqual(['A', 'B', 'C'])
    expect(titulos(filas, { columna: 'estado', sentido: 'desc' })).toEqual(['C', 'B', 'A'])
  })

  it('por dirección, con los nombres compuestos que hay de verdad', () => {
    const filas = [
      fila({ titulo: 'B', direccion: 'Gómez Pilar, Carrascal Hinojal' }),
      fila({ titulo: 'A', direccion: 'Carrascal Hinojal' }),
    ]
    expect(titulos(filas, { columna: 'direccion', sentido: 'asc' })).toEqual(['A', 'B'])
  })

  it('una lista vacía o de uno no se rompe', () => {
    expect(ordena([], (f: ClaveDeOrden) => f, { columna: 'titulo', sentido: 'asc' })).toEqual([])
    expect(titulos([fila({ titulo: 'Solo' })], { columna: 'fin', sentido: 'desc' })).toEqual(['Solo'])
  })
})
