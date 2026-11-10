import { describe, expect, it } from 'vitest'
import { estadoDeAvisos, type EntornoDeAvisos } from '@/domain/avisos/estado-del-dispositivo'

const base: EntornoDeAvisos = {
  soporta: true, permiso: 'default', suscrito: false, esIOS: false, instalada: false,
}

describe('en que situacion esta este aparato', () => {
  it('sin permiso todavia, ofrece encenderlo', () => {
    const r = estadoDeAvisos(base)
    expect(r.estado).toBe('apagado')
    expect(r.accion).toBe('encender')
  })

  it('suscrito, ofrece apagarlo solo aqui', () => {
    const r = estadoDeAvisos({ ...base, permiso: 'granted', suscrito: true })
    expect(r.estado).toBe('encendido')
    expect(r.accion).toBe('apagar')
    expect(r.explicacion).toContain('sin tocar los demas')
  })

  it('bloqueado no ofrece boton, porque no habria forma de que funcionara', () => {
    const r = estadoDeAvisos({ ...base, permiso: 'denied' })
    expect(r.estado).toBe('bloqueado')
    expect(r.accion).toBeNull()
  })

  it('EL IPHONE SIN INSTALAR MANDA SOBRE TODO LO DEMAS', () => {
    // El caso que justifica que esto sea una funcion. En iOS no existe
    // `PushManager` hasta que la aplicacion esta en la pantalla de inicio, asi
    // que `soporta` es false y la respuesta ingenua seria «tu navegador no
    // puede». La verdad es «todavia no».
    const r = estadoDeAvisos({ ...base, soporta: false, esIOS: true, instalada: false })
    expect(r.estado).toBe('instalar-primero')
    expect(r.explicacion).toContain('pantalla de inicio')
  })

  it('el iPhone ya instalado se comporta como cualquier otro', () => {
    expect(estadoDeAvisos({ ...base, esIOS: true, instalada: true }).estado).toBe('apagado')
    expect(
      estadoDeAvisos({ ...base, esIOS: true, instalada: true, permiso: 'granted', suscrito: true }).estado,
    ).toBe('encendido')
  })

  it('un navegador de escritorio sin soporte lo dice, y recuerda que la campana sigue', () => {
    const r = estadoDeAvisos({ ...base, soporta: false })
    expect(r.estado).toBe('no-soportado')
    expect(r.explicacion).toContain('campana')
  })

  it('bloqueado pesa mas que suscrito: una suscripcion vieja con el permiso retirado no sirve', () => {
    const r = estadoDeAvisos({ ...base, permiso: 'denied', suscrito: true })
    expect(r.estado).toBe('bloqueado')
  })
})
