import { describe, expect, it } from 'vitest'
import {
  LIMITE_FICHEROS_BYTES, contrastar, formatearBytes, nivelOcupacion, porcentajeOcupado,
} from '../plan-usage'

const MB = 1024 ** 2
const GB = 1024 ** 3

describe('formatearBytes', () => {
  it('usa la unidad que toca', () => {
    expect(formatearBytes(0)).toBe('0 B')
    expect(formatearBytes(512)).toBe('512 B')
    expect(formatearBytes(2048)).toBe('2 kB')
    expect(formatearBytes(5 * MB)).toBe('5.0 MB')
    expect(formatearBytes(250 * MB)).toBe('250 MB')
    expect(formatearBytes(GB)).toBe('1.00 GB')
  })

  it('no inventa una cifra cuando no hay dato', () => {
    expect(formatearBytes(Number.NaN)).toBe('—')
    expect(formatearBytes(-1)).toBe('—')
  })
})

describe('porcentajeOcupado', () => {
  it('redondea sobre el límite del plan', () => {
    expect(porcentajeOcupado(0)).toBe(0)
    expect(porcentajeOcupado(GB / 2)).toBe(50)
    expect(porcentajeOcupado(GB)).toBe(100)
  })

  it('no se sale de la barra si se pasa del límite', () => {
    expect(porcentajeOcupado(3 * GB)).toBe(100)
  })
})

describe('nivelOcupacion', () => {
  it('avisa al 70 %, antes de que liberar sitio sea urgente', () => {
    expect(nivelOcupacion(0.5 * GB)).toBe('ok')
    expect(nivelOcupacion(0.69 * GB)).toBe('ok')
    expect(nivelOcupacion(0.7 * GB)).toBe('aviso')
    expect(nivelOcupacion(0.89 * GB)).toBe('aviso')
    expect(nivelOcupacion(0.9 * GB)).toBe('critico')
    expect(nivelOcupacion(2 * GB)).toBe('critico')
  })

  it('el límite por omisión es el gigabyte del plan gratuito', () => {
    expect(LIMITE_FICHEROS_BYTES).toBe(GB)
  })
})

describe('contrastar', () => {
  // La razón de ser de esta función: la API de Storage devuelve 200 y lista
  // vacía tanto si el cubo está vacío como si no hay acceso, así que un cero
  // con filas en la base NO se puede presentar como «no hay ficheros».
  it('un cubo vacío con filas en la base no se da por bueno', () => {
    expect(contrastar({ enStorage: 0, esperados: 12 })).toBe('NADA_VISIBLE')
  })

  it('sin filas y sin ficheros, todo cuadra', () => {
    expect(contrastar({ enStorage: 0, esperados: 0 })).toBe('COINCIDE')
  })

  it('cuadra cuando coinciden', () => {
    expect(contrastar({ enStorage: 7, esperados: 7 })).toBe('COINCIDE')
  })

  it('detecta ficheros que faltan', () => {
    expect(contrastar({ enStorage: 5, esperados: 7 })).toBe('FALTAN')
  })

  it('detecta huérfanos, que ocupan sitio para siempre', () => {
    expect(contrastar({ enStorage: 9, esperados: 7 })).toBe('HUERFANOS')
  })
})
