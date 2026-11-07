import { describe, expect, it } from 'vitest'
import { esDescarte, ordenarConOtrosAlFinal } from '../catalog-order'

const nombres = (filas: { name: string }[]) => filas.map((f) => f.name)
const lineas = (...names: string[]) => names.map((name) => ({ name }))

describe('esDescarte', () => {
  it('reconoce las formas en que se escribe la casilla de descarte', () => {
    expect(esDescarte('Otros')).toBe(true)
    expect(esDescarte('otros')).toBe(true)
    expect(esDescarte('Otras')).toBe(true)
    expect(esDescarte('Otro')).toBe(true)
    expect(esDescarte('  Otras líneas  ')).toBe(true)
  })

  it('no se lleva por delante una línea que solo empieza parecido', () => {
    expect(esDescarte('Otorrinolaringología')).toBe(false)
    expect(esDescarte('Otrosina (molécula inventada)')).toBe(false)
    expect(esDescarte('Neurociencia de otros')).toBe(false)
  })
})

describe('ordenarConOtrosAlFinal', () => {
  it('deja «Otros» al final y el resto por orden alfabético', () => {
    expect(
      nombres(ordenarConOtrosAlFinal(lineas('Señales biomédicas', 'Otros', 'Neuroimagen'))),
    ).toEqual(['Neuroimagen', 'Señales biomédicas', 'Otros'])
  })

  it('ordena en castellano: los acentos no mandan al final', () => {
    expect(nombres(ordenarConOtrosAlFinal(lineas('Biomecánica', 'Álgebra', 'Cardiología')))).toEqual(
      ['Álgebra', 'Biomecánica', 'Cardiología'],
    )
  })

  it('aguanta varias casillas de descarte y las deja juntas al final', () => {
    expect(nombres(ordenarConOtrosAlFinal(lineas('Otras', 'Epilepsia', 'Otros')))).toEqual([
      'Epilepsia', 'Otras', 'Otros',
    ])
  })

  it('no toca la lista que recibe', () => {
    const original = lineas('Otros', 'Epilepsia')
    ordenarConOtrosAlFinal(original)
    expect(nombres(original)).toEqual(['Otros', 'Epilepsia'])
  })

  it('no se inmuta con una lista vacía', () => {
    expect(ordenarConOtrosAlFinal([])).toEqual([])
  })
})
