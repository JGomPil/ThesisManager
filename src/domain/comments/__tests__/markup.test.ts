import { describe, expect, it } from 'vitest'
import { analiza, analizaLinea, enTextoPlano } from '@/domain/comments/markup'
import type { Bloque, Inline } from '@/domain/comments/markup'

/** El texto de un trozo con formato, para no escribir el árbol entero. */
const plano = (ns: Inline[]): string =>
  ns.map((n) => (n.tipo === 'texto' ? n.texto : plano(n.hijos))).join('')

/**
 * Afirman el tipo del bloque Y lo estrechan de paso. Con
 * `noUncheckedIndexedAccess`, `r[0].puntos` no compila: el índice puede dar
 * `undefined` y el bloque puede ser un párrafo. Esto falla con un mensaje que
 * se entiende en vez de con un `Cannot read properties of undefined`.
 */
function laLista(b: Bloque | undefined) {
  if (b?.tipo !== 'lista') throw new Error(`se esperaba una lista, y es ${b?.tipo ?? 'nada'}`)
  return b
}
function elParrafo(b: Bloque | undefined) {
  if (b?.tipo !== 'parrafo') throw new Error(`se esperaba un párrafo, y es ${b?.tipo ?? 'nada'}`)
  return b
}

describe('analizaLinea: las marcas de dentro de una línea', () => {
  it('negrita, cursiva y subrayado', () => {
    expect(analizaLinea('**fuerte**')).toEqual([
      { tipo: 'negrita', hijos: [{ tipo: 'texto', texto: 'fuerte' }] },
    ])
    expect(analizaLinea('*suave*')).toEqual([
      { tipo: 'cursiva', hijos: [{ tipo: 'texto', texto: 'suave' }] },
    ])
    expect(analizaLinea('__debajo__')).toEqual([
      { tipo: 'subrayado', hijos: [{ tipo: 'texto', texto: 'debajo' }] },
    ])
  })

  it('el texto de alrededor se conserva entero', () => {
    const r = analizaLinea('hay que **revisar** la tabla 3')
    expect(plano(r)).toBe('hay que revisar la tabla 3')
    expect(r).toHaveLength(3)
    expect(r[1]?.tipo).toBe('negrita')
  })

  it('anida: cursiva dentro de negrita', () => {
    expect(analizaLinea('**muy *muy* importante**')).toEqual([
      {
        tipo: 'negrita',
        hijos: [
          { tipo: 'texto', texto: 'muy ' },
          { tipo: 'cursiva', hijos: [{ tipo: 'texto', texto: 'muy' }] },
          { tipo: 'texto', texto: ' importante' },
        ],
      },
    ])
  })

  it('*** es negrita Y cursiva, que es lo que sale al pulsar los dos botones', () => {
    expect(analizaLinea('***las dos***')).toEqual([
      {
        tipo: 'negrita',
        hijos: [{ tipo: 'cursiva', hijos: [{ tipo: 'texto', texto: 'las dos' }] }],
      },
    ])
  })

  /**
   * LA REGLA DE LOS ESPACIOS. Sin ella, una multiplicación escrita a mano se
   * pinta en cursiva y quien escribió el comentario no entiende por qué.
   */
  it('una marca separada del texto por un espacio NO es formato', () => {
    expect(analizaLinea('2 * 3 * 4')).toEqual([{ tipo: 'texto', texto: '2 * 3 * 4' }])
    expect(analizaLinea('* suelto *')).toEqual([{ tipo: 'texto', texto: '* suelto *' }])
  })

  it('una marca sin cerrar se queda escrita, no se traga el resto', () => {
    expect(analizaLinea('se abre **y no se cierra')).toEqual([
      { tipo: 'texto', texto: 'se abre **y no se cierra' },
    ])
    expect(plano(analizaLinea('**a** y luego **b'))).toBe('a y luego **b')
  })

  it('las marcas vacías no desaparecen ni crean nodos', () => {
    expect(analizaLinea('****')).toEqual([{ tipo: 'texto', texto: '****' }])
    expect(analizaLinea('**')).toEqual([{ tipo: 'texto', texto: '**' }])
  })

  it('el texto sin marcas sale tal cual, incluido lo que parece HTML', () => {
    expect(analizaLinea('<script>alert(1)</script>')).toEqual([
      { tipo: 'texto', texto: '<script>alert(1)</script>' },
    ])
  })
})

describe('analiza: los bloques', () => {
  it('una línea en blanco separa párrafos; un salto suelto, no', () => {
    const r = analiza('primero\nsegunda línea\n\notro párrafo')
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ tipo: 'parrafo' })
    expect(elParrafo(r[0]).lineas).toHaveLength(2)
    expect(elParrafo(r[1]).lineas).toHaveLength(1)
  })

  it('agrupa los puntos seguidos en UNA lista', () => {
    const r = analiza('- uno\n- dos\n- tres')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ tipo: 'lista', ordenada: false })
    expect(laLista(r[0]).puntos.map(plano)).toEqual(['uno', 'dos', 'tres'])
  })

  it('reconoce la numeración con punto y con paréntesis', () => {
    expect(analiza('1. uno\n2) dos')[0]).toMatchObject({ tipo: 'lista', ordenada: true })
  })

  it('cambiar de tipo de lista empieza otra lista', () => {
    const r = analiza('- uno\n1. dos')
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ ordenada: false })
    expect(r[1]).toMatchObject({ ordenada: true })
  })

  it('la lista corta el párrafo de encima y el de debajo', () => {
    const r = analiza('mirar esto:\n- uno\ny ya')
    expect(r.map((b) => b.tipo)).toEqual(['parrafo', 'lista', 'parrafo'])
  })

  it('los puntos llevan formato dentro', () => {
    const r = analiza('- con **negrita**')
    expect(laLista(r[0]).puntos[0]).toEqual([
      { tipo: 'texto', texto: 'con ' },
      { tipo: 'negrita', hijos: [{ tipo: 'texto', texto: 'negrita' }] },
    ])
  })

  it('*cursiva* al principio de línea no es un punto de lista', () => {
    expect(elParrafo(analiza('*ojo* con esto')[0]).tipo).toBe('parrafo')
  })

  it('los saltos de Windows no parten las líneas en dos', () => {
    expect(analiza('uno\r\ndos').length).toBe(1)
    expect(analiza('uno\r\n\r\ndos').length).toBe(2)
  })

  it('un comentario de los de antes, sin ninguna marca, es un párrafo', () => {
    expect(analiza('Revisado, me parece bien.')).toEqual([
      { tipo: 'parrafo', lineas: [[{ tipo: 'texto', texto: 'Revisado, me parece bien.' }]] },
    ])
  })

  it('el texto vacío no da bloques', () => {
    expect(analiza('')).toEqual([])
    expect(analiza('\n\n')).toEqual([])
  })
})

describe('enTextoPlano: para donde no se puede pintar formato', () => {
  it('quita las marcas y deja las listas legibles', () => {
    expect(enTextoPlano('**hola** *qué* tal')).toBe('hola qué tal')
    expect(enTextoPlano('- uno\n- dos')).toBe('· uno\n· dos')
    expect(enTextoPlano('3. tres\n7. siete')).toBe('1. tres\n2. siete')
  })

  it('separa los párrafos con una línea en blanco', () => {
    expect(enTextoPlano('uno\n\ndos')).toBe('uno\n\ndos')
  })
})

/**
 * EL CASO QUE LO DESTAPÓ, con el texto real que se escribió: una lista de
 * rótulos en negrita en la que unas veces el espacio quedaba fuera de la
 * marca y otras dentro. Con la regla estricta de Markdown, las de la segunda
 * forma enseñaban los asteriscos.
 */
describe('el espacio antes de cerrar la marca', () => {
  it('`**rótulo: **valor` es negrita, con el espacio fuera', () => {
    expect(analizaLinea('**3. Alumno: **Alejandra')).toEqual([
      { tipo: 'negrita', hijos: [{ tipo: 'texto', texto: '3. Alumno:' }] },
      { tipo: 'texto', texto: ' Alejandra' },
    ])
  })

  it('…y `**rótulo:** valor` sigue siendo lo mismo', () => {
    expect(analizaLinea('**3. Alumno:** Alejandra')).toEqual([
      { tipo: 'negrita', hijos: [{ tipo: 'texto', texto: '3. Alumno:' }] },
      { tipo: 'texto', texto: ' Alejandra' },
    ])
  })

  it('vale igual para el subrayado, y la rayita no cuelga del espacio', () => {
    expect(analizaLinea('__Enviado. __Luego')).toEqual([
      { tipo: 'subrayado', hijos: [{ tipo: 'texto', texto: 'Enviado.' }] },
      { tipo: 'texto', texto: ' Luego' },
    ])
  })

  it('pero con UN asterisco se mantiene estricto: la multiplicación manda', () => {
    expect(analizaLinea('2 * 3 * 4')).toEqual([{ tipo: 'texto', texto: '2 * 3 * 4' }])
    expect(analizaLinea('*ojo: *mira')).toEqual([{ tipo: 'texto', texto: '*ojo: *mira' }])
  })

  it('una marca con solo espacios dentro no es formato', () => {
    expect(analizaLinea('** **')).toEqual([{ tipo: 'texto', texto: '** **' }])
    expect(analizaLinea('__  __')).toEqual([{ tipo: 'texto', texto: '__  __' }])
  })

  it('el bloque entero del comentario que lo destapó', () => {
    const r = analiza([
      '__Enviado a Carlos Gómez.__',
      'Me pidió información adicional:',
      '',
      '**1. Código del TFG asignado por la titulación:** GIB-66',
      '**2. Título del estudio:** Evaluación del impacto',
      '**3. Alumno que realiza el TFG: **Alejandra Alonso Clemente',
      '**4. Tutor o tutores del TFG: **Javier Gómez Pilar',
    ].join('\n'))

    const parrafos = r.filter((b) => b.tipo === 'parrafo')
    expect(parrafos).toHaveLength(2)
    // Las cuatro líneas del segundo párrafo empiezan en negrita, las cuatro.
    const lineas = elParrafo(r[1]).lineas
    expect(lineas).toHaveLength(4)
    expect(lineas.map((l) => l[0]?.tipo)).toEqual(['negrita', 'negrita', 'negrita', 'negrita'])
  })
})
