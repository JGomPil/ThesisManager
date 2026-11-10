import { describe, expect, it } from 'vitest'
import { plantillaAlCambiarDeTipo } from '@/domain/works/plantilla-por-omision'

describe('la plantilla que viene puesta al elegir el tipo', () => {
  const dispo = [{ id: 'p1' }, { id: 'p2' }]

  it('elige la marcada en el catálogo', () => {
    expect(plantillaAlCambiarDeTipo(dispo, 'p2')).toBe('p2')
  })

  it('sin plantilla marcada, se empieza sin plan', () => {
    expect(plantillaAlCambiarDeTipo(dispo, null)).toBe('')
  })

  it('si la marcada ya no es aplicable, se empieza sin plan', () => {
    // La retiraron, o es de otro tipo. Ofrecerla sería ofrecer algo que
    // `app.apply_template` rechaza al guardar (prueba [86] de RLS).
    expect(plantillaAlCambiarDeTipo(dispo, 'p9')).toBe('')
  })

  it('sin plantillas para el tipo, tampoco pasa nada', () => {
    expect(plantillaAlCambiarDeTipo([], 'p1')).toBe('')
  })
})
