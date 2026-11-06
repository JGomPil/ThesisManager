import { describe, expect, it } from 'vitest'
import { iniciales } from '@/components/ui/avatar'
import { esUrlExterna } from '@/lib/avatars'

/**
 * Las iniciales se ven en cada tarjeta y en cada comentario, así que un caso
 * raro no es un detalle estético: es lo que aparece junto al nombre de una
 * persona real. Y los nombres españoles traen justo los casos raros.
 */
describe('iniciales', () => {
  it('toma el nombre y el ÚLTIMO apellido, no las dos primeras palabras', () => {
    // Con dos apellidos, «JG» sería el nombre y el primer apellido; la pareja
    // que identifica a alguien en castellano es nombre + último apellido.
    expect(iniciales('Javier Gómez Pilar')).toBe('JP')
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

  it('no rompe los nombres con partícula: cuenta la última palabra', () => {
    // «María de la Fuente» → M + F. Tratar «de» o «la» como apellido daría
    // «MD», que no identifica a nadie.
    expect(iniciales('María de la Fuente')).toBe('MF')
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
