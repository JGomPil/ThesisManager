import { describe, expect, it } from 'vitest'
import { correoDeInvitacion, enlaceMailto } from '@/domain/invitations/correo'

const base = {
  nombre: 'Gonzalo C. Gutierrez',
  correo: 'gonzalo@uva.es',
  quienInvita: 'Javier Gomez Pilar',
  url: 'https://jgompil.github.io/ThesisManager/',
}

describe('correoDeInvitacion', () => {
  it('dice la direccion exacta con la que hay que entrar', () => {
    // Es el fallo más probable del proceso: quien entra con otra dirección no
    // encuentra su invitación y la cuenta queda sin ver nada.
    expect(correoDeInvitacion(base).cuerpo).toContain('gonzalo@uva.es')
  })

  it('explica como conseguir la contrasena', () => {
    // Sin esto, el correo lleva a una pantalla donde no se puede hacer nada:
    // el registro público está deshabilitado.
    expect(correoDeInvitacion(base).cuerpo).toContain('He olvidado mi contraseña')
  })

  it('lleva la direccion de la aplicacion y la firma de quien invita', () => {
    const { cuerpo } = correoDeInvitacion(base)
    expect(cuerpo).toContain('https://jgompil.github.io/ThesisManager/')
    expect(cuerpo).toContain('Javier Gomez Pilar')
  })

  it('sin nombre, saluda sin nombre, y no deja un hueco', () => {
    const { cuerpo } = correoDeInvitacion({ ...base, nombre: null })
    expect(cuerpo.startsWith('Hola:')).toBe(true)
    expect(cuerpo).not.toContain('Hola :')
  })

  it('sin firma, se despide igual', () => {
    const { cuerpo } = correoDeInvitacion({ ...base, quienInvita: '   ' })
    expect(cuerpo.trimEnd().endsWith('Un saludo.')).toBe(true)
  })
})

describe('enlaceMailto', () => {
  it('escapa el cuerpo: un & en un nombre no puede cortar el mensaje', () => {
    const enlace = enlaceMailto({ ...base, quienInvita: 'Marta & co.' })
    expect(enlace).toContain('%26')
    // Un solo `&` en todo el enlace: el que separa `subject` de `body`.
    expect(enlace.split('&').length - 1).toBe(1)
  })

  it('la direccion va sin escapar en la ruta del mailto', () => {
    expect(enlaceMailto(base).startsWith('mailto:gonzalo@uva.es?')).toBe(true)
  })

  it('los saltos de linea viajan escapados', () => {
    expect(enlaceMailto(base)).toContain('%0A')
  })
})
