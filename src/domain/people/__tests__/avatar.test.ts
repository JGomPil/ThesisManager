import { describe, expect, it } from 'vitest'
import { esUrlExterna, iniciales, tonoDe } from '@/domain/people/avatar'

// Ni una importación de `lib/`: estas pruebas no deben levantar el cliente de
// Supabase para comprobar cómo se abrevia un nombre. Ver la cabecera de
// `domain/people/avatar.ts`.

/**
 * Las iniciales se ven en cada tarjeta y en cada comentario, así que un caso
 * raro no es un detalle estético: es lo que aparece junto al nombre de una
 * persona real. Y los nombres españoles traen justo los casos raros.
 */
describe('iniciales', () => {
  it('toma el nombre y LOS DOS apellidos, como se nombra en España', () => {
    // «JP» —nombre y último apellido— es la convención anglosajona, donde hay un
    // solo apellido. Aquí hay dos, y el primero es el que se usa para nombrar a
    // alguien: «JP» se salta justo ese, y deja a «Javier Gómez Pilar» y «Javier
    // García Pilar» con las mismas iniciales.
    expect(iniciales('Javier Gómez Pilar')).toBe('JGP')
    expect(iniciales('Roberto Hornero Sánchez')).toBe('RHS')
  })

  it('con nombre compuesto toma la primera palabra y los dos apellidos', () => {
    // Sin una base de datos de nombres no hay forma de saber si «Carlos» es
    // parte del nombre o el primer apellido. Tres letras es el tope que cabe.
    expect(iniciales('Juan Carlos Pérez Gómez')).toBe('JPG')
  })

  it('con un solo nombre usa sus dos primeras letras', () => {
    expect(iniciales('Ada')).toBe('AD')
  })

  it('con nombre y un apellido hace lo evidente', () => {
    expect(iniciales('Ada Lovelace')).toBe('AL')
  })

  it('aguanta espacios de sobra sin inventarse una inicial vacía', () => {
    expect(iniciales('  Ada   Lovelace  ')).toBe('AL')
  })

  it('no se cae con la cadena vacía ni con solo espacios', () => {
    expect(iniciales('')).toBe('?')
    expect(iniciales('   ')).toBe('?')
  })

  it('conserva las tildes en mayúscula', () => {
    expect(iniciales('Álvaro Íñigo')).toBe('ÁÍ')
  })

  it('no rompe los nombres con partícula: no cuenta «de», «la», «del»', () => {
    // «María de la Fuente» → M + F. Tratar «de» o «la» como apellido daría
    // «MDL», que no identifica a nadie.
    expect(iniciales('María de la Fuente')).toBe('MF')
    expect(iniciales('José de la Fuente Martín')).toBe('JFM')
    expect(iniciales('Ana De La Cruz Soto')).toBe('ACS')
  })

  it('«San» NO es partícula: en «San Martín» es el apellido', () => {
    expect(iniciales('Ana San Martín Ruiz')).toBe('AMR')
  })

  it('si todo son partículas, usa lo que haya antes que rendirse', () => {
    // Entrada sin sentido: lo que importa es que no se caiga ni devuelva «?».
    expect(iniciales('de la')).toBe('DL')
  })
})

describe('esUrlExterna', () => {
  it('reconoce una URL http(s) para no intentar firmarla', () => {
    expect(esUrlExterna('https://ejemplo.invalid/foto.jpg')).toBe(true)
    expect(esUrlExterna('HTTP://ejemplo.invalid/foto.jpg')).toBe(true)
  })

  it('una ruta del cubo NO es una URL externa', () => {
    expect(esUrlExterna('11111111-1111-1111-1111-111111111111/1700000000.webp')).toBe(false)
  })

  it('no se deja colar un esquema raro', () => {
    // `javascript:` en un `src` de imagen no ejecuta nada, pero tampoco es una
    // foto: que caiga del lado de «ruta» y falle al firmar es lo correcto.
    expect(esUrlExterna('javascript:alert(1)')).toBe(false)
    expect(esUrlExterna('data:image/png;base64,AAA')).toBe(false)
  })
})

describe('tonoDe', () => {
  it('da SIEMPRE el mismo color al mismo nombre', () => {
    // Es la razón de ser de la función: reconocer a alguien de un vistazo.
    expect(tonoDe('Ada Lovelace')).toBe(tonoDe('Ada Lovelace'))
  })

  it('devuelve un tono del catálogo, no cualquier cosa', () => {
    const permitidos = ['sky', 'violet', 'emerald', 'amber', 'teal', 'pink', 'blue', 'cyan']
    for (const n of ['Ada', 'Javier Gómez Pilar', '', 'X', 'Ñoño Ñáñez']) {
      expect(permitidos).toContain(tonoDe(n))
    }
  })
})
