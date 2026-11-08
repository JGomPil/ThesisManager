import { describe, expect, it } from 'vitest'
import { aplicaFormato } from '@/domain/comments/markup-edit'
import type { Formato, Seleccion } from '@/domain/comments/markup-edit'

/**
 * Las pruebas se escriben con «|» marcando el cursor y «[]» la selección, que
 * es como se mira esto de verdad: comparar dos cadenas y dos números sueltos
 * no dice si el cursor acabó donde tenía que acabar.
 */
function sel(marcado: string): Seleccion {
  if (marcado.includes('[')) {
    const inicio = marcado.indexOf('[')
    const fin = marcado.indexOf(']') - 1
    return { texto: marcado.replace('[', '').replace(']', ''), inicio, fin }
  }
  const inicio = marcado.indexOf('|')
  return { texto: marcado.replace('|', ''), inicio, fin: inicio }
}

function marca(s: Seleccion): string {
  if (s.inicio === s.fin) return `${s.texto.slice(0, s.inicio)}|${s.texto.slice(s.inicio)}`
  return `${s.texto.slice(0, s.inicio)}[${s.texto.slice(s.inicio, s.fin)}]${s.texto.slice(s.fin)}`
}

const aplica = (marcado: string, formato: Formato) => marca(aplicaFormato(sel(marcado), formato))

describe('negrita, cursiva y subrayado', () => {
  it('envuelve lo seleccionado y lo deja seleccionado', () => {
    expect(aplica('hay que [revisar] esto', 'negrita')).toBe('hay que **[revisar]** esto')
    expect(aplica('hay que [revisar] esto', 'cursiva')).toBe('hay que *[revisar]* esto')
    expect(aplica('hay que [revisar] esto', 'subrayado')).toBe('hay que __[revisar]__ esto')
  })

  it('sin selección escribe las dos marcas y deja el cursor EN MEDIO', () => {
    expect(aplica('escribo |', 'negrita')).toBe('escribo **|**')
  })

  it('se puede encadenar: negrita y luego cursiva sobre lo mismo', () => {
    expect(aplica('hay que **[revisar]** esto', 'cursiva')).toBe('hay que ***[revisar]*** esto')
  })

  it('vuelve a pulsarse y lo quita, con las marcas dentro de la selección', () => {
    expect(aplica('hay que [**revisar**] esto', 'negrita')).toBe('hay que [revisar] esto')
  })

  it('…y también con las marcas justo fuera, que es lo que queda tras aplicarlo', () => {
    expect(aplica('hay que **[revisar]** esto', 'negrita')).toBe('hay que [revisar] esto')
  })

  /**
   * El caso que obliga a mirar dos veces: `**x**` empieza y acaba por `*`, así
   * que la comprobación ingenua lo tomaría por cursiva y le quitaría un
   * asterisco de cada lado, convirtiendo la negrita en cursiva sin que nadie
   * lo pida.
   */
  it('el botón de cursiva no desarma una negrita', () => {
    expect(aplica('hay que [**revisar**] esto', 'cursiva')).toBe('hay que *[**revisar**]* esto')
  })

  it('no toca lo que hay fuera de la selección', () => {
    const r = aplicaFormato(sel('uno [dos] tres'), 'negrita')
    expect(r.texto.startsWith('uno ')).toBe(true)
    expect(r.texto.endsWith(' tres')).toBe(true)
  })
})

describe('listas', () => {
  it('convierte en puntos las líneas seleccionadas', () => {
    expect(aplica('[uno\ndos]', 'lista')).toBe('[- uno\n- dos]')
  })

  it('numera desde 1, seguido', () => {
    expect(aplica('[uno\ndos\ntres]', 'numerada')).toBe('[1. uno\n2. dos\n3. tres]')
  })

  it('basta con tener el cursor en la línea: no hay que seleccionarla', () => {
    expect(aplica('una li|nea', 'lista')).toBe('[- una linea]')
  })

  it('vuelve a pulsarse y quita la lista', () => {
    expect(aplica('[- uno\n- dos]', 'lista')).toBe('[uno\ndos]')
  })

  it('de puntos a numerada CAMBIA la lista, no añade un número al guion', () => {
    expect(aplica('[- uno\n- dos]', 'numerada')).toBe('[1. uno\n2. dos]')
  })

  it('las líneas en blanco de en medio se quedan en blanco, sin numerar', () => {
    expect(aplica('[uno\n\ndos]', 'numerada')).toBe('[1. uno\n\n2. dos]')
  })

  it('no toca las líneas de fuera de la selección', () => {
    expect(aplica('antes\n[uno]\ndespués', 'lista')).toBe('antes\n[- uno]\ndespués')
  })

  it('si ya hay puntos a medias, los completa en vez de quitarlos', () => {
    expect(aplica('[- uno\ndos]', 'lista')).toBe('[- uno\n- dos]')
  })
})
