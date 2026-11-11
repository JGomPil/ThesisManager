import { describe, expect, it } from 'vitest'
import { agruparEnHilos, raizDeLaRespuesta } from '@/domain/comments/hilos'

const c = (id: string, created_at: string, parent_comment_id: string | null = null) =>
  ({ id, created_at, parent_comment_id })

describe('agruparEnHilos', () => {
  it('cuelga cada respuesta de su comentario', () => {
    const hilos = agruparEnHilos([
      c('a', '2026-01-01T10:00:00Z'),
      c('b', '2026-01-01T11:00:00Z'),
      c('a1', '2026-01-01T12:00:00Z', 'a'),
    ])
    expect(hilos.map((h) => h.comentario.id)).toEqual(['a', 'b'])
    expect(hilos[0]!.respuestas.map((r) => r.id)).toEqual(['a1'])
    expect(hilos[1]!.respuestas).toEqual([])
  })

  it('ordena por fecha, los hilos y las respuestas', () => {
    const hilos = agruparEnHilos([
      c('b', '2026-02-01T10:00:00Z'),
      c('b2', '2026-02-03T10:00:00Z', 'b'),
      c('a', '2026-01-01T10:00:00Z'),
      c('b1', '2026-02-02T10:00:00Z', 'b'),
    ])
    expect(hilos.map((h) => h.comentario.id)).toEqual(['a', 'b'])
    expect(hilos[1]!.respuestas.map((r) => r.id)).toEqual(['b1', 'b2'])
  })

  /**
   * El caso que decide el diseño: el padre se borró (borrado lógico, así que
   * `byEntity` no lo devuelve). La respuesta NO puede desaparecer de la
   * pantalla sin que nada lo diga.
   */
  it('una respuesta huérfana se enseña como comentario, no se pierde', () => {
    const hilos = agruparEnHilos([
      c('a', '2026-01-01T10:00:00Z'),
      c('x1', '2026-01-02T10:00:00Z', 'borrado'),
    ])
    expect(hilos.map((h) => h.comentario.id)).toEqual(['a', 'x1'])
  })

  it('sin comentarios, sin hilos', () => {
    expect(agruparEnHilos([])).toEqual([])
  })
})

describe('raizDeLaRespuesta', () => {
  it('responder a un comentario cuelga de él', () => {
    expect(raizDeLaRespuesta(c('a', '2026-01-01T10:00:00Z'))).toBe('a')
  })

  it('responder a una respuesta sigue el mismo hilo, no abre un tercer nivel', () => {
    expect(raizDeLaRespuesta(c('a1', '2026-01-01T10:00:00Z', 'a'))).toBe('a')
  })
})
